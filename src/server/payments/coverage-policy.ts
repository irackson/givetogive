export type SupporterTier = 'supporter' | 'sustainer';
export type VerifiedCoverageLine = {
	invoiceLineId: string;
	invoiceId: string;
	subscriptionId: string;
	itemId: string;
	livemode: boolean;
	priceId: string;
	tier: SupporterTier;
	periodStart: Date;
	periodEnd: Date;
	proration: boolean;
};

type InvoiceLine = {
	id: string;
	invoice: string | null;
	livemode: boolean;
	currency: string;
	amount: number;
	period: { start: number; end: number };
	parent: {
		type: string;
		subscription_item_details?: {
			subscription: string | { id: string } | null;
			subscription_item: string | null;
			proration: boolean;
		} | null;
	} | null;
	pricing: {
		price_details?: { price: string | { id: string } } | null;
	} | null;
};
const idOf = (value: string | { id: string } | null | undefined) =>
	typeof value === 'string' ? value : value?.id;

/** Historical entitlement comes from the invoice's own price and service dates,
 * never from whatever price the subscription happens to have today. */
export function verifiedSupporterLines(
	lines: readonly InvoiceLine[],
	input: {
		invoiceId: string;
		subscriptionId: string;
		livemode: boolean;
		supporterPriceId: string | undefined;
		sustainerPriceId: string | undefined;
	},
): VerifiedCoverageLine[] {
	if (
		!input.supporterPriceId ||
		!input.sustainerPriceId ||
		input.supporterPriceId === input.sustainerPriceId
	)
		throw new Error('Supporter prices are not configured distinctly.');
	const coverage: VerifiedCoverageLine[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		if (!Number.isSafeInteger(line.amount))
			throw new Error('Invalid invoice line amount.');
		// Credits reduce the invoice total but never independently create access.
		if (line.amount <= 0) continue;
		const details = line.parent?.subscription_item_details;
		const priceId = idOf(line.pricing?.price_details?.price);
		if (
			line.invoice !== input.invoiceId ||
			line.livemode !== input.livemode ||
			line.currency !== 'usd' ||
			line.parent?.type !== 'subscription_item_details' ||
			!details ||
			!details.subscription_item ||
			idOf(details.subscription) !== input.subscriptionId ||
			!priceId ||
			![input.supporterPriceId, input.sustainerPriceId].includes(
				priceId,
			) ||
			!line.id ||
			seen.has(line.id) ||
			!Number.isSafeInteger(line.period.start) ||
			!Number.isSafeInteger(line.period.end) ||
			line.period.start < 0 ||
			line.period.start >= line.period.end ||
			!Number.isFinite(new Date(line.period.end * 1000).getTime())
		)
			throw new Error('Unsupported supporter invoice coverage.');
		seen.add(line.id);
		coverage.push({
			invoiceLineId: line.id,
			invoiceId: input.invoiceId,
			subscriptionId: input.subscriptionId,
			itemId: details.subscription_item,
			livemode: input.livemode,
			priceId,
			tier:
				priceId === input.sustainerPriceId ? 'sustainer' : 'supporter',
			periodStart: new Date(line.period.start * 1000),
			periodEnd: new Date(line.period.end * 1000),
			proration: details.proration,
		});
	}
	if (!coverage.length)
		throw new Error('No positive supporter coverage found.');
	return coverage;
}

export function tierFromCoverage(
	rows: readonly {
		tier: SupporterTier;
		periodStart: Date;
		periodEnd: Date;
	}[],
	asOf: Date,
): 'neighbor' | SupporterTier {
	const current = rows.filter(
		(row) => row.periodStart <= asOf && asOf < row.periodEnd,
	);
	if (current.some((row) => row.tier === 'sustainer')) return 'sustainer';
	return current.some((row) => row.tier === 'supporter') ? 'supporter' : (
			'neighbor'
		);
}
