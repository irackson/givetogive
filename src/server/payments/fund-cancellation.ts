import 'server-only';
import type { Session } from 'next-auth';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import {
	paymentAccounts,
	paymentSubscriptions,
	payments,
} from '@/server/db/payments-schema';
import { requireBillingIdentity } from '@/server/security/authorization';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import { recordEvent } from '@/server/observability/events';
import { paymentConfiguration } from './config';
import { stripeClient } from './stripe';
import { assertEntitlementMutationAllowed } from './entitlement-time';
import { requirePortalConfigurationId } from './portal-policy';
import {
	fundCancellationInput,
	validateFundCancellationConfiguration,
	fundCancellationHandoff,
} from './fund-cancellation-policy';

export { fundCancellationInput } from './fund-cancellation-policy';
const unavailable = (
	message = 'Cancellation is unavailable until its dedicated billing policy is verified.',
) => new TRPCError({ code: 'PRECONDITION_FAILED', message });

/** Opens a hosted confirmation only; a signed subscription webhook establishes cancellation. */
export async function createFundCancellationPortal(
	identity: Session,
	raw: { subscriptionId: string },
	headers: Headers,
) {
	const { subscriptionId } = fundCancellationInput.parse(raw);
	const actorId = identity.user.id;
	await requireBillingIdentity(
		actorId,
		identity.user.sessionVersion,
		identity.access,
	);
	const config = paymentConfiguration();
	if (!config.configured) throw unavailable();
	const [owned] = await db
		.select({
			subscription: paymentSubscriptions,
			account: paymentAccounts,
			initial: payments,
		})
		.from(paymentSubscriptions)
		.innerJoin(
			paymentAccounts,
			and(
				eq(paymentAccounts.userId, paymentSubscriptions.actorId),
				eq(paymentAccounts.livemode, paymentSubscriptions.livemode),
			),
		)
		.innerJoin(
			payments,
			eq(payments.id, paymentSubscriptions.initialPaymentId),
		)
		.where(
			and(
				eq(paymentSubscriptions.id, subscriptionId),
				eq(paymentSubscriptions.actorId, actorId),
				eq(paymentSubscriptions.kind, 'fund'),
				eq(paymentSubscriptions.livemode, config.livemode),
			),
		);
	if (
		!owned ||
		owned.subscription.accountId !== owned.account.stripeAccountId ||
		owned.initial.actorId !== actorId ||
		owned.initial.livemode !== config.livemode ||
		owned.initial.kind !== 'fund' ||
		!owned.initial.recurring ||
		!owned.subscription.fundId ||
		owned.initial.fundId !== owned.subscription.fundId
	)
		throw new TRPCError({ code: 'NOT_FOUND' });
	if (
		owned.subscription.cancelAtPeriodEnd ||
		['canceled', 'incomplete_expired'].includes(owned.subscription.status)
	)
		throw unavailable(
			'This recurring gift is already ending or ended. Refresh its status.',
		);
	await assertEntitlementMutationAllowed(actorId);
	if (
		!(await recordRateLimitAttempt(
			'fund-cancel-portal',
			actorId,
			headers,
			16,
		))
	)
		throw new TRPCError({
			code: 'TOO_MANY_REQUESTS',
			message:
				'Please wait before opening another cancellation confirmation.',
		});
	let configurationId: string;
	const stripe = stripeClient();
	try {
		configurationId = requirePortalConfigurationId(
			process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'],
		);
		if (configurationId === process.env['STRIPE_PORTAL_CONFIGURATION_ID'])
			throw unavailable();
		validateFundCancellationConfiguration(
			await stripe.billingPortal.configurations.retrieve(configurationId),
			configurationId,
			config.livemode,
		);
	} catch {
		throw unavailable();
	}
	const provider = await stripe.subscriptions.retrieve(subscriptionId);
	if (
		provider.id !== subscriptionId ||
		provider.livemode !== config.livemode ||
		provider.customer_account !== owned.account.stripeAccountId
	)
		throw unavailable('The recurring gift ownership needs reconciliation.');
	if (
		!['active', 'past_due', 'unpaid', 'trialing'].includes(
			provider.status,
		) ||
		provider.cancel_at_period_end ||
		provider.cancel_at ||
		provider.schedule ||
		provider.pending_update
	)
		throw unavailable(
			'This recurring gift is already ending or needs billing review.',
		);
	// Recheck revocation after provider reads. No network call is made in a DB transaction.
	await requireBillingIdentity(
		actorId,
		identity.user.sessionVersion,
		identity.access,
	);
	const returnUrl = `${config.origin}/account/billing`;
	const portal = await stripe.billingPortal.sessions.create({
		customer_account: owned.account.stripeAccountId,
		configuration: configurationId,
		return_url: returnUrl,
		flow_data: {
			type: 'subscription_cancel',
			subscription_cancel: { subscription: subscriptionId },
			after_completion: {
				type: 'redirect',
				redirect: { return_url: returnUrl },
			},
		},
	});
	let handoff: ReturnType<typeof fundCancellationHandoff>;
	try {
		handoff = fundCancellationHandoff(portal, {
			accountId: owned.account.stripeAccountId,
			subscriptionId,
			configurationId,
			livemode: config.livemode,
			returnUrl,
		});
	} catch {
		throw unavailable(
			'The cancellation confirmation could not be verified. Please contact support.',
		);
	}
	await recordEvent({
		externalId: `fund-cancellation-portal:${handoff.id}`,
		actorId,
		entityType: 'subscription',
		entityId: subscriptionId,
		action: 'fund_cancellation_confirmation_opened',
		outcome: 'pending',
		summary:
			'Opened an owned cancellation-only confirmation. Cancellation is not confirmed until Stripe reconciliation.',
	});
	return { url: handoff.url };
}
