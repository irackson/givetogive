import assert from 'node:assert/strict';
import test from 'node:test';
import {
	fundCancellationInput,
	fundCancellationHandoff,
	validateFundCancellationConfiguration,
} from '../../src/server/payments/fund-cancellation-policy.ts';

const policy = {
	id: 'bpc_ciCancelOnly',
	active: true,
	livemode: false,
	login_page: { enabled: false },
	features: {
		customer_update: { enabled: false, allowed_updates: [] },
		invoice_history: { enabled: false },
		payment_method_update: { enabled: false },
		subscription_pause: { enabled: false },
		subscription_update: { enabled: false, default_allowed_updates: [] },
		subscription_cancel: {
			enabled: true,
			mode: 'at_period_end',
			proration_behavior: 'none',
		},
	},
};
const expected = {
	accountId: 'acct_ciOwner',
	subscriptionId: 'sub_ciFund',
	configurationId: policy.id,
	livemode: false,
	returnUrl: 'https://givetogive-staging.vercel.app/account/billing',
};
const session = {
	id: 'bps_ciCancelOnly',
	customer_account: expected.accountId,
	configuration: policy.id,
	livemode: false,
	return_url: expected.returnUrl,
	url: 'https://billing.stripe.com/p/session/test_synthetic',
	flow: {
		type: 'subscription_cancel',
		subscription_cancel: {
			subscription: expected.subscriptionId,
			retention: null,
		},
		after_completion: {
			type: 'redirect',
			redirect: { return_url: expected.returnUrl },
		},
	},
};

test('dedicated configuration permits cancellation only, including real subscription_pause feature', () => {
	assert.equal(
		validateFundCancellationConfiguration(policy, policy.id, false),
		policy.id,
	);
	for (const feature of [
		'customer_update',
		'invoice_history',
		'payment_method_update',
		'subscription_pause',
		'subscription_update',
	] as const) {
		const unsafe = structuredClone(policy);
		unsafe.features[feature].enabled = true;
		assert.throws(() =>
			validateFundCancellationConfiguration(unsafe, policy.id, false),
		);
	}
	for (const unsafe of [
		{ ...policy, active: false },
		{ ...policy, livemode: true },
		{ ...policy, id: 'bpc_other' },
		{ ...policy, login_page: { enabled: true } },
		{
			...policy,
			features: { ...policy.features, future_feature: { enabled: true } },
		},
		{
			...policy,
			features: { ...policy.features, subscription_pause: undefined },
		},
		...[
			{
				enabled: false,
				mode: 'at_period_end',
				proration_behavior: 'none',
			},
			{ enabled: true, mode: 'immediately', proration_behavior: 'none' },
			{
				enabled: true,
				mode: 'at_period_end',
				proration_behavior: 'create_prorations',
			},
		].map((subscription_cancel) => ({
			...policy,
			features: { ...policy.features, subscription_cancel },
		})),
	])
		assert.throws(() =>
			validateFundCancellationConfiguration(unsafe, policy.id, false),
		);
});

test('handoff binds account, configuration, mode, exact subscription, redirect and trusted host', () => {
	assert.deepEqual(fundCancellationHandoff(session, expected), {
		id: session.id,
		url: session.url,
	});
	assert.equal(
		fundCancellationHandoff(
			{ ...session, configuration: { id: policy.id } },
			expected,
		).id,
		session.id,
	);
	for (const unsafe of [
		{ ...session, customer_account: 'acct_other' },
		{ ...session, configuration: 'bpc_other' },
		{ ...session, livemode: true },
		{ ...session, return_url: 'https://other.invalid' },
		{
			...session,
			flow: { ...session.flow, type: 'payment_method_update' },
		},
		{
			...session,
			flow: {
				...session.flow,
				subscription_cancel: {
					subscription: 'sub_other',
					retention: null,
				},
			},
		},
		{
			...session,
			flow: {
				...session.flow,
				subscription_cancel: {
					subscription: expected.subscriptionId,
					retention: { type: 'coupon_offer' },
				},
			},
		},
		{
			...session,
			flow: {
				...session.flow,
				after_completion: { type: 'portal_homepage' },
			},
		},
		...[
			'http://billing.stripe.com/session',
			'https://billing.stripe.com.evil.invalid/session',
			'https://name@billing.stripe.com/session',
			'https://billing.stripe.com:8443/session',
			'javascript:alert(1)',
		].map((url) => ({ ...session, url })),
	])
		assert.throws(() => fundCancellationHandoff(unsafe, expected));
});

test('client can choose only a subscription ID, never ownership, policy or cancellation timing', () => {
	assert.deepEqual(
		fundCancellationInput.parse({
			subscriptionId: expected.subscriptionId,
		}),
		{ subscriptionId: expected.subscriptionId },
	);
	for (const field of [
		'actorId',
		'accountId',
		'configuration',
		'returnUrl',
		'immediately',
	])
		assert.equal(
			fundCancellationInput.safeParse({
				subscriptionId: expected.subscriptionId,
				[field]: 'unsafe',
			}).success,
			false,
		);
});
