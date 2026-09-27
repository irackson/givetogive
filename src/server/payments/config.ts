import { TRPCError } from '@trpc/server';
import { SUPPORTER_TIERS, type FeePolicy } from './math.ts';
import { applicationEnvironment } from '../../lib/environment.ts';

function flag(name: string) {
	return process.env[name] === 'true';
}

export function paymentConfiguration() {
	const environment = applicationEnvironment();
	const key = process.env['STRIPE_SECRET_KEY'];
	const livemode = Boolean(key && /^[sr]k_live_/.test(key));
	const suppliedPublishableKey = process.env['STRIPE_PUBLISHABLE_KEY'];
	const publishableKey =
		(
			suppliedPublishableKey &&
			/^pk_(test|live)_[A-Za-z0-9]+$/.test(suppliedPublishableKey) &&
			suppliedPublishableKey.startsWith(
				livemode ? 'pk_live_' : 'pk_test_',
			)
		) ?
			suppliedPublishableKey
		:	null;
	// Never leak a secret accidentally placed in the publishable-key field.
	// Hosted Checkout does not require one, but a supplied key must match mode.
	const publishableSafe = !suppliedPublishableKey || Boolean(publishableKey);
	const modeSafe =
		environment === 'production' ?
			livemode && flag('STRIPE_LIVE_APPROVED')
		:	Boolean(key && /^[sr]k_test_/.test(key));
	const origin = process.env['APP_URL'] ?? 'http://localhost:3000';
	const url = new URL(origin);
	const originSafe =
		url.protocol === 'https:' ||
		(environment !== 'production' &&
			['localhost', '127.0.0.1'].includes(url.hostname));
	const processingBps = Number(process.env['STRIPE_PROCESSING_BPS']);
	const processingFixed = Number(
		process.env['STRIPE_PROCESSING_FIXED_CENTS'],
	);
	const feeReady =
		Boolean(
			process.env['STRIPE_PROCESSING_BPS']?.trim() &&
			process.env['STRIPE_PROCESSING_FIXED_CENTS']?.trim(),
		) &&
		Number.isSafeInteger(processingBps) &&
		processingBps >= 0 &&
		processingBps <= 5000 &&
		Number.isSafeInteger(processingFixed) &&
		processingFixed >= 0;
	const configured =
		modeSafe &&
		publishableSafe &&
		originSafe &&
		feeReady &&
		Boolean(process.env['STRIPE_PLATFORM_ACCOUNT_ID']);
	const feePolicy: FeePolicy = {
		version: `v1-500-${processingBps}-${processingFixed}`,
		platformBps: 500,
		processingBps,
		processingFixed,
	};
	return {
		environment,
		livemode,
		origin: url.origin,
		configured,
		askPayments: configured && flag('PAYMENTS_ENABLED'),
		subscriptions:
			configured &&
			flag('SUPPORTERS_ENABLED') &&
			Boolean(
				process.env['STRIPE_SUPPORTER_PRICE_ID'] &&
				process.env['STRIPE_SUSTAINER_PRICE_ID'],
			),
		funds: configured && flag('FUNDS_ENABLED'),
		platformAccountId: process.env['STRIPE_PLATFORM_ACCOUNT_ID'] ?? '',
		publishableKey,
		feePolicy,
	};
}

export function publicPaymentConfiguration() {
	const c = paymentConfiguration();
	return {
		environment: c.environment,
		livemode: c.livemode,
		enabled: c.askPayments || c.subscriptions || c.funds,
		askPayments: c.askPayments,
		subscriptions: c.subscriptions,
		// Stopping new sales must not prevent management of an existing plan.
		billingManagement: c.configured,
		// Syntax is only UI availability; every handoff verifies the provider policy.
		fundCancellation:
			c.configured &&
			/^bpc_[A-Za-z0-9]+$/.test(
				process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] ??
					'',
			) &&
			process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] !==
				process.env['STRIPE_PORTAL_CONFIGURATION_ID'],
		funds: c.funds,
		publishableKey: c.publishableKey,
		tiers: SUPPORTER_TIERS,
		feePolicy: c.configured ? c.feePolicy : null,
	};
}

export function requirePaymentFeature(kind: 'ask' | 'fund' | 'supporter') {
	const config = paymentConfiguration();
	if (
		!(kind === 'ask' ? config.askPayments
		: kind === 'fund' ? config.funds
		: config.subscriptions)
	)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'This payment experience is not enabled in this environment.',
		});
	return config;
}
