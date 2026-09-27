/** Rollback-only isolated SQL tests. No Stripe calls or sandbox purchase claims. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	paymentAccounts,
	paymentLedger,
	payments,
	paymentSubscriptions,
	supporterPaidCoverage,
} from '../../src/server/db/payments-schema.ts';
import { operationEvents } from '../../src/server/db/operations-schema.ts';
import type { PaymentTransaction } from '../../src/server/payments/ledger.ts';
import type { VerifiedCoverageLine } from '../../src/server/payments/coverage-policy.ts';
import {
	applyPreflightCoverage,
	runPreflight,
} from '../../scripts/supporter-coverage-preflight.ts';
import { preflightOptions } from '../../scripts/supporter-coverage-preflight-policy.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const rollback = new Error('Intentional preflight fixture rollback');
before(() =>
	verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	),
);
after(() => db.$client.end());
async function isolated(run: (tx: PaymentTransaction) => Promise<void>) {
	await assert.rejects(
		db.transaction(async (tx) => {
			await run(tx);
			throw rollback;
		}),
		(error) => error === rollback,
	);
}
async function fixture(tx: PaymentTransaction) {
	const operatorId = randomUUID(),
		actorId = randomUUID(),
		paymentId = randomUUID();
	const subscriptionId = `sub_preflight_${randomUUID()}`;
	const accountId = `acct_preflight_${randomUUID()}`;
	const invoiceId = `in_preflight_${randomUUID()}`;
	const chargeId = `ch_preflight_${randomUUID()}`;
	await tx.insert(users).values([
		{
			id: operatorId,
			email: `${operatorId}@example.invalid`,
			name: 'CI operator',
			isSynthetic: true,
			role: 'admin',
			emailVerified: new Date(),
		},
		{
			id: actorId,
			email: `${actorId}@example.invalid`,
			name: 'CI member',
			isSynthetic: true,
		},
	]);
	await tx.insert(paymentAccounts).values({
		userId: actorId,
		stripeAccountId: accountId,
		livemode: false,
	});
	const feeSnapshot = {
		version: 'ci',
		platformBps: 500,
		processingBps: 290,
		processingFixed: 30,
	};
	const [payment] = await tx
		.insert(payments)
		.values({
			id: paymentId,
			actorId,
			kind: 'supporter',
			livemode: false,
			subscriptionId,
			invoiceId,
			paymentIntentId: `pi_preflight_${randomUUID()}`,
			chargeId,
			grossAmount: 500,
			platformFee: 500,
			processingEstimate: 0,
			recipientAmount: 0,
			feeSnapshot,
			requestHash: 'ci-preflight',
			status: 'succeeded',
			paidAt: new Date('2026-09-01'),
			expiresAt: new Date('2026-10-01'),
		})
		.returning();
	const [owner] = await tx
		.insert(paymentSubscriptions)
		.values({
			id: subscriptionId,
			actorId,
			accountId,
			livemode: false,
			kind: 'supporter',
			tier: 'sustainer',
			priceId: 'price_current_is_not_proof',
			status: 'active',
			feeSnapshot,
			initialPaymentId: paymentId,
		})
		.returning();
	await tx.insert(paymentLedger).values({
		operationKey: `payment:${chargeId}`,
		paymentId,
		livemode: false,
		lines: [
			{ account: 'stripe_cash', amount: 500 },
			{ account: 'platform_revenue', amount: -500 },
		],
	});
	const line: VerifiedCoverageLine = {
		invoiceLineId: `il_preflight_${randomUUID()}`,
		invoiceId,
		subscriptionId,
		itemId: 'si_preflight',
		priceId: 'price_historical_supporter',
		tier: 'supporter',
		livemode: false,
		proration: false,
		periodStart: new Date('2026-09-01'),
		periodEnd: new Date('2026-10-01'),
	};
	return {
		operatorId,
		expectedIdentity: process.env['DATABASE_IDENTITY']!,
		runId: randomUUID(),
		owner: owner!,
		payment: payment!,
		lines: [line],
	};
}

test('dry-run refuses missing app credentials and all production contexts before provider/database work', async () => {
	const key = process.env['STRIPE_SECRET_KEY'];
	const environment = process.env['APP_ENV'];
	try {
		delete process.env['STRIPE_SECRET_KEY'];
		await assert.rejects(
			runPreflight(preflightOptions(['--operator', 'synthetic-admin'])),
			/test_stripe_credentials_required/,
		);
		process.env['APP_ENV'] = 'production';
		await assert.rejects(
			runPreflight(preflightOptions(['--operator', 'synthetic-admin'])),
			/explicitly isolated environment/,
		);
	} finally {
		if (key === undefined) delete process.env['STRIPE_SECRET_KEY'];
		else process.env['STRIPE_SECRET_KEY'] = key;
		process.env['APP_ENV'] = environment;
	}
});

test('coverage apply is idempotent, preserves actual line dates/tier and records operator provenance', async () =>
	isolated(async (tx) => {
		const f = await fixture(tx);
		await applyPreflightCoverage(tx, f);
		await applyPreflightCoverage(tx, f);
		const rows = await tx
			.select()
			.from(supporterPaidCoverage)
			.where(eq(supporterPaidCoverage.paymentId, f.payment.id));
		assert.equal(rows.length, 1);
		assert.equal(rows[0]!.tier, 'supporter');
		assert.equal(
			rows[0]!.periodStart.toISOString(),
			f.lines[0]!.periodStart.toISOString(),
		);
		assert.ok(rows[0]!.appliedAt);
		const events = await tx
			.select()
			.from(operationEvents)
			.where(
				eq(
					operationEvents.externalId,
					`supporter-preflight:${f.runId}:${f.payment.id}`,
				),
			);
		assert.equal(events.length, 1);
		assert.equal(events[0]!.actorId, f.operatorId);
	}));

test('coverage apply rejects a changed payment and leaves coverage untouched', async () =>
	isolated(async (tx) => {
		const f = await fixture(tx);
		await tx
			.update(payments)
			.set({ status: 'partially_refunded', refundedAmount: 100 })
			.where(eq(payments.id, f.payment.id));
		await assert.rejects(
			applyPreflightCoverage(tx, f),
			/payment_changed_during_verification/,
		);
		assert.equal(
			(
				await tx
					.select()
					.from(supporterPaidCoverage)
					.where(eq(supporterPaidCoverage.paymentId, f.payment.id))
			).length,
			0,
		);
	}));

test('coverage apply rejects wrong identity, non-admin/frozen operators, account drift and missing historical proof', async () =>
	isolated(async (tx) => {
		const f = await fixture(tx);
		await assert.rejects(
			applyPreflightCoverage(tx, {
				...f,
				expectedIdentity: randomUUID(),
			}),
			/apply_identity_mismatch/,
		);
		await assert.rejects(
			applyPreflightCoverage(tx, { ...f, operatorId: f.owner.actorId }),
			/verified_synthetic_operator_required/,
		);
		await tx
			.update(users)
			.set({ frozenAt: new Date() })
			.where(eq(users.id, f.operatorId));
		await assert.rejects(
			applyPreflightCoverage(tx, f),
			/verified_synthetic_operator_required/,
		);
		await tx
			.update(users)
			.set({ frozenAt: null })
			.where(eq(users.id, f.operatorId));
		await assert.rejects(
			applyPreflightCoverage(tx, {
				...f,
				owner: { ...f.owner, accountId: 'acct_foreign' },
			}),
			/subscription_changed_during_verification/,
		);
		await assert.rejects(
			applyPreflightCoverage(tx, {
				...f,
				lines: [{ ...f.lines[0]!, proration: true }],
			}),
			/missing_historical_application_evidence/,
		);
		assert.equal(
			(
				await tx
					.select()
					.from(supporterPaidCoverage)
					.where(eq(supporterPaidCoverage.paymentId, f.payment.id))
			).length,
			0,
		);
	}));
