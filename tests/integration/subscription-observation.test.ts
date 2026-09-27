/** Real isolated PostgreSQL concurrency; Stripe retrieval is an explicit stub. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after, mock } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	payments,
	paymentAccounts,
	paymentCases,
	paymentLedger,
	paymentOperations,
	paymentSubscriptions,
	supporterApplicationEvidence,
	supporterChanges,
	supporterPaidCoverage,
} from '../../src/server/db/payments-schema.ts';
import { recordEvent } from '../../src/server/observability/events.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import { synchronizeSubscription } from '../../src/server/payments/reconcile.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const fixtures: {
	actorId: string;
	subscriptionId: string;
	paymentId: string;
	requestHash: string;
}[] = [];
const fixtureName = 'CI fenced subscription observation';
const feeSnapshot = {
	version: 'ci-observation',
	platformBps: 0,
	processingBps: 0,
	processingFixed: 0,
};
function signal() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
let retrieve: (id: string) => Promise<Stripe.Subscription>;
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	process.env['STRIPE_SECRET_KEY'] = [
		'rk',
		'test',
		'observation_stub_no_network',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ciObservation';
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	delete process.env['STRIPE_PUBLISHABLE_KEY'];
	mock.method(stripeClient().subscriptions, 'retrieve', (id: string) =>
		retrieve(id),
	);
});
after(async () => {
	try {
		await verifyIsolatedTarget(
			db.$client,
			isolatedConfiguration(process.env, 'test'),
		);
		for (const fixture of fixtures) {
			await db.transaction(async (tx) => {
				const [actor] = await tx
					.select()
					.from(users)
					.where(eq(users.id, fixture.actorId))
					.for('update');
				assert.ok(actor?.isSynthetic);
				assert.equal(actor.name, fixtureName);
				assert.equal(actor.email, `${fixture.actorId}@example.invalid`);
				const subscriptions = await tx
					.select()
					.from(paymentSubscriptions)
					.where(eq(paymentSubscriptions.actorId, fixture.actorId))
					.for('update');
				const reservations = await tx
					.select()
					.from(payments)
					.where(eq(payments.actorId, fixture.actorId))
					.for('update');
				assert.equal(subscriptions.length, 1);
				assert.equal(reservations.length, 1);
				const subscription = subscriptions[0]!;
				const payment = reservations[0]!;
				assert.equal(subscription.id, fixture.subscriptionId);
				assert.equal(
					subscription.id,
					`sub_ciObservation${fixture.actorId.replaceAll('-', '')}`,
				);
				assert.equal(
					subscription.accountId,
					`acct_ci${fixture.actorId.replaceAll('-', '')}`,
				);
				assert.equal(subscription.initialPaymentId, fixture.paymentId);
				assert.equal(subscription.kind, 'supporter');
				assert.equal(subscription.livemode, false);
				assert.deepEqual(subscription.feeSnapshot, feeSnapshot);
				assert.ok(
					subscription.itemId === null ||
						subscription.itemId === `si_${subscription.id}`,
				);
				assert.ok(
					subscription.latestInvoiceId === null ||
						subscription.latestInvoiceId ===
							`in_${subscription.id}`,
				);
				assert.ok(
					subscription.priceId === null ||
						subscription.priceId === 'price_ciObservation',
				);
				assert.equal(subscription.scheduleId, null);
				assert.equal(subscription.paidThrough, null);
				assert.equal(subscription.activeMutationId, null);
				assert.equal(subscription.pendingChangeId, null);
				assert.equal(payment.id, fixture.paymentId);
				assert.equal(payment.subscriptionId, fixture.subscriptionId);
				assert.equal(payment.requestHash, fixture.requestHash);
				assert.equal(payment.kind, 'supporter');
				assert.equal(payment.livemode, false);
				assert.equal(payment.status, 'reserved');
				assert.equal(payment.grossAmount, 500);
				assert.equal(payment.platformFee, 500);
				assert.equal(payment.processingEstimate, 0);
				assert.equal(payment.recipientAmount, 0);
				assert.deepEqual(payment.feeSnapshot, feeSnapshot);
				for (const value of [
					payment.checkoutId,
					payment.checkoutUrl,
					payment.paymentIntentId,
					payment.chargeId,
					payment.invoiceId,
					payment.destinationAccountId,
					payment.transferId,
					payment.receiptUrl,
					payment.paidAt,
					payment.askId,
					payment.fundId,
				])
					assert.equal(value, null);
				for (const value of [
					payment.refundedAmount,
					payment.refundedRecipientAmount,
					payment.disputedAmount,
					payment.disputePendingAmount,
					payment.allocatedAmount,
				])
					assert.equal(value, 0);
				const [related] = await tx.execute<{ count: number }>(sql`
					SELECT (
						(SELECT count(*) FROM ${paymentAccounts} WHERE ${paymentAccounts.userId} = ${fixture.actorId}) +
						(SELECT count(*) FROM ${paymentLedger} WHERE ${paymentLedger.paymentId} = ${fixture.paymentId}) +
						(SELECT count(*) FROM ${supporterChanges} WHERE ${supporterChanges.subscriptionId} = ${fixture.subscriptionId}) +
						(SELECT count(*) FROM ${supporterPaidCoverage} WHERE ${supporterPaidCoverage.subscriptionId} = ${fixture.subscriptionId}) +
						(SELECT count(*) FROM ${supporterApplicationEvidence} WHERE ${supporterApplicationEvidence.subscriptionId} = ${fixture.subscriptionId}) +
						(SELECT count(*) FROM ${paymentOperations} WHERE ${paymentOperations.paymentId} = ${fixture.paymentId} OR ${paymentOperations.actorId} = ${fixture.actorId}) +
						(SELECT count(*) FROM ${paymentCases} WHERE ${paymentCases.paymentId} = ${fixture.paymentId})
					)::int AS count`);
				assert.equal(
					related?.count,
					0,
					'Never retire a fixture with provider or financial relationships',
				);
				await tx
					.update(payments)
					.set({
						status: 'expired',
						expiresAt: new Date(),
						lastError:
							'Retired isolated observation stub; no provider operation occurred.',
					})
					.where(eq(payments.id, fixture.paymentId));
				await tx
					.update(paymentSubscriptions)
					.set({
						status: 'canceled',
						activeMutationId: null,
						pendingChangeId: null,
						providerReadLeaseUntil: null,
						providerReadRevision: sql`${paymentSubscriptions.providerReadRevision} + 1`,
					})
					.where(eq(paymentSubscriptions.id, fixture.subscriptionId));
				await tx
					.update(users)
					.set({
						frozenAt: new Date(),
						sessionVersion: sql`${users.sessionVersion} + 1`,
					})
					.where(eq(users.id, fixture.actorId));
				await recordEvent(
					{
						externalId: `ci-observation-stub-retired:${fixture.actorId}`,
						actorId: fixture.actorId,
						entityType: 'ci_fixture',
						entityId: fixture.actorId,
						action: 'ci_observation_stub_retired',
						outcome: 'completed',
						summary:
							'Retired isolated subscription observation stub without provider calls or deletion.',
						details: {
							subscriptionId: fixture.subscriptionId,
							paymentId: fixture.paymentId,
						},
					},
					tx,
				);
			});
		}
	} finally {
		mock.restoreAll();
		await db.$client.end();
	}
});
async function fixture() {
	const actorId = randomUUID();
	const id = `sub_ciObservation${actorId.replaceAll('-', '')}`;
	const accountId = `acct_ci${actorId.replaceAll('-', '')}`;
	const paymentId = randomUUID();
	const requestHash = randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: actorId,
			name: fixtureName,
			email: `${actorId}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
		});
		await tx.insert(payments).values({
			id: paymentId,
			actorId,
			subscriptionId: id,
			kind: 'supporter',
			livemode: false,
			requestHash,
			status: 'reserved',
			grossAmount: 500,
			platformFee: 500,
			processingEstimate: 0,
			recipientAmount: 0,
			feeSnapshot,
			expiresAt: new Date(Date.now() + 3600_000),
		});
		await tx.insert(paymentSubscriptions).values({
			id,
			actorId,
			accountId,
			kind: 'supporter',
			status: 'active',
			livemode: false,
			initialPaymentId: paymentId,
			feeSnapshot,
			providerObservedAt: new Date('2099-01-01'),
		});
	});
	fixtures.push({ actorId, subscriptionId: id, paymentId, requestHash });
	const raw = {
		id,
		customer_account: accountId,
		livemode: false,
		status: 'active',
		cancel_at_period_end: false,
		items: {
			has_more: false,
			data: [
				{
					id: `si_${id}`,
					price: { id: 'price_ciObservation' },
					current_period_start: 1000,
					current_period_end: 2000,
				},
			],
		},
		latest_invoice: `in_${id}`,
		schedule: null,
		pending_update: null,
	} as unknown as Stripe.Subscription;
	return { id, raw };
}
async function row(id: string) {
	return (
		await db
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, id))
	)[0]!;
}

test('only one provider observation runs while the database lease is valid', async () => {
	const f = await fixture();
	const entered = signal();
	const released = signal();
	let calls = 0;
	retrieve = async (id) => {
		assert.equal(id, f.id);
		calls++;
		entered.resolve();
		await released.promise;
		return { ...f.raw, cancel_at_period_end: true };
	};
	const first = synchronizeSubscription(f.id);
	await entered.promise;
	try {
		await assert.rejects(
			synchronizeSubscription(f.id),
			/already in progress/,
		);
		assert.equal(calls, 1);
	} finally {
		released.resolve();
	}
	await first;
	const result = await row(f.id);
	assert.equal(result.cancelAtPeriodEnd, true);
	assert.equal(result.providerReadRevision, 1);
	assert.equal(result.providerReadLeaseUntil, null);
	// A future timestamp from a skewed host never suppresses a fenced read.
	assert.ok(result.providerObservedAt! < new Date('2099-01-01'));
});

test('expired-lease response cannot overwrite or release the newer worker, regardless of host timestamps', async () => {
	const f = await fixture();
	const entered = signal();
	const oldResponse = signal();
	const newEntered = signal();
	const newResponse = signal();
	let calls = 0;
	retrieve = async () => {
		if (++calls === 1) {
			entered.resolve();
			await oldResponse.promise;
			return f.raw;
		}
		newEntered.resolve();
		await newResponse.promise;
		return { ...f.raw, status: 'canceled', cancel_at_period_end: true };
	};
	const oldResult = synchronizeSubscription(f.id).then(
		(value) => ({ value, error: null }),
		(error: unknown) => ({ value: null, error }),
	);
	await entered.promise;
	await db
		.update(paymentSubscriptions)
		.set({ providerReadLeaseUntil: sql`now() - interval '1 second'` })
		.where(eq(paymentSubscriptions.id, f.id));
	const fresh = synchronizeSubscription(f.id);
	await newEntered.promise;
	oldResponse.resolve();
	const old = await oldResult;
	assert.match(String(old.error), /superseded/);
	const leased = await row(f.id);
	assert.equal(leased.providerReadRevision, 2);
	assert.ok(leased.providerReadLeaseUntil);
	newResponse.resolve();
	await fresh;
	assert.equal((await row(f.id)).status, 'canceled');
	assert.equal((await row(f.id)).providerReadLeaseUntil, null);
});

test('provider failure releases only its lease and a later observation can recover', async () => {
	const f = await fixture();
	retrieve = async () => {
		throw new Error('Synthetic provider outage');
	};
	await assert.rejects(
		synchronizeSubscription(f.id),
		/Synthetic provider outage/,
	);
	assert.equal((await row(f.id)).providerReadLeaseUntil, null);
	retrieve = async () => f.raw;
	await synchronizeSubscription(f.id);
	assert.equal((await row(f.id)).providerReadRevision, 2);
});

test('provider account mismatch cannot alter a stored subscription projection', async () => {
	const f = await fixture();
	retrieve = async () => ({
		...f.raw,
		customer_account: 'acct_someoneElse',
		status: 'canceled',
	});
	await assert.rejects(synchronizeSubscription(f.id), /ownership mismatch/);
	assert.equal((await row(f.id)).status, 'active');
	assert.equal((await row(f.id)).providerReadLeaseUntil, null);
});
