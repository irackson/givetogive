import { z } from 'zod';

export const fundCancellationInput = z
	.object({
		subscriptionId: z
			.string()
			.regex(/^sub_[A-Za-z0-9_]+$/)
			.max(255),
	})
	.strict();

const cancelOnlyConfiguration = z.object({
	id: z.string().regex(/^bpc_[A-Za-z0-9]+$/),
	active: z.literal(true),
	livemode: z.boolean(),
	login_page: z.object({ enabled: z.literal(false) }),
	features: z
		.object({
			customer_update: z.object({
				enabled: z.literal(false),
				allowed_updates: z.array(z.never()).max(0),
			}),
			invoice_history: z.object({ enabled: z.literal(false) }),
			payment_method_update: z.object({ enabled: z.literal(false) }),
			subscription_pause: z.object({ enabled: z.literal(false) }),
			subscription_update: z.object({
				enabled: z.literal(false),
				default_allowed_updates: z.array(z.never()).max(0),
			}),
			subscription_cancel: z.object({
				enabled: z.literal(true),
				mode: z.literal('at_period_end'),
				proration_behavior: z.literal('none'),
			}),
		})
		.strict(),
});

/** Hiding Portal navigation is not the authority boundary: every other feature is disabled. */
export function validateFundCancellationConfiguration(
	candidate: unknown,
	expectedId: string,
	livemode: boolean,
) {
	const parsed = cancelOnlyConfiguration.safeParse(candidate);
	if (
		!parsed.success ||
		parsed.data.id !== expectedId ||
		parsed.data.livemode !== livemode
	)
		throw new Error(
			'The dedicated cancellation-only billing configuration requires review.',
		);
	return parsed.data.id;
}

const objectId = (value: unknown) =>
	typeof value === 'string' ? value
	: (
		value &&
		typeof value === 'object' &&
		'id' in value &&
		typeof value.id === 'string'
	) ?
		value.id
	:	null;

/** Only the requested, owned subscription's cancellation flow may leave the server. */
export function fundCancellationHandoff(
	candidate: unknown,
	expected: {
		accountId: string;
		subscriptionId: string;
		configurationId: string;
		livemode: boolean;
		returnUrl: string;
	},
) {
	const result = z
		.object({
			id: z.string().regex(/^bps_[A-Za-z0-9_]+$/),
			customer_account: z.string(),
			configuration: z.unknown(),
			livemode: z.boolean(),
			return_url: z.string(),
			url: z.string(),
			flow: z.object({
				type: z.literal('subscription_cancel'),
				subscription_cancel: z.object({
					subscription: z.string(),
					retention: z.null(),
				}),
				after_completion: z.object({
					type: z.literal('redirect'),
					redirect: z.object({ return_url: z.string() }),
				}),
			}),
		})
		.parse(candidate);
	const url = new URL(result.url);
	if (
		result.customer_account !== expected.accountId ||
		objectId(result.configuration) !== expected.configurationId ||
		result.livemode !== expected.livemode ||
		result.return_url !== expected.returnUrl ||
		result.flow.subscription_cancel.subscription !==
			expected.subscriptionId ||
		result.flow.after_completion.redirect.return_url !==
			expected.returnUrl ||
		url.protocol !== 'https:' ||
		url.hostname !== 'billing.stripe.com' ||
		url.port ||
		url.username ||
		url.password
	)
		throw new Error('The cancellation handoff could not be verified.');
	return { id: result.id, url: result.url };
}
