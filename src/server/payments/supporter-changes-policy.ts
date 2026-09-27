import { createHash } from 'node:crypto';
import { z } from 'zod';

export const supporterChangeInput = z
	.object({
		operationId: z.uuid(),
		subscriptionId: z
			.string()
			.regex(/^sub_[A-Za-z0-9_]+$/)
			.max(255),
		action: z.enum(['upgrade', 'downgrade', 'undo', 'cancel', 'resume']),
		expectedRevision: z.number().int().nonnegative(),
		targetOperationId: z.uuid().optional(),
	})
	.strict();
export type SupporterChangeInput = z.infer<typeof supporterChangeInput>;
export type SupporterChangeAction = SupporterChangeInput['action'];

const id = (value: unknown): string | null =>
	typeof value === 'string' ? value
	: (
		value &&
		typeof value === 'object' &&
		'id' in value &&
		typeof value.id === 'string'
	) ?
		value.id
	:	null;
const priceSchema = z.object({
	id: z.string(),
	active: z.literal(true),
	livemode: z.boolean(),
	currency: z.literal('usd'),
	type: z.literal('recurring'),
	billing_scheme: z.literal('per_unit'),
	unit_amount: z.number().int(),
	product: z.unknown(),
	recurring: z.object({
		interval: z.literal('month'),
		interval_count: z.literal(1),
		usage_type: z.literal('licensed'),
	}),
	transform_quantity: z.null().optional(),
	tiers_mode: z.null().optional(),
});
export function supporterPrice(
	candidate: unknown,
	expectedId: string,
	amount: 500 | 1500,
	livemode: boolean,
) {
	const price = priceSchema.parse(candidate);
	const productId = id(price.product);
	if (
		price.id !== expectedId ||
		price.unit_amount !== amount ||
		price.livemode !== livemode ||
		!productId
	)
		throw new Error(
			'The configured supporter price is not an eligible fixed USD monthly price.',
		);
	return { id: price.id, amount, productId };
}

const itemSchema = z.object({
	id: z.string(),
	quantity: z.literal(1),
	current_period_start: z.number().int(),
	current_period_end: z.number().int(),
	price: z.unknown(),
	discounts: z.array(z.unknown()).default([]),
	tax_rates: z.array(z.unknown()).default([]),
	billing_thresholds: z.unknown().nullish(),
});
const subscriptionSchema = z.object({
	id: z.string(),
	livemode: z.boolean(),
	customer_account: z.string(),
	status: z.enum(['active', 'past_due', 'unpaid']),
	collection_method: z.literal('charge_automatically'),
	currency: z.literal('usd'),
	items: z.object({
		data: z.array(itemSchema).length(1),
		has_more: z.literal(false),
	}),
	cancel_at_period_end: z.boolean(),
	cancel_at: z.number().int().nullish(),
	latest_invoice: z.unknown(),
	schedule: z.unknown().nullish(),
	pending_update: z.unknown().nullish(),
	automatic_tax: z.object({ enabled: z.literal(false) }),
	discounts: z.array(z.unknown()).default([]),
	default_tax_rates: z.array(z.unknown()).default([]),
	pause_collection: z.unknown().nullish(),
	trial_end: z.number().int().nullish(),
	billing_thresholds: z.unknown().nullish(),
	pending_invoice_item_interval: z.unknown().nullish(),
	application_fee_percent: z.number().nullish(),
	transfer_data: z.unknown().nullish(),
	on_behalf_of: z.unknown().nullish(),
	default_payment_method: z.unknown().nullish(),
});

export type SupporterState = {
	id: string;
	accountId: string;
	itemId: string;
	priceId: string;
	productId: string;
	status: 'active' | 'past_due' | 'unpaid';
	tier: 'supporter' | 'sustainer';
	periodStart: number;
	periodEnd: number;
	cancelAtPeriodEnd: boolean;
	cancelAt: number | null;
	invoiceId: string;
	scheduleId: string | null;
	pendingUpdate: boolean;
	defaultPaymentMethodId: string | null;
	fingerprint: string;
};

