import { and, eq, like } from 'drizzle-orm';
import { type Stripe } from 'stripe';
import {
	paymentCases,
	paymentLedger,
	type payments,
} from '@/server/db/payments-schema';
import { cumulativeRefund } from './math';
import { postJournal, type PaymentTransaction } from './ledger';
import { stripeClient, stripeId } from './stripe';

/** Read real cumulative provider movements, including refunds made in Stripe's dashboard.
 * A destination-charge reversal is gross; an application-fee refund offsets part of it.
 * Never approximate each partial refund independently (rounding would drift).
 */
export async function destinationRefundSnapshot(charge: Stripe.Charge) {
	const transferId = stripeId(charge.transfer);
	if (!transferId || !charge.amount_refunded) return null;
	let reversedGross = 0;
	for await (const reversal of stripeClient().transfers.listReversals(
		transferId,
		{ limit: 100 },
	)) {
		// Dispute/administrator transfer reversals have their own journals.
		if (reversal.source_refund) reversedGross += reversal.amount;
	}
	const feeId = stripeId(charge.application_fee);
	const fee =
		feeId ? await stripeClient().applicationFees.retrieve(feeId) : null;
	if (
		fee &&
		(fee.livemode !== charge.livemode || fee.currency !== charge.currency)
	)
		throw new Error('Application fee environment mismatch.');
	return {
		chargeId: charge.id,
		refundedGross: charge.amount_refunded,
		reversedGross,
		feeReturned: fee?.amount_refunded ?? 0,
	};
}

export async function journalDestinationRefunds(
	tx: PaymentTransaction,
	payment: typeof payments.$inferSelect,
	snapshot: NonNullable<
		Awaited<ReturnType<typeof destinationRefundSnapshot>>
	>,
) {
	const prefix = `destination-refund:${snapshot.chargeId}:`;
	const previous = await tx
		.select()
		.from(paymentLedger)
		.where(
			and(
				eq(paymentLedger.paymentId, payment.id),
				like(paymentLedger.operationKey, `${prefix}%`),
			),
		);
	for (const journal of previous) {
		const [gross, reversed, fee] = journal.operationKey
			.slice(prefix.length)
			.split(':')
			.map(Number);
		if (
			(gross ?? 0) > snapshot.refundedGross ||
			(reversed ?? 0) > snapshot.reversedGross ||
			(fee ?? 0) > snapshot.feeReturned
		)
			return;
	}
	const cash = snapshot.reversedGross - snapshot.feeReturned;
	const expected = cumulativeRefund(
		payment,
		snapshot.refundedGross,
	).recipientAmount;
	const complete = snapshot.reversedGross >= snapshot.refundedGross;
	const recovered =
		complete ? expected : Math.min(expected, Math.max(0, cash));
	const postedCash = previous.reduce(
		(sum, journal) =>
			sum +
			journal.lines
				.filter((line) => line.account === 'stripe_cash')
				.reduce((total, line) => total + line.amount, 0),
		0,
	);
	const postedRecovery = -previous.reduce(
		(sum, journal) =>
			sum +
			journal.lines
				.filter(
					(line) => line.account === 'recipient_refund_receivable',
				)
				.reduce((total, line) => total + line.amount, 0),
		0,
	);
	const cashDelta = cash - postedCash;
	const recoveredDelta = recovered - postedRecovery;
	if (cashDelta || recoveredDelta)
		await postJournal(tx, {
			operationKey: `${prefix}${snapshot.refundedGross}:${snapshot.reversedGross}:${snapshot.feeReturned}`,
			paymentId: payment.id,
			livemode: payment.livemode,
			lines: [
				{ account: 'stripe_cash', amount: cashDelta },
				{
					account: 'recipient_refund_receivable',
					amount: -recoveredDelta,
				},
				{
					account: 'refund_rounding_variance',
					amount: recoveredDelta - cashDelta,
				},
			],
		});
	if (!complete)
		await tx
			.insert(paymentCases)
			.values({
				key: `destination-refund-recovery:${snapshot.chargeId}`,
				paymentId: payment.id,
				category: 'transfer_recovery',
				summary:
					'A donor refund did not reverse all recipient funds. Platform exposure needs financial review.',
				stripeObjectId: snapshot.chargeId,
			})
			.onConflictDoUpdate({
				target: paymentCases.key,
				set: { resolvedAt: null },
			});
	else
		await tx
			.update(paymentCases)
			.set({ resolvedAt: new Date() })
			.where(
				eq(
					paymentCases.key,
					`destination-refund-recovery:${snapshot.chargeId}`,
				),
			);
}
