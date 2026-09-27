import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import {
	fundAllocations,
	paymentAccounts,
	paymentCases,
	paymentOperations,
	paymentWebhookInbox,
	payments,
	supporterChanges,
	paymentSubscriptions,
} from '@/server/db/payments-schema';
import { paymentConfiguration } from './config';
import { reconcileCheckout, reconcilePaymentIntent } from './reconcile';
import { stripeClient } from './stripe';
import { type PaymentTransaction } from './ledger';

export async function reconcilePayment(id: string) {
	const [payment] = await db
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.id, id),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	if (!payment) return;
	if (payment.checkoutId) return reconcileCheckout(payment.checkoutId);
	if (payment.paymentIntentId)
		return reconcilePaymentIntent(payment.paymentIntentId);
	if (payment.status !== 'reserved') return;
	const [account] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, payment.actorId),
				eq(paymentAccounts.livemode, payment.livemode),
			),
		);
	if (!account) return;
	// Search only the known account, including expired sessions. Do not create another
	// checkout after Stripe's 24-hour idempotency window if the original result is unknown.
	for await (const session of stripeClient().checkout.sessions.list({
		customer_account: account.stripeAccountId,
		created: { gte: Math.floor(payment.createdAt.getTime() / 1000) - 60 },
		limit: 100,
	})) {
		if (session.client_reference_id === id) {
			await reconcileCheckout(session.id);
			return;
		}
	}
	if (payment.expiresAt < new Date()) {
		await db
			.insert(paymentCases)
			.values({
				key: `checkout-unknown:${id}`,
				paymentId: id,
				category: 'checkout_reconciliation',
				summary:
					'No Stripe checkout found for a reserved operation. Verify request logs before releasing the reservation.',
			})
			.onConflictDoNothing();
	}
}

export async function recoveryBatch() {
	const config = paymentConfiguration();
	if (!config.configured)
		return {
			paymentIds: [],
			webhookIds: [],
			refundIds: [],
			allocationIds: [],
			supporterChangeIds: [],
		};
	return db.transaction(claimRecoveryBatch);
}

/** Touch the attempt clock when claiming, even if the external call later fails.
 * Old poison rows rotate behind newer work; locks prevent overlapping sweeps
 * from repeatedly claiming the same first page.
 */