/** Reject unsupported billing settings rather than dropping taxes/discounts while rebuilding a schedule. */
export function supporterState(
	candidate: unknown,
	expected: {
		subscriptionId: string;
		accountId: string;
		livemode: boolean;
		supporterPriceId: string;
		sustainerPriceId: string;
		asOf: number;
		ownedScheduleId?: string | null;
		allowPending?: boolean;
		allowUnpaidManagement?: boolean;
	},
): SupporterState {
	const sub = subscriptionSchema.parse(candidate);
	if (sub.status !== 'active' && !expected.allowUnpaidManagement)
		throw new Error(
			'Resolve the unpaid subscription before changing its tier.',
		);
	const item = sub.items.data[0]!;
	const priceId = id(item.price);
	const tier =
		priceId === expected.supporterPriceId ? 'supporter'
		: priceId === expected.sustainerPriceId ? 'sustainer'
		: null;
	if (
		!tier ||
		sub.id !== expected.subscriptionId ||
		sub.customer_account !== expected.accountId ||
		sub.livemode !== expected.livemode
	)
		throw new Error(
			'Subscription ownership, environment, or configured tier does not match.',
		);
	const price = supporterPrice(
		item.price,
		priceId!,
		tier === 'supporter' ? 500 : 1500,
		expected.livemode,
	);
	if (
		item.current_period_start > expected.asOf ||
		item.current_period_end <= expected.asOf ||
		item.current_period_start >= item.current_period_end
	)
		throw new Error(
			'The current subscription period needs reconciliation before another change.',
		);
	if (
		sub.discounts.length ||
		sub.default_tax_rates.length ||
		item.discounts.length ||
		item.tax_rates.length ||
		sub.pause_collection ||
		sub.billing_thresholds ||
		item.billing_thresholds ||
		sub.pending_invoice_item_interval ||
		sub.application_fee_percent ||
		sub.transfer_data ||
		sub.on_behalf_of ||
		(sub.trial_end && sub.trial_end > expected.asOf)
	)
		throw new Error(
			'Unsupported subscription adjustments require billing review before making changes.',
		);
	const scheduleId = id(sub.schedule);
	if (scheduleId && scheduleId !== expected.ownedScheduleId)
		throw new Error(
			'An externally managed schedule cannot be overwritten.',
		);
	if (sub.pending_update && !expected.allowPending)
		throw new Error('Resolve the pending upgrade before another change.');
	if (sub.cancel_at && sub.cancel_at !== item.current_period_end)
		throw new Error('A custom cancellation date requires billing review.');
	const invoiceId = id(sub.latest_invoice);
	if (!invoiceId) throw new Error('A verified current invoice is required.');
	const state: Omit<SupporterState, 'fingerprint'> = {
		id: sub.id,
		accountId: sub.customer_account,
		itemId: item.id,
		priceId: priceId!,
		productId: price.productId,
		status: sub.status,
		tier,
		periodStart: item.current_period_start,
		periodEnd: item.current_period_end,
		cancelAtPeriodEnd: sub.cancel_at_period_end,
		cancelAt: sub.cancel_at ?? null,
		invoiceId,
		scheduleId,
		pendingUpdate: Boolean(sub.pending_update),
		defaultPaymentMethodId: id(sub.default_payment_method),
	};
	return { ...state, fingerprint: changeHash(state) };
}

