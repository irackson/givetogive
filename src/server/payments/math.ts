export type FeePolicy = {
	version: string;
	platformBps: number;
	processingBps: number;
	processingFixed: number;
};
export const SUPPORTER_TIERS = {
	supporter: { name: 'Supporter', amount: 500, interval: 'month' as const },
	sustainer: { name: 'Sustainer', amount: 1500, interval: 'month' as const },
};
export const MAX_PAYMENT_CENTS = 100_000_000;

export function selectPaidSubscriptionLine<
	T extends {
		amount: number;
		period: { end: number };
		parent?: { type: string } | null;
		pricing?: {
			price_details?: { price: string | { id: string } } | null;
		} | null;
	},
>(lines: readonly T[], currentPriceId: string | null) {
	const eligible = lines.filter(
		(line) =>
			line.amount > 0 &&
			line.parent?.type === 'subscription_item_details',
	);
	return (
		eligible.find((line) => {
			const price = line.pricing?.price_details?.price;
			return (
				(typeof price === 'string' ? price : price?.id) ===
				currentPriceId
			);
		}) ?? eligible.sort((a, b) => b.period.end - a.period.end)[0]
	);
}

/** Only provider-verified paid-through coverage grants a badge, never raw active status. */
export function recognizedSupporterTier(
	subscriptions: readonly {
		kind: string;
		tier: string | null;
		paidThrough: Date | null;
		status: string;
	}[],
	now = new Date(),
): 'neighbor' | 'supporter' | 'sustainer' {
	const eligible = subscriptions.filter(
		(subscription) =>
			subscription.kind === 'supporter' &&
			subscription.paidThrough &&
			subscription.paidThrough > now &&
			!['incomplete', 'incomplete_expired', 'paused'].includes(
				subscription.status,
			),
	);
	if (eligible.some((subscription) => subscription.tier === 'sustainer'))
		return 'sustainer';
	return eligible.some((subscription) => subscription.tier === 'supporter') ?
			'supporter'
		:	'neighbor';
}

export function assertMinorUnits(value: number, allowZero = false): void {
	if (
		!Number.isSafeInteger(value) ||
		value < (allowZero ? 0 : 1) ||
		value > MAX_PAYMENT_CENTS
	)
		throw new Error('Use a valid integer amount in cents.');
}

export function quotePayment(grossAmount: number, policy: FeePolicy) {
	assertMinorUnits(grossAmount);
	for (const value of [
		policy.platformBps,
		policy.processingBps,
		policy.processingFixed,
	])
		assertMinorUnits(value, true);
	if (policy.platformBps !== 500 || policy.processingBps > 5000)
		throw new Error('Invalid fee policy.');
	const platformFee = Math.round((grossAmount * policy.platformBps) / 10_000);
	const processingEstimate =
		Math.round((grossAmount * policy.processingBps) / 10_000) +
		policy.processingFixed;
	const recipientAmount = grossAmount - platformFee - processingEstimate;
	if (grossAmount < 100 || recipientAmount <= 0)
		throw new Error(
			'The contribution must be at least $1 and cover its fees.',
		);
	return {
		grossAmount,
		platformFee,
		processingEstimate,
		recipientAmount,
		currency: 'usd' as const,
		version: policy.version,
	};
}

/** Cumulative rounding makes partial refunds add up exactly to the frozen quote. */
export function cumulativeRefund(
	original: {
		grossAmount: number;
		recipientAmount: number;
		platformFee: number;
		processingEstimate: number;
	},
	totalRefunded: number,
) {
	assertMinorUnits(totalRefunded, true);
	if (totalRefunded > original.grossAmount)
		throw new Error('Refund exceeds payment.');
	const recipientAmount = Math.round(
		(original.recipientAmount * totalRefunded) / original.grossAmount,
	);
	const platformFee = Math.min(
		totalRefunded - recipientAmount,
		Math.round(
			(original.platformFee * totalRefunded) / original.grossAmount,
		),
	);
	return {
		recipientAmount,
		platformFee,
		processingEstimate: totalRefunded - recipientAmount - platformFee,
	};
}

export function assertBalancedJournal(
	lines: { account: string; amount: number }[],
) {
	if (
		lines.length < 2 ||
		lines.some(
			(line) => !line.account || !Number.isSafeInteger(line.amount),
		)
	)
		throw new Error('Invalid ledger journal.');
	const total = lines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
	if (total !== 0n) throw new Error('Unbalanced ledger journal.');
}

export function netVerifiedFunding(payment: {
	recipientAmount: number;
	refundedRecipientAmount: number;
	disputedAmount: number;
	status: string;
}) {
	if (
		!['succeeded', 'partially_refunded', 'refunded', 'disputed'].includes(
			payment.status,
		)
	)
		return 0;
	return Math.max(
		0,
		payment.recipientAmount -
			payment.refundedRecipientAmount -
			payment.disputedAmount,
	);
}