export async function claimRecoveryBatch(tx: PaymentTransaction) {
	const config = paymentConfiguration();
	const retryBefore = new Date(Date.now() - 60_000);
	const paymentRows = await tx
		.select({ id: payments.id })
		.from(payments)
		.where(
			and(
				eq(payments.livemode, config.livemode),
				lt(payments.updatedAt, retryBefore),
				sql`(${payments.status} IN ('reserved','checkout_open','pending') OR (${payments.status} IN ('succeeded','partially_refunded') AND ${payments.availableAt} IS NULL))`,
			),
		)
		.orderBy(asc(payments.updatedAt))
		.limit(30)
		.for('update', { skipLocked: true });
	const events = await tx
		.select({ id: paymentWebhookInbox.id })
		.from(paymentWebhookInbox)
		.where(
			and(
				eq(paymentWebhookInbox.livemode, config.livemode),
				inArray(paymentWebhookInbox.status, ['pending', 'failed']),
				lt(paymentWebhookInbox.updatedAt, retryBefore),
			),
		)
		.orderBy(asc(paymentWebhookInbox.updatedAt))
		.limit(30)
		.for('update', { skipLocked: true });
	const refunds = await tx
		.select({ id: paymentOperations.id })
		.from(paymentOperations)
		.innerJoin(payments, eq(payments.id, paymentOperations.paymentId))
		.where(
			and(
				eq(payments.livemode, config.livemode),
				eq(paymentOperations.kind, 'refund'),
				inArray(paymentOperations.status, [
					'pending',
					'recovery_required',
				]),
				lt(paymentOperations.updatedAt, retryBefore),
			),
		)
		.orderBy(asc(paymentOperations.updatedAt))
		.limit(10)
		.for('update', { of: paymentOperations, skipLocked: true });
	const allocations = await tx
		.select({ id: fundAllocations.id })
		.from(fundAllocations)
		.where(
			and(
				eq(fundAllocations.livemode, config.livemode),
				inArray(fundAllocations.status, [
					'reserved',
					'processing',
					'recovery_required',
				]),
				lt(fundAllocations.updatedAt, retryBefore),
			),
		)
		.orderBy(asc(fundAllocations.updatedAt))
		.limit(10)
		.for('update', { skipLocked: true });
	const changes = await tx
		.select({ id: supporterChanges.id })
		.from(supporterChanges)
		.innerJoin(
			paymentSubscriptions,
			eq(paymentSubscriptions.id, supporterChanges.subscriptionId),
		)
		.where(
			and(
				eq(supporterChanges.livemode, config.livemode),
				eq(paymentSubscriptions.livemode, config.livemode),
				eq(paymentSubscriptions.actorId, supporterChanges.actorId),
				eq(paymentSubscriptions.kind, 'supporter'),
				inArray(supporterChanges.status, [
					'reserved',
					'processing',
					'recovery_required',
					'pending_payment',
					'scheduled',
				]),
				or(
					eq(
						paymentSubscriptions.activeMutationId,
						supporterChanges.id,
					),
					eq(
						paymentSubscriptions.pendingChangeId,
						supporterChanges.id,
					),
				),
				or(
					isNull(paymentSubscriptions.activeMutationId),
					eq(
						paymentSubscriptions.activeMutationId,
						supporterChanges.id,
					),
				),
				lt(supporterChanges.updatedAt, retryBefore),
				or(
					isNull(supporterChanges.leaseUntil),
					lte(supporterChanges.leaseUntil, new Date()),
				),
			),
		)
		.orderBy(asc(supporterChanges.updatedAt))
		.limit(10)
		.for('update', { of: supporterChanges, skipLocked: true });
	const now = new Date();
	if (paymentRows.length)
		await tx
			.update(payments)
			.set({ updatedAt: now })
			.where(
				inArray(
					payments.id,
					paymentRows.map((row) => row.id),
				),
			);
	if (events.length)
		await tx
			.update(paymentWebhookInbox)
			.set({ updatedAt: now })
			.where(
				inArray(
					paymentWebhookInbox.id,
					events.map((row) => row.id),
				),
			);
	if (refunds.length)
		await tx
			.update(paymentOperations)
			.set({ updatedAt: now })
			.where(
				inArray(
					paymentOperations.id,
					refunds.map((row) => row.id),
				),
			);
	if (allocations.length)
		await tx
			.update(fundAllocations)
			.set({ updatedAt: now })
			.where(
				inArray(
					fundAllocations.id,
					allocations.map((row) => row.id),
				),
			);
	if (changes.length)
		await tx
			.update(supporterChanges)
			.set({ updatedAt: now })
			.where(
				inArray(
					supporterChanges.id,
					changes.map((row) => row.id),
				),
			);
	return {
		paymentIds: paymentRows.map((p) => p.id),
		webhookIds: events.map((e) => e.id),
		refundIds: refunds.map((r) => r.id),
		allocationIds: allocations.map((a) => a.id),
		supporterChangeIds: changes.map((change) => change.id),
	};
}

/** Called only AFTER provider invoice/subscription synchronization, never inside it. */
export async function reconcileSupporterChangesForSubscription(
	subscriptionId: string,
) {
	const config = paymentConfiguration();
	const rows = await db
		.select({ id: supporterChanges.id })
		.from(supporterChanges)
		.innerJoin(
			paymentSubscriptions,
			eq(paymentSubscriptions.id, supporterChanges.subscriptionId),
		)
		.where(
			and(
				eq(paymentSubscriptions.id, subscriptionId),
				eq(paymentSubscriptions.kind, 'supporter'),
				eq(paymentSubscriptions.livemode, config.livemode),
				eq(supporterChanges.livemode, config.livemode),
				eq(paymentSubscriptions.actorId, supporterChanges.actorId),
				or(
					isNull(paymentSubscriptions.activeMutationId),
					eq(
						paymentSubscriptions.activeMutationId,
						supporterChanges.id,
					),
				),
				or(
					eq(
						paymentSubscriptions.activeMutationId,
						supporterChanges.id,
					),
					eq(
						paymentSubscriptions.pendingChangeId,
						supporterChanges.id,
					),
				),
				inArray(supporterChanges.status, [
					'reserved',
					'processing',
					'recovery_required',
					'pending_payment',
					'scheduled',
				]),
				or(
					isNull(supporterChanges.leaseUntil),
					lte(supporterChanges.leaseUntil, new Date()),
				),
			),
		)
		.orderBy(asc(supporterChanges.updatedAt))
		.limit(10);
	const { reconcileSupporterChange } = await import('./supporter-changes');
	for (const row of rows) await reconcileSupporterChange(row.id);
	return rows.map((row) => row.id);
}