export function changeHash(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertChangeAction(
	action: SupporterChangeAction,
	state: SupporterState,
	target?: { action: string; status: string },
) {
	if (action === 'upgrade' || action === 'downgrade') {
		if (
			state.cancelAtPeriodEnd ||
			state.cancelAt ||
			state.scheduleId ||
			state.pendingUpdate ||
			target
		)
			throw new Error(
				'Undo the pending change or resume the subscription before changing its tier.',
			);
		if (state.tier !== (action === 'upgrade' ? 'supporter' : 'sustainer'))
			throw new Error('This tier change is not applicable.');
	}
	if (
		action === 'undo' &&
		(!target || !['scheduled', 'pending_payment'].includes(target.status))
	)
		throw new Error('There is no owned pending change to undo.');
	if (
		action === 'cancel' &&
		(state.pendingUpdate ||
			state.cancelAtPeriodEnd ||
			state.cancelAt ||
			target?.action === 'cancel')
	)
		throw new Error(
			'Resolve a pending upgrade or existing cancellation first.',
		);
	if (
		action === 'resume' &&
		((!state.cancelAtPeriodEnd &&
			!state.cancelAt &&
			target?.action !== 'cancel') ||
			state.pendingUpdate)
	)
		throw new Error('There is no resumable period-end cancellation.');
}

export function validateUpgradePreview(
	candidate: unknown,
	expected: {
		accountId: string;
		subscriptionId: string;
		livemode: boolean;
		itemId: string;
		sourcePriceId: string;
		targetPriceId: string;
		prorationDate: number;
		periodEnd: number;
	},
) {
	const invoice = z
		.object({
			currency: z.literal('usd'),
			livemode: z.boolean(),
			customer_account: z.string(),
			amount_due: z.number().int().positive().max(1000),
			total: z.number().int(),
			total_discount_amounts: z.array(z.unknown()).nullish(),
			total_taxes: z.array(z.unknown()).nullish(),
			parent: z.object({
				subscription_details: z.object({ subscription: z.unknown() }),
			}),
			lines: z.object({
				has_more: z.literal(false),
				data: z
					.array(
						z.object({
							amount: z.number().int(),
							currency: z.literal('usd'),
							period: z.object({
								start: z.number().int(),
								end: z.number().int(),
							}),
							pricing: z.object({
								price_details: z.object({ price: z.unknown() }),
							}),
							parent: z.object({
								type: z.literal('subscription_item_details'),
								subscription_item_details: z.object({
									subscription_item: z.string(),
									proration: z.literal(true),
								}),
							}),
						}),
					)
					.length(2),
			}),
		})
		.parse(candidate);
	if (
		invoice.customer_account !== expected.accountId ||
		invoice.livemode !== expected.livemode ||
		id(invoice.parent.subscription_details.subscription) !==
			expected.subscriptionId ||
		invoice.amount_due !== invoice.total ||
		invoice.total_discount_amounts?.length ||
		invoice.total_taxes?.length
	)
		throw new Error(
			'Preview includes unsupported credits, taxes, discounts, or ownership.',
		);
	const oldLine = invoice.lines.data.find(
		(line) =>
			id(line.pricing.price_details.price) === expected.sourcePriceId &&
			line.amount < 0,
	);
	const newLine = invoice.lines.data.find(
		(line) =>
			id(line.pricing.price_details.price) === expected.targetPriceId &&
			line.amount > 0,
	);
	if (
		!oldLine ||
		!newLine ||
		oldLine.amount + newLine.amount !== invoice.amount_due ||
		invoice.lines.data.some(
			(line) =>
				line.parent.subscription_item_details.subscription_item !==
					expected.itemId ||
				line.period.start !== expected.prorationDate ||
				line.period.end !== expected.periodEnd,
		)
	)
		throw new Error(
			'The preview is not the exact current-item prorated upgrade.',
		);
	return invoice.amount_due;
}

export function retryWithinProviderWindow(
	startedAt: Date | null,
	now = Date.now(),
) {
	return !startedAt || now - startedAt.getTime() < 23 * 60 * 60_000;
}

export function invoiceHandoff(value: string | null | undefined) {
	if (!value) return null;
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'invoice.stripe.com' ||
		url.username ||
		url.password
	)
		throw new Error('The verified invoice has an unexpected hosted URL.');
	return url.href;
}

