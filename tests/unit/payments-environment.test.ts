import assert from 'node:assert/strict';
import test from 'node:test';
import {
	paymentConfiguration,
	publicPaymentConfiguration,
} from '../../src/server/payments/config.ts';

const keys = [
	'APP_ENV',
	'NODE_ENV',
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY',
	'APP_URL',
	'STRIPE_PLATFORM_ACCOUNT_ID',
	'STRIPE_PROCESSING_BPS',
	'STRIPE_PROCESSING_FIXED_CENTS',
	'PAYMENTS_ENABLED',
	'SUPPORTERS_ENABLED',
	'FUNDS_ENABLED',
	'STRIPE_LIVE_APPROVED',
	'STRIPE_SUPPORTER_PRICE_ID',
	'STRIPE_SUSTAINER_PRICE_ID',
];
function withEnvironment(values: Record<string, string>, run: () => void) {
	const before = Object.fromEntries(
		keys.map((key) => [key, process.env[key]]),
	);
	for (const key of keys) delete process.env[key];
	Object.assign(process.env, values);
	try {
		run();
	} finally {
		for (const key of keys) {
			if (before[key] === undefined) delete process.env[key];
			else process.env[key] = before[key];
		}
	}
}
const configured = {
	APP_ENV: 'staging',
	STRIPE_SECRET_KEY: ['rk', 'test', 'synthetic'].join('_'),
	APP_URL: 'https://staging.example.com',
	STRIPE_PLATFORM_ACCOUNT_ID: 'acct_synthetic',
	STRIPE_PROCESSING_BPS: '290',
	STRIPE_PROCESSING_FIXED_CENTS: '30',
	PAYMENTS_ENABLED: 'true',
};

test('payments default closed without credentials and verified fee configuration', () =>
	withEnvironment({}, () => {
		assert.equal(publicPaymentConfiguration().enabled, false);
		assert.equal(publicPaymentConfiguration().billingManagement, false);
		assert.equal(publicPaymentConfiguration().feePolicy, null);
	}));
test('staging accepts explicitly enabled test configuration', () =>
	withEnvironment(configured, () => {
		assert.equal(paymentConfiguration().askPayments, true);
		assert.equal(paymentConfiguration().livemode, false);
		assert.equal(paymentConfiguration().subscriptions, false);
	}));
test('stopping new sales leaves configured subscription management available', () =>
	withEnvironment(
		{
			...configured,
			PAYMENTS_ENABLED: 'false',
			SUPPORTERS_ENABLED: 'false',
			FUNDS_ENABLED: 'false',
		},
		() => {
			assert.equal(publicPaymentConfiguration().enabled, false);
			assert.equal(publicPaymentConfiguration().subscriptions, false);
			assert.equal(publicPaymentConfiguration().billingManagement, true);
		},
	));
test('live keys cannot enable staging even with approval set', () =>
	withEnvironment(
		{
			...configured,
			STRIPE_SECRET_KEY: ['rk', 'live', 'synthetic'].join('_'),
			STRIPE_LIVE_APPROVED: 'true',
		},
		() => {
			assert.equal(paymentConfiguration().configured, false);
		},
	));
test('production rejects sandbox keys and requires independent live approval', () => {
	withEnvironment({ ...configured, APP_ENV: 'production' }, () =>
		assert.equal(paymentConfiguration().configured, false),
	);
	withEnvironment(
		{
			...configured,
			APP_ENV: 'production',
			STRIPE_SECRET_KEY: ['rk', 'live', 'synthetic'].join('_'),
		},
		() => assert.equal(paymentConfiguration().configured, false),
	);
	withEnvironment(
		{
			...configured,
			APP_ENV: 'production',
			STRIPE_SECRET_KEY: ['rk', 'live', 'synthetic'].join('_'),
			STRIPE_LIVE_APPROVED: 'true',
		},
		() => assert.equal(paymentConfiguration().configured, true),
	);
});
test('a production build with omitted APP_ENV fails safely, not as development', () =>
	withEnvironment(
		{ ...configured, APP_ENV: '', NODE_ENV: 'production' },
		() => {
			assert.equal(paymentConfiguration().environment, 'production');
			assert.equal(paymentConfiguration().configured, false);
		},
	));
test('missing or invalid processing pricing prevents accepting payments', () => {
	for (const bps of ['', 'NaN', '-1', '5001', '2.5'])
		withEnvironment({ ...configured, STRIPE_PROCESSING_BPS: bps }, () => {
			assert.equal(paymentConfiguration().configured, false);
		});
});

test('a secret accidentally assigned as publishable is never exposed and closes payment gates', () => {
	for (const prefix of ['sk_test_', 'rk_test_', 'sk_live_', 'rk_live_']) {
		const accidentalSecret = `${prefix}syntheticNeverPublic`;
		withEnvironment(
			{ ...configured, STRIPE_PUBLISHABLE_KEY: accidentalSecret },
			() => {
				assert.equal(paymentConfiguration().configured, false);
				assert.equal(publicPaymentConfiguration().publishableKey, null);
				assert.ok(
					!JSON.stringify(publicPaymentConfiguration()).includes(
						accidentalSecret,
					),
				);
			},
		);
	}
});

test('supplied publishable keys must match mode while hosted Checkout can omit them', () => {
	withEnvironment(
		{ ...configured, STRIPE_PUBLISHABLE_KEY: 'pk_live_synthetic' },
		() => {
			assert.equal(paymentConfiguration().configured, false);
			assert.equal(publicPaymentConfiguration().publishableKey, null);
		},
	);
	withEnvironment(
		{ ...configured, STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic' },
		() => {
			assert.equal(paymentConfiguration().configured, true);
			assert.equal(
				publicPaymentConfiguration().publishableKey,
				'pk_test_synthetic',
			);
		},
	);
	withEnvironment(configured, () =>
		assert.equal(paymentConfiguration().configured, true),
	);
});
