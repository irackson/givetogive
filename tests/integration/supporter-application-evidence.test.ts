/** Rollback-only synthetic CI fixtures. No provider API calls or paid sandbox evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import type Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	paymentAccounts,
	payments,
	paymentSubscriptions,
	supporterApplicationEvidence,
	supporterPaidCoverage,
} from '../../src/server/db/payments-schema.ts';
import {
	captureSupporterApplication,
	appliedSupporterInvoiceLines,
	getStoredSupporterApplication,
} from '../../src/server/payments/supporter-application-evidence.ts';
import type { PaymentTransaction } from '../../src/server/payments/ledger.ts';
import {
	activeSupporterCoverage,
	recordPaidCoverage,
} from '../../src/server/payments/coverage.ts';

const rollback = new Error('Intentional CI rollback');
const platformBefore = process.env['STRIPE_PLATFORM_ACCOUNT_ID'];
const start = new Date('2026-09-01T00:00:00Z');
const end = new Date('2026-10-01T00:00:00Z');
before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	const [identity] = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name,current_user as role`,
	);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ci_platform_evidence';
});
after(async () => {
	if (platformBefore === undefined)
		delete process.env['STRIPE_PLATFORM_ACCOUNT_ID'];
	else process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = platformBefore;
	await db.$client.end();
});
async function rolledBack(run: (tx: PaymentTransaction) => Promise<void>) {
	await assert.rejects(
		db.transaction(async (tx) => {
			await run(tx);
			throw rollback;
		}),
		(error) => error === rollback,
	);
}
async function fixture(tx: PaymentTransaction) {
	const actorId = randomUUID();
	const subscriptionId = `sub_ci_${randomUUID()}`;
	const accountId = `acct_ci_${randomUUID()}`;
	const invoiceId = `in_ci_${randomUUID()}`;
	const paymentId = randomUUID();
	const itemId = `si_ci_${randomUUID()}`;
	const priceId = 'price_ci_applied';
	const feeSnapshot = {
		version: 'ci',
		platformBps: 500,
		processingBps: 290,
		processingFixed: 30,
	};
	await tx.insert(users).values({
		id: actorId,
		email: `${actorId}@example.invalid`,
		name: 'CI application evidence',
		isSynthetic: true,
	});
	await tx.insert(paymentAccounts).values({
		userId: actorId,
		stripeAccountId: accountId,
		livemode: false,
	});
	await tx.insert(payments).values({
		id: paymentId,
		actorId,
		subscriptionId,
		invoiceId,
		kind: 'supporter',
		tier: 'sustainer',
		livemode: false,
		requestHash: 'synthetic-ci-evidence',
		grossAmount: 1000,
		platformFee: 1000,
		processingEstimate: 0,
		recipientAmount: 0,
		feeSnapshot,
		status: 'succeeded',
		paidAt: start,
		expiresAt: end,
	});
	await tx.insert(paymentSubscriptions).values({
		id: subscriptionId,
		actorId,
		accountId,
		kind: 'supporter',
		tier: 'supporter',
		priceId: 'price_current_unrelated',
		itemId,
		latestInvoiceId: 'in_later_renewal',
		periodStart: end,
		periodEnd: new Date('2026-11-01'),
		status: 'active',
		livemode: false,
		feeSnapshot,
		initialPaymentId: paymentId,
	});
	const event = {
		id: `evt_ci_${randomUUID()}`,
		type: 'customer.subscription.pending_update_applied',
		created: start.getTime() / 1000 + 10,
		livemode: false,
		data: {
			object: {
				id: subscriptionId,
				object: 'subscription',
				customer_account: accountId,
				livemode: false,
				pending_update: null,
				latest_invoice: invoiceId,
				items: {
					has_more: false,
					data: [
						{
							id: itemId,
							subscription: subscriptionId,
							quantity: 1,
							current_period_start: start.getTime() / 1000,
							current_period_end: end.getTime() / 1000,
							price: {
								id: priceId,
								livemode: false,
								type: 'recurring',
								currency: 'usd',
								recurring: {
									interval: 'month',
									interval_count: 1,
									usage_type: 'licensed',
								},
							},
						},
					],
				},
			},
		},
	} as unknown as Stripe.Event;
	const line = {
		invoiceLineId: `il_ci_${randomUUID()}`,
		itemId,
		priceId,
		periodStart: new Date(start.getTime() + 10_000),
		periodEnd: end,
		proration: true,
	};
	const lookup = {
		subscriptionId,
		accountId,
		invoiceId,
		livemode: false,
		lines: [line],
	};
	return {
		actorId,
		subscriptionId,
		accountId,
		invoiceId,
		paymentId,
		event,
		line,
		lookup,
	};
}
async function rejectedStatement(
	tx: PaymentTransaction,
	run: (savepoint: PaymentTransaction) => Promise<unknown>,
) {
	await assert.rejects(tx.transaction(run), (error: unknown) => {
		let current = error;
		while (current instanceof Error) {
			if ('code' in current && current.code === '23514') return true;
			current = current.cause;
		}
		return false;
	});
}

test('late application captures exact old invoice despite renewed subscription; replay and stored recovery are durable', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		assert.deepEqual(await captureSupporterApplication(f.event, tx), {
			captured: true,
		});
		assert.deepEqual(await captureSupporterApplication(f.event, tx), {
			captured: true,
		});
		assert.deepEqual(
			await appliedSupporterInvoiceLines(f.lookup, tx),
			new Set([f.line.invoiceLineId]),
		);
		assert.deepEqual(
			await getStoredSupporterApplication(
				f.event.id,
				f.subscriptionId,
				false,
				tx,
			),
			{ invoiceId: f.invoiceId },
		);
		const proofs = await tx
			.select()
			.from(supporterApplicationEvidence)
			.where(eq(supporterApplicationEvidence.stripeEventId, f.event.id));
		assert.equal(proofs.length, 1);
		const changed = structuredClone(f.event);
		(changed.data.object as Stripe.Subscription).latest_invoice =
			'in_rewrite_attempt';
		await assert.rejects(
			captureSupporterApplication(changed, tx),
			/replay conflict/,
		);
	}));
test('foreign account/subscription/mode/line scopes cannot borrow application evidence', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await captureSupporterApplication(f.event, tx);
		for (const changed of [
			{ accountId: 'acct_foreign' },
			{ subscriptionId: 'sub_foreign' },
			{ livemode: true },
			{ invoiceId: 'in_foreign' },
			{ lines: [{ ...f.line, itemId: 'si_foreign' }] },
			{ lines: [{ ...f.line, priceId: 'price_foreign' }] },
			{ lines: [{ ...f.line, periodEnd: new Date(end.getTime() + 1) }] },
		])
			assert.equal(
				(
					await appliedSupporterInvoiceLines(
						{ ...f.lookup, ...changed },
						tx,
					)
				).size,
				0,
			);
		assert.equal(
			await getStoredSupporterApplication(
				f.event.id,
				'sub_foreign',
				false,
				tx,
			),
			null,
		);
		const foreign = structuredClone(f.event);
		(foreign.data.object as Stripe.Subscription).customer_account =
			'acct_foreign';
		await assert.rejects(
			captureSupporterApplication(foreign, tx),
			/ownership/,
		);
		const unknown = {
			...f.event,
			data: {
				object: { id: 'sub_unknown', metadata: { actorId: f.actorId } },
			},
		} as unknown as Stripe.Event;
		assert.deepEqual(await captureSupporterApplication(unknown, tx), {
			captured: false,
		});
	}));
test('first-class account mapping is mandatory even when subscription and metadata name the actor', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await tx
			.delete(paymentAccounts)
			.where(eq(paymentAccounts.userId, f.actorId));
		assert.deepEqual(await captureSupporterApplication(f.event, tx), {
			captured: false,
		});
		assert.equal(
			(await appliedSupporterInvoiceLines(f.lookup, tx)).size,
			0,
		);
	}));
test('durable late proof promotes paid coverage once but cannot bypass later refund or dispute state', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		const coverageLine = {
			...f.line,
			invoiceId: f.invoiceId,
			subscriptionId: f.subscriptionId,
			livemode: false,
			tier: 'sustainer' as const,
		};
		await recordPaidCoverage(tx, f.paymentId, [coverageLine], () => false);
		assert.equal(
			(await activeSupporterCoverage(f.actorId, f.line.periodStart, tx))
				.length,
			0,
		);
		await captureSupporterApplication(f.event, tx);
		const applied = await appliedSupporterInvoiceLines(f.lookup, tx);
		await recordPaidCoverage(tx, f.paymentId, [coverageLine], (line) =>
			applied.has(line.invoiceLineId),
		);
		assert.equal(
			(
				await activeSupporterCoverage(f.actorId, f.line.periodStart, tx)
			)[0]?.tier,
			'sustainer',
		);
		await tx
			.update(payments)
			.set({ disputedAmount: 1000 })
			.where(eq(payments.id, f.paymentId));
		assert.equal(
			(await activeSupporterCoverage(f.actorId, f.line.periodStart, tx))
				.length,
			0,
		);
		await tx
			.update(payments)
			.set({
				disputedAmount: 0,
				status: 'refunded',
				refundedAmount: 1000,
			})
			.where(eq(payments.id, f.paymentId));
		await recordPaidCoverage(tx, f.paymentId, [coverageLine], (line) =>
			applied.has(line.invoiceLineId),
		);
		assert.equal(
			(await activeSupporterCoverage(f.actorId, f.line.periodStart, tx))
				.length,
			0,
		);
	}));
test('application evidence rejects direct update, delete and truncate at the database boundary', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await captureSupporterApplication(f.event, tx);
		await rejectedStatement(tx, (s) =>
			s
				.update(supporterApplicationEvidence)
				.set({ priceId: 'price_other' })
				.where(
					eq(supporterApplicationEvidence.stripeEventId, f.event.id),
				),
		);
		await rejectedStatement(tx, (s) =>
			s
				.delete(supporterApplicationEvidence)
				.where(
					eq(supporterApplicationEvidence.stripeEventId, f.event.id),
				),
		);
		await rejectedStatement(tx, (s) =>
			s.execute(sql`truncate givetogive_supporter_application_evidence`),
		);
	}));
test('coverage allows only monotonic legacy item fill and application; never history rewrite/delete/truncate', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		const row = {
			...f.line,
			invoiceId: f.invoiceId,
			subscriptionId: f.subscriptionId,
			paymentId: f.paymentId,
			livemode: false,
			tier: 'sustainer' as const,
			itemId: null,
		};
		await tx.insert(supporterPaidCoverage).values(row);
		await rejectedStatement(tx, (s) =>
			s
				.update(supporterPaidCoverage)
				.set({ appliedAt: start })
				.where(
					eq(
						supporterPaidCoverage.invoiceLineId,
						f.line.invoiceLineId,
					),
				),
		);
		await tx
			.update(supporterPaidCoverage)
			.set({ itemId: f.line.itemId })
			.where(
				eq(supporterPaidCoverage.invoiceLineId, f.line.invoiceLineId),
			);
		await tx
			.update(supporterPaidCoverage)
			.set({ appliedAt: start })
			.where(
				eq(supporterPaidCoverage.invoiceLineId, f.line.invoiceLineId),
			);
		for (const changed of [
			{ itemId: 'si_rewrite' },
			{ itemId: null },
			{ appliedAt: null },
			{ appliedAt: end },
			{ priceId: 'price_rewrite' },
			{ invoiceId: 'in_rewrite' },
			{ periodEnd: new Date(end.getTime() + 1) },
		])
			await rejectedStatement(tx, (s) =>
				s
					.update(supporterPaidCoverage)
					.set(changed)
					.where(
						eq(
							supporterPaidCoverage.invoiceLineId,
							f.line.invoiceLineId,
						),
					),
			);
		await rejectedStatement(tx, (s) =>
			s
				.delete(supporterPaidCoverage)
				.where(
					eq(
						supporterPaidCoverage.invoiceLineId,
						f.line.invoiceLineId,
					),
				),
		);
		await rejectedStatement(tx, (s) =>
			s.execute(sql`truncate givetogive_supporter_paid_coverage`),
		);
		await rejectedStatement(tx, (s) =>
			s.insert(supporterPaidCoverage).values({
				...row,
				invoiceLineId: `il_ci_${randomUUID()}`,
				appliedAt: start,
			}),
		);
	}));
