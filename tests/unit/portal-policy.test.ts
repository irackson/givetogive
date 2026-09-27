import assert from 'node:assert/strict';
import test from 'node:test';
import {
	requirePortalConfigurationId,
	validatePortalConfiguration,
} from '../../src/server/payments/portal-policy.ts';

const policy = {
	id: 'bpc_syntheticPolicy',
	active: true,
	livemode: false,
	features: {
		invoice_history: { enabled: true },
		payment_method_update: { enabled: true },
		subscription_cancel: {
			enabled: true,
			mode: 'at_period_end',
			proration_behavior: 'none',
		},
		subscription_update: { enabled: false, default_allowed_updates: [] },
	},
};

test('portal requires an explicit ID and never accepts an unspecified default policy', () => {
	assert.equal(requirePortalConfigurationId(policy.id), policy.id);
	for (const value of [undefined, '', 'default', 'bpc_invalid-value']) {
		assert.throws(() => requirePortalConfigurationId(value));
	}
});

test('portal accepts only active matching-mode billing and period-end cancellation policy', () => {
	assert.equal(
		validatePortalConfiguration(policy, policy.id, false),
		policy.id,
	);
	for (const candidate of [
		null,
		{},
		{ ...policy, active: false },
		{ ...policy, id: 'bpc_other' },
		{ ...policy, livemode: true },
	]) {
		assert.throws(() =>
			validatePortalConfiguration(candidate, policy.id, false),
		);
	}
});

test('immediate cancellation, portal plan changes, quantity or promotion changes fail closed', () => {
	for (const changed of [
		{
			subscription_cancel: {
				enabled: true,
				mode: 'immediately',
				proration_behavior: 'none',
			},
		},
		{
			subscription_cancel: {
				enabled: false,
				mode: 'at_period_end',
				proration_behavior: 'none',
			},
		},
		{
			subscription_cancel: {
				enabled: true,
				mode: 'at_period_end',
				proration_behavior: 'create_prorations',
			},
		},
		{
			subscription_update: {
				enabled: true,
				default_allowed_updates: ['price'],
			},
		},
		{
			subscription_update: {
				enabled: true,
				default_allowed_updates: ['quantity'],
			},
		},
		{
			subscription_update: {
				enabled: true,
				default_allowed_updates: ['promotion_code'],
			},
		},
		{ invoice_history: { enabled: false } },
		{ payment_method_update: { enabled: false } },
	])
		assert.throws(() =>
			validatePortalConfiguration(
				{ ...policy, features: { ...policy.features, ...changed } },
				policy.id,
				false,
			),
		);
});
