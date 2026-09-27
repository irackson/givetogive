/** Database invariants with synthetic fixtures; not Stripe sandbox evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after, mock } from 'node:test';
import type Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	payments,
	paymentSubscriptions,
	supporterPaidCoverage,
} from '../../src/server/db/payments-schema.ts';
import {
	activeSupporterCoverage,
	recordPaidCoverage,
} from '../../src/server/payments/coverage.ts';
import { type PaymentTransaction } from '../../src/server/payments/ledger.ts';
import {
	synchronizeSubscription,
	reconcileInvoice,
} from '../../src/server/payments/reconcile.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import {
	tierFromCoverage,
	type VerifiedCoverageLine,
} from '../../src/server/payments/coverage-policy.ts';

const rollback = new Error('Intentional CI rollback');
const start = new Date('2026-09-01T00:00:00Z');
const end = new Date('2026-10-01T00:00:00Z');
before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	const [identity] = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name,current_user as role`,
	);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
});
after(() => db.$client.end());
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
	const paymentId = randomUUID();
	const invoiceId = `in_ci_${randomUUID()}`;
	await tx.insert(users).values({
		id: actorId,
		name: 'CI coverage fixture',
		email: `${actorId}@example.invalid`,
		isSynthetic: true,
	});
	const feeSnapshot = {
		version: 'ci',
		platformBps: 500,
		processingBps: 290,
		processingFixed: 30,
	};
	await tx.insert(payments).values({
		id: paymentId,
		actorId,
		subscriptionId,
		invoiceId,
		kind: 'supporter',
		tier: 'supporter',
		livemode: false,
		requestHash: 'ci-fixture',
		grossAmount: 500,
		platformFee: 500,
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
		accountId: `acct_ci_${actorId}`,
		kind: 'supporter',
		tier: 'sustainer',
		priceId: 'price_now_different',
		status: 'active',
		livemode: false,
		paidThrough: new Date('2099-01-01'),
		feeSnapshot,
		initialPaymentId: paymentId,
	});
	const line: VerifiedCoverageLine = {
		invoiceLineId: `il_ci_${randomUUID()}`,
		invoiceId,
		subscriptionId,
		livemode: false,
		priceId: 'price_paid_supporter',
		itemId: 'si_coverage_fixture',
		tier: 'supporter',
		periodStart: start,
		periodEnd: end,
		proration: false,
	};
	return { actorId, subscriptionId, paymentId, line };
}
test('legacy projection alone never grants access; future coverage starts and ends at exact service boundaries', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		assert.equal(
			(await activeSupporterCoverage(f.actorId, start, tx)).length,
			0,
		);
		await recordPaidCoverage(tx, f.paymentId, [f.line], () => true);
		assert.equal(
			(
				await activeSupporterCoverage(
					f.actorId,
					new Date(start.getTime() - 1),
					tx,
				)
			).length,
			0,
		);
		assert.equal(
			tierFromCoverage(
				await activeSupporterCoverage(f.actorId, start, tx),
				start,
			),
			'supporter',
		);
		assert.equal(
			(await activeSupporterCoverage(f.actorId, end, tx)).length,
			0,
		);
		assert.equal(
			(await activeSupporterCoverage(randomUUID(), start, tx)).length,
			0,
		);
	}));
test('paid upgrade remains unrecognized until exact provider application is confirmed; replay is idempotent', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		const line = {
			...f.line,
			proration: true,
			tier: 'sustainer' as const,
			priceId: 'price_paid_sustainer',
		};
		await recordPaidCoverage(tx, f.paymentId, [line], () => false);
		assert.equal(
			(await activeSupporterCoverage(f.actorId, start, tx)).length,
			0,
		);
		await recordPaidCoverage(tx, f.paymentId, [line], () => true);
		await recordPaidCoverage(tx, f.paymentId, [line], () => false);
		assert.equal(
			tierFromCoverage(
				await activeSupporterCoverage(f.actorId, start, tx),
				start,
			),
			'sustainer',
		);
		assert.equal(
			(
				await tx
					.select()
					.from(supporterPaidCoverage)
					.where(eq(supporterPaidCoverage.paymentId, f.paymentId))
			).length,
			1,
		);
	}));
test('refunds, dispute holds and mode mismatch suppress recognition without erasing provenance', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await recordPaidCoverage(tx, f.paymentId, [f.line], () => true);
		for (const change of [
			{ status: 'refunded' as const, refundedAmount: 500 },
			{
				status: 'succeeded' as const,
				refundedAmount: 0,
				disputePendingAmount: 1,
			},
			{ disputePendingAmount: 0, disputedAmount: 1 },
			{ disputedAmount: 0, livemode: true },
		]) {
			await tx
				.update(payments)
				.set(change)
				.where(eq(payments.id, f.paymentId));
			assert.equal(
				(await activeSupporterCoverage(f.actorId, start, tx)).length,
				0,
			);
		}
		await tx
			.update(payments)
			.set({
				livemode: false,
				status: 'partially_refunded',
				refundedAmount: 100,
			})
			.where(eq(payments.id, f.paymentId));
		assert.equal(
			(await activeSupporterCoverage(f.actorId, start, tx)).length,
			1,
		);
	}));
test('coverage provenance cannot be reassigned or rewritten through replay', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await recordPaidCoverage(tx, f.paymentId, [f.line], () => true);
		await assert.rejects(
			recordPaidCoverage(
				tx,
				f.paymentId,
				[{ ...f.line, periodStart: new Date(start.getTime() + 1) }],
				() => true,
			),
			/replay conflict/,
		);
		await assert.rejects(
			recordPaidCoverage(
				tx,
				f.paymentId,
				[{ ...f.line, invoiceId: 'in_wrong' }],
				() => true,
			),
			/ownership mismatch/,
		);
	}));

test('supporter payment cannot create coverage on a fund subscription even for the same actor and mode', async () =>
	rolledBack(async (tx) => {
		const f = await fixture(tx);
		await tx
			.update(paymentSubscriptions)
			.set({ kind: 'fund' })
			.where(eq(paymentSubscriptions.id, f.subscriptionId));
		await assert.rejects(
			recordPaidCoverage(tx, f.paymentId, [f.line], () => true),
			/subscription mismatch/,
		);
		assert.equal(
			(
				await tx
					.select()
					.from(supporterPaidCoverage)
					.where(eq(supporterPaidCoverage.paymentId, f.paymentId))
			).length,
			0,
		);
	}));

/** Real SQL assertions, but route this test's production DB entrypoints into its
 * outer rollback transaction. Provider methods below are synthetic stubs only. */
