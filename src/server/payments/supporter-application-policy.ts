import type Stripe from 'stripe';
import { z } from 'zod';

const identifier = (prefix: string) =>
	z
		.string()
		.regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`))
		.max(255);
const seconds = z
	.number()
	.int()
	.nonnegative()
	.refine((n) => Number.isFinite(new Date(n * 1000).getTime()));
const snapshotSchema = z.object({
	id: identifier('sub'),
	object: z.literal('subscription'),
	customer_account: identifier('acct'),
	livemode: z.boolean(),
	pending_update: z.null(),
	latest_invoice: z.union([
		identifier('in'),
		z.object({ id: identifier('in') }),
	]),
	items: z.object({
		has_more: z.literal(false),
		data: z
			.array(
				z.object({
					id: identifier('si'),
					subscription: identifier('sub'),
					quantity: z.literal(1),
					current_period_start: seconds,
					current_period_end: seconds,
					price: z.object({
						id: identifier('price'),
						livemode: z.boolean(),
						currency: z.literal('usd'),
						type: z.literal('recurring'),
						recurring: z.object({
							interval: z.literal('month'),
							interval_count: z.literal(1),
							usage_type: z.literal('licensed'),
						}),
					}),
				}),
			)
			.length(1),
	}),
});

export type ApplicationOwner = {
	actorId: string;
	subscriptionId: string;
	accountId: string;
	livemode: boolean;
};
export type SupporterApplicationProof = ApplicationOwner & {
	stripeEventId: string;
	platformAccountId: string;
	invoiceId: string;
	itemId: string;
	priceId: string;
	periodStart: Date;
	periodEnd: Date;
	providerCreatedAt: Date;
};

/** Only establishes which local ownership record to look up, never ownership itself. */
export function applicationSubscriptionId(event: Stripe.Event) {
	if (event.type !== 'customer.subscription.pending_update_applied')
		return null;
	const result = z
		.object({ id: identifier('sub') })
		.safeParse(event.data.object);
	return result.success ? result.data.id : null;
}

/** Called only with a verified Stripe event and a first-class local ownership mapping.
 * Metadata, current subscription price, and current invoice are deliberately irrelevant. */
export function applicationProofFromEvent(
	event: Stripe.Event,
	owner: ApplicationOwner,
	platformAccountId: string,
): SupporterApplicationProof {
	if (
		event.type !== 'customer.subscription.pending_update_applied' ||
		!identifier('evt').safeParse(event.id).success ||
		!identifier('acct').safeParse(platformAccountId).success ||
		event.livemode !== owner.livemode ||
		(event.account !== undefined && event.account !== platformAccountId) ||
		!seconds.safeParse(event.created).success
	)
		throw new Error('Supporter application event authority mismatch.');
	const parsed = snapshotSchema.safeParse(event.data.object);
	if (!parsed.success)
		throw new Error('Unsupported supporter application snapshot.');
	const snapshot = parsed.data;
	const item = snapshot.items.data[0]!;
	if (
		snapshot.id !== owner.subscriptionId ||
		snapshot.customer_account !== owner.accountId ||
		snapshot.livemode !== owner.livemode ||
		item.subscription !== owner.subscriptionId ||
		item.price.livemode !== owner.livemode ||
		item.current_period_start >= item.current_period_end
	)
		throw new Error(
			'Supporter application ownership or item-period mismatch.',
		);
	return {
		...owner,
		stripeEventId: event.id,
		platformAccountId,
		invoiceId:
			typeof snapshot.latest_invoice === 'string' ?
				snapshot.latest_invoice
			:	snapshot.latest_invoice.id,
		itemId: item.id,
		priceId: item.price.id,
		periodStart: new Date(item.current_period_start * 1000),
		periodEnd: new Date(item.current_period_end * 1000),
		providerCreatedAt: new Date(event.created * 1000),
	};
}

export type ApplicationInvoiceLine = {
	invoiceLineId: string;
	itemId: string;
	priceId: string;
	periodStart: Date;
	periodEnd: Date;
	proration: boolean;
};

export function applicationProvesLine(
	proof: SupporterApplicationProof,
	line: ApplicationInvoiceLine,
) {
	// A proration starts inside the item's billing interval, not at its original start.
	// The enclosing lookup has already matched invoice/account/subscription/mode.
	return (
		line.proration &&
		Boolean(line.invoiceLineId) &&
		proof.itemId === line.itemId &&
		proof.priceId === line.priceId &&
		Number.isFinite(line.periodStart.getTime()) &&
		line.periodStart >= proof.periodStart &&
		line.periodStart < line.periodEnd &&
		line.periodEnd.getTime() === proof.periodEnd.getTime()
	);
}

export function sameApplicationProof(
	a: SupporterApplicationProof,
	b: SupporterApplicationProof,
) {
	return (
		a.stripeEventId === b.stripeEventId &&
		a.livemode === b.livemode &&
		a.platformAccountId === b.platformAccountId &&
		a.actorId === b.actorId &&
		a.accountId === b.accountId &&
		a.subscriptionId === b.subscriptionId &&
		a.invoiceId === b.invoiceId &&
		a.itemId === b.itemId &&
		a.priceId === b.priceId &&
		a.periodStart.getTime() === b.periodStart.getTime() &&
		a.periodEnd.getTime() === b.periodEnd.getTime() &&
		a.providerCreatedAt.getTime() === b.providerCreatedAt.getTime()
	);
}