/** Pending updates eligibility, not a payment-method allowlist sent to Stripe. */
export function pendingUpdatePaymentMethod(type: string) {
	return new Set([
		'card',
		'link',
		'alipay',
		'amazon_pay',
		'afterpay_clearpay',
		'cashapp',
		'eps',
		'gopay',
		'kakao_pay',
		'klarna',
		'kr_card',
		'naver_pay',
		'ng_card',
		'paypal',
		'payto',
		'pix',
		'promptpay',
		'revolut_pay',
		'satispay',
		'crypto',
		'swish',
		'twint',
		'upi',
		'wechat_pay',
	]).has(type);
}

export function validateOwnedSchedule(
	candidate: unknown,
	expected: {
		id: string;
		subscriptionId: string;
		accountId: string;
		livemode: boolean;
	},
) {
	const schedule = z
		.object({
			id: z.string(),
			livemode: z.boolean(),
			customer_account: z.string(),
			subscription: z.unknown().nullish(),
			released_subscription: z.unknown().nullish(),
			status: z.enum([
				'not_started',
				'active',
				'released',
				'completed',
				'canceled',
			]),
			end_behavior: z.enum(['release', 'cancel', 'renew', 'none']),
			phases: z.array(
				z.object({
					start_date: z.number().int(),
					end_date: z.number().int(),
					items: z
						.array(
							z.object({
								price: z.unknown(),
								quantity: z.literal(1),
								discounts: z
									.array(z.unknown())
									.max(0)
									.default([]),
								tax_rates: z
									.array(z.unknown())
									.max(0)
									.nullish(),
								billing_thresholds: z.null().optional(),
								metadata: z
									.record(z.string(), z.string())
									.nullish(),
							}),
						)
						.length(1),
					discounts: z.array(z.unknown()).max(0).default([]),
					add_invoice_items: z.array(z.unknown()).max(0).default([]),
					default_tax_rates: z.array(z.unknown()).max(0).nullish(),
					automatic_tax: z
						.object({ enabled: z.literal(false) })
						.optional(),
					application_fee_percent: z
						.union([z.literal(0), z.null()])
						.optional(),
					billing_thresholds: z.null().optional(),
					transfer_data: z.null().optional(),
					on_behalf_of: z.null().optional(),
					collection_method: z
						.literal('charge_automatically')
						.nullish(),
					currency: z.literal('usd').optional(),
					billing_cycle_anchor: z.literal('automatic').nullish(),
					trial: z.literal(false).optional(),
					trial_end: z.null().optional(),
					invoice_settings: z.null().optional(),
					default_payment_method: z.unknown().nullish(),
					metadata: z.record(z.string(), z.string()).nullish(),
					description: z.string().nullish(),
				}),
			),
		})
		.parse(candidate);
	if (
		schedule.id !== expected.id ||
		schedule.livemode !== expected.livemode ||
		schedule.customer_account !== expected.accountId ||
		(id(schedule.subscription) !== expected.subscriptionId &&
			id(schedule.released_subscription) !== expected.subscriptionId)
	)
		throw new Error('Schedule ownership or environment does not match.');
	return schedule;
}

export function scheduleMatchesPlan(
	candidate: ReturnType<typeof validateOwnedSchedule>,
	expected: {
		action: 'downgrade' | 'cancel';
		sourcePriceId: string;
		targetPriceId: string | null;
		periodEnd: number;
	},
) {
	const phase = candidate.phases.find(
		(entry) => entry.end_date === expected.periodEnd,
	);
	if (
		candidate.status !== 'active' ||
		!phase ||
		id(phase.items[0]!.price) !== expected.sourcePriceId
	)
		return false;
	if (expected.action === 'cancel')
		return (
			candidate.end_behavior === 'cancel' &&
			candidate.phases.length === 1 &&
			candidate.phases.at(-1)?.end_date === expected.periodEnd
		);
	const next = candidate.phases.find(
		(entry) => entry.start_date === expected.periodEnd,
	);
	return (
		candidate.end_behavior === 'release' &&
		candidate.phases.length === 2 &&
		Boolean(next && id(next.items[0]!.price) === expected.targetPriceId)
	);
}