async function observationFixture(
	tx: PaymentTransaction,
	run: (
		context: Awaited<ReturnType<typeof fixture>>,
		client: Stripe,
	) => Promise<void>,
) {
	const f = await fixture(tx);
	const settings = {
		STRIPE_SECRET_KEY: [
			'rk',
			'test',
			'coverage_observation_stub_no_network',
		].join('_'),
		STRIPE_PLATFORM_ACCOUNT_ID: 'acct_ci_coverage_observation',
		STRIPE_PROCESSING_BPS: '290',
		STRIPE_PROCESSING_FIXED_CENTS: '30',
		STRIPE_SUPPORTER_PRICE_ID: f.line.priceId,
		STRIPE_SUSTAINER_PRICE_ID: 'price_other_sustainer',
	};
	const prior = new Map(
		Object.keys(settings).map((name) => [name, process.env[name]]),
	);
	try {
		Object.assign(process.env, settings);
		const client = stripeClient();
		mock.method(db, 'select', tx.select.bind(tx));
		mock.method(db, 'insert', tx.insert.bind(tx));
		mock.method(db, 'update', tx.update.bind(tx));
		mock.method(db, 'transaction', tx.transaction.bind(tx));
		mock.method(
			client.subscriptions,
			'retrieve',
			async () =>
				({
					id: f.subscriptionId,
					customer_account: `acct_ci_${f.actorId}`,
					livemode: false,
					status: 'active',
					cancel_at_period_end: false,
					pending_update: null,
					schedule: null,
					latest_invoice: f.line.invoiceId,
					items: {
						has_more: false,
						data: [
							{
								id: f.line.itemId,
								price: { id: f.line.priceId },
								current_period_start:
									start.getTime() / 1000 + 1000,
								current_period_end: end.getTime() / 1000,
							},
						],
					},
				}) as unknown as Stripe.Subscription,
		);
		await run(f, client);
	} finally {
		mock.restoreAll();
		for (const [name, value] of prior) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test('current subscription observation only applies prorations contained within the exact item period', async () =>
	rolledBack((tx) =>
		observationFixture(tx, async (f) => {
			const outside = { ...f.line, proration: true };
			const inside = {
				...outside,
				invoiceLineId: `${outside.invoiceLineId}_inside`,
				periodStart: new Date(start.getTime() + 2_000_000),
			};
			await recordPaidCoverage(
				tx,
				f.paymentId,
				[outside, inside],
				() => false,
			);
			await synchronizeSubscription(f.subscriptionId);
			const rows = await tx
				.select()
				.from(supporterPaidCoverage)
				.where(eq(supporterPaidCoverage.paymentId, f.paymentId));
			assert.equal(
				rows.find((row) => row.invoiceLineId === outside.invoiceLineId)
					?.appliedAt,
				null,
			);
			assert.ok(
				rows.find((row) => row.invoiceLineId === inside.invoiceLineId)
					?.appliedAt,
			);
		}),
	));

test('invoice reconciliation uses the same proration start containment rule before creating applied coverage', async () =>
	rolledBack((tx) =>
		observationFixture(tx, async (f, client) => {
			const intentId = `pi_ci_${f.paymentId}`;
			await tx
				.update(payments)
				.set({ paymentIntentId: intentId })
				.where(eq(payments.id, f.paymentId));
			const positive = [
				{
					id: f.line.invoiceLineId,
					period: {
						start: start.getTime() / 1000,
						end: end.getTime() / 1000,
					},
				},
				{
					id: `${f.line.invoiceLineId}_inside`,
					period: {
						start: start.getTime() / 1000 + 2000,
						end: end.getTime() / 1000,
					},
				},
			].map((line) => ({
				...line,
				invoice: f.line.invoiceId,
				livemode: false,
				currency: 'usd',
				amount: 250,
				parent: {
					type: 'subscription_item_details',
					subscription_item_details: {
						subscription: f.subscriptionId,
						subscription_item: f.line.itemId,
						proration: true,
					},
				},
				pricing: { price_details: { price: f.line.priceId } },
			}));
			mock.method(client.invoices, 'retrieve', async () => ({
				id: f.line.invoiceId,
				livemode: false,
				customer_account: `acct_ci_${f.actorId}`,
				status: 'paid',
				amount_paid: 500,
				parent: {
					subscription_details: { subscription: f.subscriptionId },
				},
			}));
			mock.method(client.invoices, 'listLineItems', () => ({
				async *[Symbol.asyncIterator]() {
					yield* positive;
				},
			}));
			mock.method(client.invoicePayments, 'list', async () => ({
				has_more: false,
				data: [
					{
						amount_paid: 500,
						payment: {
							type: 'payment_intent',
							payment_intent: intentId,
						},
					},
				],
			}));
			mock.method(client.paymentIntents, 'retrieve', async () => ({
				id: intentId,
				livemode: false,
				currency: 'usd',
				amount: 500,
				amount_received: 500,
				status: 'succeeded',
				latest_charge: {
					id: `ch_ci_${f.paymentId}`,
					livemode: false,
					currency: 'usd',
					amount: 500,
					amount_refunded: 0,
					paid: true,
					created: start.getTime() / 1000,
					balance_transaction: {
						id: `txn_ci_${f.paymentId}`,
						fee: 0,
						status: 'available',
						available_on: start.getTime() / 1000,
					},
					transfer: null,
					receipt_url: null,
				},
			}));
			await reconcileInvoice(f.line.invoiceId);
			const rows = await tx
				.select()
				.from(supporterPaidCoverage)
				.where(eq(supporterPaidCoverage.paymentId, f.paymentId));
			assert.equal(rows.length, 2);
			assert.equal(
				rows.find((row) => row.invoiceLineId === f.line.invoiceLineId)
					?.appliedAt,
				null,
			);
			assert.ok(
				rows.find(
					(row) =>
						row.invoiceLineId === `${f.line.invoiceLineId}_inside`,
				)?.appliedAt,
			);
		}),
	));
