import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
	paymentSubscriptions,
	payments,
	supporterPaidCoverage,
} from '@/server/db/payments-schema';
import { type PaymentTransaction } from './ledger';
import { recordEvent } from '@/server/observability/events';

/** Historical paid-through summary only: use supporterRecognition for current access.
 * Recompute, don't increment: duplicate and out-of-order invoices cannot restore refunded access.
 * Called after changing a payment in the same transaction. Serializing on the subscription
 * gives each contender a fresh READ COMMITTED snapshot of all qualifying invoice payments.
 */
export async function refreshSupporterEntitlement(
	tx: PaymentTransaction,
	subscriptionId: string,
) {
	const [subscription] = await tx
		.select()
		.from(paymentSubscriptions)
		.where(eq(paymentSubscriptions.id, subscriptionId))
		.for('update');
	if (!subscription || subscription.kind !== 'supporter') return;
	const [coverage] = await tx
		.select({
			paidThrough: supporterPaidCoverage.periodEnd,
			tier: supporterPaidCoverage.tier,
		})
		.from(supporterPaidCoverage)
		.innerJoin(payments, eq(payments.id, supporterPaidCoverage.paymentId))
		.where(
			and(
				eq(payments.subscriptionId, subscriptionId),
				eq(supporterPaidCoverage.subscriptionId, subscriptionId),
				eq(supporterPaidCoverage.livemode, subscription.livemode),
				eq(payments.actorId, subscription.actorId),
				eq(payments.invoiceId, supporterPaidCoverage.invoiceId),
				eq(payments.livemode, subscription.livemode),
				inArray(payments.status, ['succeeded', 'partially_refunded']),
				isNotNull(supporterPaidCoverage.appliedAt),
				isNotNull(payments.paidAt),
				sql`${payments.grossAmount} > ${payments.refundedAmount}`,
				eq(payments.disputedAmount, 0),
				eq(payments.disputePendingAmount, 0),
			),
		)
		.orderBy(
			desc(supporterPaidCoverage.periodEnd),
			sql`case when ${supporterPaidCoverage.tier} = 'sustainer' then 2 else 1 end desc`,
			desc(payments.paidAt),
			desc(payments.id),
		)
		.limit(1);
	await tx
		.update(paymentSubscriptions)
		.set({
			paidThrough: coverage?.paidThrough ?? null,
		})
		.where(eq(paymentSubscriptions.id, subscriptionId));
	if (!subscription.paidThrough && coverage?.paidThrough)
		await recordEvent(
			{
				actorId: subscription.actorId,
				entityType: 'subscription',
				entityId: subscriptionId,
				action: 'subscription.started',
				outcome: 'success',
				details: {
					tier: coverage.tier,
					kind: 'supporter',
					newStatus: subscription.status,
				},
			},
			tx,
		);
	else if (subscription.paidThrough && !coverage?.paidThrough)
		await recordEvent(
			{
				actorId: subscription.actorId,
				entityType: 'subscription',
				entityId: subscriptionId,
				action: 'subscription.access_revoked',
				outcome: 'success',
				details: { tier: subscription.tier, kind: 'supporter' },
			},
			tx,
		);
}
