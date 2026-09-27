/** Isolated rollback-only SQL + stubbed provider reads; never sandbox acceptance evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	payments,
	paymentSubscriptions,
	supporterChanges,
} from '../../src/server/db/payments-schema.ts';
import { type PaymentTransaction } from '../../src/server/payments/ledger.ts';
import { claimRecoveryBatch } from '../../src/server/payments/recovery.ts';
import { supporterWebhookSubscription } from '../../src/server/payments/webhooks.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';
import { billingRouter } from '../../src/server/api/routers/billing.ts';

const changedKeys = [
	'STRIPE_SECRET_KEY',
	'STRIPE_PLATFORM_ACCOUNT_ID',
	'APP_URL',
	'STRIPE_PROCESSING_BPS',
	'STRIPE_PROCESSING_FIXED_CENTS',
];
const previous = Object.fromEntries(
	changedKeys.map((key) => [key, process.env[key]]),
);
const rollback = new Error('Intentional supporter wiring fixture rollback');
const old = new Date('1900-01-01T00:00:00Z');
const invoices = new Map<string, Record<string, unknown>>();
const schedules = new Map<string, Record<string, unknown>>();
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	process.env['STRIPE_SECRET_KEY'] = [
		'rk',
		'test',
		'synthetic-wiring-no-network',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ci_wiring';
	process.env['APP_URL'] = 'https://ci.example.invalid';
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	const stripe = stripeClient();
	mock.method(stripe.invoices, 'retrieve', async (id: string) => {
		assert.ok(
			invoices.has(id),
			'Only an explicit synthetic invoice can be read.',
		);
		return invoices.get(id);
	});
	mock.method(
		stripe.subscriptionSchedules,
		'retrieve',
		async (id: string) => {
			assert.ok(
				schedules.has(id),
				'Only an explicit synthetic schedule can be read.',
			);
			return schedules.get(id);
		},
	);
});
after(async () => {
	mock.restoreAll();
	for (const key of changedKeys) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
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
async function fixtures(tx: PaymentTransaction, count = 1) {
	const rows = Array.from({ length: count }, () => {
		const suffix = randomUUID().replaceAll('-', '');
		return {
			actorId: randomUUID(),
			subscriptionId: `sub_ci${suffix}`,
			accountId: `acct_ci${suffix}`,
			paymentId: randomUUID(),
			changeId: randomUUID(),
			invoiceId: `in_ci${suffix}`,
			scheduleId: `sub_sched_ci${suffix}`,
		};
	});
	const feeSnapshot = {
		version: 'ci',
		platformBps: 500,
		processingBps: 290,
		processingFixed: 30,
	};
	await tx.insert(users).values(
		rows.map((row) => ({
			id: row.actorId,
			name: 'CI wiring fixture',
			email: `${row.actorId}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
		})),
	);
	await tx.insert(payments).values(
		rows.map((row) => ({
			id: row.paymentId,
			actorId: row.actorId,
			kind: 'supporter' as const,
			tier: 'supporter' as const,
			livemode: false,
			requestHash: 'ci-no-provider-payment',
			grossAmount: 500,
			platformFee: 500,
			processingEstimate: 0,
			recipientAmount: 0,
			feeSnapshot,
			status: 'failed' as const,
			expiresAt: old,
		})),
	);
	await tx.insert(paymentSubscriptions).values(
		rows.map((row) => ({
			id: row.subscriptionId,
			actorId: row.actorId,
			accountId: row.accountId,
			livemode: false,
			kind: 'supporter' as const,
			status: 'active',
			initialPaymentId: row.paymentId,
			feeSnapshot,
			activeMutationId: row.changeId,
		})),
	);
	await tx.insert(supporterChanges).values(
		rows.map((row) => ({
			id: row.changeId,
			actorId: row.actorId,
			subscriptionId: row.subscriptionId,
			livemode: false,
			action: 'upgrade' as const,
			requestHash: 'a'.repeat(64),
			providerFingerprint: 'b'.repeat(64),
			expectedRevision: 0,
			sourcePriceId: 'price_fixture_supporter',
			targetPriceId: 'price_fixture_sustainer',
			itemId: 'si_fixture',
			status: 'reserved' as const,
			step: 'admitted',
			updatedAt: old,
		})),
	);
	return rows;
}

test('recovery rotates bounded change pages and skips leased, quoted, terminal, fresh, superseded and foreign-mode work', () =>
	rolledBack(async (tx) => {
		const rows = await fixtures(tx, 21);
		const eligible = new Set<string>(
			rows.slice(0, 14).map((row) => row.changeId),
		);
		await tx
			.update(supporterChanges)
			.set({ leaseUntil: new Date(Date.now() + 300_000), updatedAt: old })
			.where(eq(supporterChanges.id, rows[14]!.changeId));
		await tx
			.update(supporterChanges)
			.set({ status: 'quoted', updatedAt: old })
			.where(eq(supporterChanges.id, rows[15]!.changeId));
		await tx
			.update(supporterChanges)
			.set({ status: 'applied', updatedAt: old })
			.where(eq(supporterChanges.id, rows[16]!.changeId));
		await tx
			.update(supporterChanges)
			.set({ updatedAt: new Date() })
			.where(eq(supporterChanges.id, rows[17]!.changeId));
		await tx
			.update(supporterChanges)
			.set({ actorId: rows[0]!.actorId, updatedAt: old })
			.where(eq(supporterChanges.id, rows[18]!.changeId));
		await tx
			.update(paymentSubscriptions)
			.set({ activeMutationId: null })
			.where(eq(paymentSubscriptions.id, rows[19]!.subscriptionId));
		await tx
			.update(supporterChanges)
			.set({ livemode: true, updatedAt: old })
			.where(eq(supporterChanges.id, rows[20]!.changeId));
		await tx
			.update(paymentSubscriptions)
			.set({ livemode: true })
			.where(eq(paymentSubscriptions.id, rows[20]!.subscriptionId));
		const first = await claimRecoveryBatch(tx);
		const second = await claimRecoveryBatch(tx);
		assert.equal(first.supporterChangeIds.length, 10);
		assert.equal(
			first.supporterChangeIds.filter((id) => eligible.has(id)).length,
			10,
		);
		assert.equal(
			second.supporterChangeIds.filter((id) => eligible.has(id)).length,
			4,
		);
		const seen = new Set([
			...first.supporterChangeIds,
			...second.supporterChangeIds,
		]);
		assert.ok(rows.slice(0, 14).every((row) => seen.has(row.changeId)));
		assert.ok(rows.slice(14).every((row) => !seen.has(row.changeId)));
	}));

test('pending and scheduled changes are recoverable only through the subscription-owned pending pointer', () =>
	rolledBack(async (tx) => {
		const rows = await fixtures(tx, 4);
		for (const [index, row] of rows.entries()) {
			await tx
				.update(supporterChanges)
				.set({
					status: index === 0 ? 'scheduled' : 'pending_payment',
					leaseUntil:
						index === 2 ? new Date(Date.now() - 1000) : null,
					updatedAt: old,
				})
				.where(eq(supporterChanges.id, row.changeId));
			await tx
				.update(paymentSubscriptions)
				.set({
					activeMutationId: index === 3 ? randomUUID() : null,
					pendingChangeId: index === 1 ? null : row.changeId,
				})
				.where(eq(paymentSubscriptions.id, row.subscriptionId));
		}
		const batch = await claimRecoveryBatch(tx);
		assert.ok(batch.supporterChangeIds.includes(rows[0]!.changeId));
		assert.equal(
			batch.supporterChangeIds.includes(rows[1]!.changeId),
			false,
		);
		assert.ok(batch.supporterChangeIds.includes(rows[2]!.changeId));
		assert.equal(
			batch.supporterChangeIds.includes(rows[3]!.changeId),
			false,
		);
	}));

test('invoice webhook ownership comes from the verified parent subscription and account, never metadata', () =>
	rolledBack(async (tx) => {
		const [row] = await fixtures(tx);
		const invoice = {
			id: row!.invoiceId,
			livemode: false,
			customer_account: row!.accountId,
			parent: {
				subscription_details: { subscription: row!.subscriptionId },
			},
			metadata: { subscription_id: 'sub_foreign' },
		};
		invoices.set(row!.invoiceId, invoice);
		assert.equal(
			await supporterWebhookSubscription(
				'invoice',
				row!.invoiceId,
				false,
				tx,
			),
			row!.subscriptionId,
		);
		invoices.set(row!.invoiceId, {
			...invoice,
			parent: null,
			metadata: { subscription_id: row!.subscriptionId },
		});
		assert.equal(
			await supporterWebhookSubscription(
				'invoice',
				row!.invoiceId,
				false,
				tx,
			),
			null,
		);
		invoices.set(row!.invoiceId, {
			...invoice,
			customer_account: 'acct_foreign',
		});
		await assert.rejects(
			supporterWebhookSubscription('invoice', row!.invoiceId, false, tx),
			/account mismatch/,
		);
		invoices.set(row!.invoiceId, { ...invoice, livemode: true });
		await assert.rejects(
			supporterWebhookSubscription('invoice', row!.invoiceId, false, tx),
			/ownership mismatch/,
		);
	}));

test('schedule webhook follows subscription/released-subscription and exact stored cancellation mapping', () =>
	rolledBack(async (tx) => {
		const [row] = await fixtures(tx);
		const schedule = {
			id: row!.scheduleId,
			livemode: false,
			customer_account: row!.accountId,
			subscription: row!.subscriptionId,
			released_subscription: null,
			status: 'active',
		};
		schedules.set(row!.scheduleId, schedule);
		assert.equal(
			await supporterWebhookSubscription(
				'schedule',
				row!.scheduleId,
				false,
				tx,
			),
			row!.subscriptionId,
		);
		schedules.set(row!.scheduleId, {
			...schedule,
			subscription: null,
			released_subscription: row!.subscriptionId,
			status: 'released',
		});
		assert.equal(
			await supporterWebhookSubscription(
				'schedule',
				row!.scheduleId,
				false,
				tx,
			),
			row!.subscriptionId,
		);
		schedules.set(row!.scheduleId, {
			...schedule,
			subscription: null,
			status: 'canceled',
			metadata: { subscription_id: row!.subscriptionId },
		});
		assert.equal(
			await supporterWebhookSubscription(
				'schedule',
				row!.scheduleId,
				false,
				tx,
			),
			null,
		);
		await tx
			.update(supporterChanges)
			.set({ scheduleId: row!.scheduleId })
			.where(eq(supporterChanges.id, row!.changeId));
		assert.equal(
			await supporterWebhookSubscription(
				'schedule',
				row!.scheduleId,
				false,
				tx,
			),
			row!.subscriptionId,
		);
		schedules.set(row!.scheduleId, {
			...schedule,
			customer_account: 'acct_foreign',
		});
		await assert.rejects(
			supporterWebhookSubscription(
				'schedule',
				row!.scheduleId,
				false,
				tx,
			),
			/account mismatch/,
		);
	}));

test('all four supporter-change endpoints require authentication before touching provider state', () =>
	rolledBack(async (tx) => {
		const caller = billingRouter.createCaller({
			db: tx,
			session: null,
			headers: new Headers(),
		});
		const operationId = randomUUID();
		const calls = [
			() =>
				caller.previewSupporterChange({
					operationId,
					subscriptionId: 'sub_fixture',
					action: 'upgrade',
					expectedRevision: 0,
				}),
			() => caller.confirmSupporterChange({ operationId }),
			() => caller.supporterChangeStatus({ operationId }),
			() => caller.listSupporterChanges(),
		];
		for (const call of calls)
			await assert.rejects(
				call(),
				(error: unknown) =>
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					error.code === 'UNAUTHORIZED',
			);
	}));
