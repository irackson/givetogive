import { z } from 'zod';

const portalPolicy = z.object({
	id: z.string().regex(/^bpc_[a-zA-Z0-9]+$/),
	active: z.literal(true),
	livemode: z.boolean(),
	features: z.object({
		invoice_history: z.object({ enabled: z.literal(true) }),
		payment_method_update: z.object({ enabled: z.literal(true) }),
		subscription_cancel: z.object({
			enabled: z.literal(true),
			mode: z.literal('at_period_end'),
			proration_behavior: z.literal('none'),
		}),
		// Stripe's cross-product period-end downgrade limitation requires a
		// dedicated plan-change path. Never silently allow immediate downgrades.
		subscription_update: z.object({
			enabled: z.literal(false),
			default_allowed_updates: z.array(z.never()).max(0),
		}),
	}),
});

export function requirePortalConfigurationId(value: string | undefined) {
	if (!value || !/^bpc_[a-zA-Z0-9]+$/.test(value)) {
		throw new Error(
			'An explicit verified billing portal configuration is required.',
		);
	}
	return value;
}

/** A portal is billing/cancellation only until dedicated tier changes are ready. */
export function validatePortalConfiguration(
	candidate: unknown,
	expectedId: string,
	livemode: boolean,
) {
	const parsed = portalPolicy.safeParse(candidate);
	if (
		!parsed.success ||
		parsed.data.id !== expectedId ||
		parsed.data.livemode !== livemode
	) {
		throw new Error(
			'Billing portal policy is unavailable or does not match the required billing and period-end cancellation rules.',
		);
	}
	return parsed.data.id;
}
