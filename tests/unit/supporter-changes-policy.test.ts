import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertChangeAction,
	changeHash,
	invoiceHandoff,
	pendingUpdatePaymentMethod,
	retryWithinProviderWindow,
	scheduleMatchesPlan,
	supporterChangeInput,
	supporterPrice,
	supporterState,
	validateOwnedSchedule,
	validateUpgradePreview,
} from '../../src/server/payments/supporter-changes-policy.ts';

const now = 1_800_000_000;
const supporter = {
	id: 'price_supporter',
	active: true,
	livemode: false,
	currency: 'usd',
	type: 'recurring',
	billing_scheme: 'per_unit',
	unit_amount: 500,
	product: 'prod_supporter',
	recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
	transform_quantity: null,
	tiers_mode: null,
};
const raw = {
	id: 'sub_owner',
	livemode: false,
	customer_account: 'acct_owner',
	status: 'active',
	collection_method: 'charge_automatically',
	currency: 'usd',
	items: {
		has_more: false,
		data: [
			{
				id: 'si_only',
				quantity: 1,
				current_period_start: now - 1000,
				current_period_end: now + 1000,
				price: supporter,
			},
		],
	},
	cancel_at_period_end: false,
	latest_invoice: 'in_paid',
	automatic_tax: { enabled: false },
	default_payment_method: 'pm_card',
};
const expected = {
	subscriptionId: raw.id,
	accountId: raw.customer_account,
	livemode: false,
	supporterPriceId: supporter.id,
	sustainerPriceId: 'price_sustainer',
	asOf: now,
};
const state = supporterState(raw, expected);

test('change inputs reject identity/price/amount injection and require stable revision and UUID', () => {
	const input = {
		operationId: '798b681e-05fd-41e0-90ac-6f9c65b4e8a5',
		subscriptionId: raw.id,
		expectedRevision: 0,
		action: 'upgrade',
	};
	assert.equal(supporterChangeInput.parse(input).action, 'upgrade');
	for (const candidate of [
		{ ...input, actorId: 'other' },
		{ ...input, priceId: 'price_fake' },
		{ ...input, amount: 1 },
		{ ...input, expectedRevision: -1 },
		{ ...input, operationId: 'new' },
	])
		assert.throws(() => supporterChangeInput.parse(candidate));
	assert.notEqual(
		changeHash(input),
		changeHash({ ...input, action: 'cancel' }),
	);
});

test('fixed monthly USD price and exactly-one-item active subscription are mandatory', () => {
	assert.equal(
		supporterPrice(supporter, supporter.id, 500, false).productId,
		'prod_supporter',
	);
	for (const price of [
		{ ...supporter, unit_amount: 501 },
		{ ...supporter, livemode: true },
		{ ...supporter, currency: 'eur' },
		{
			...supporter,
			recurring: { ...supporter.recurring, interval: 'year' },
		},
	])
		assert.throws(() => supporterPrice(price, supporter.id, 500, false));
	for (const value of [
		{ ...raw, customer_account: 'acct_other' },
		{ ...raw, status: 'past_due' },
		{
			...raw,
			items: {
				...raw.items,
				data: [raw.items.data[0], raw.items.data[0]],
			},
		},
		{ ...raw, automatic_tax: { enabled: true } },
		{ ...raw, discounts: [{}] },
		{ ...raw, schedule: 'sub_sched_external' },
		{ ...raw, pending_update: {} },
		{ ...raw, cancel_at: now + 500 },
	])
		assert.throws(() => supporterState(value, expected));
	assert.throws(() => supporterState(raw, { ...expected, asOf: now + 1000 }));
	assert.throws(() => supporterState(raw, { ...expected, asOf: now - 1001 }));
});

test('state fingerprint includes cancellation, payment method, period and pending state', () => {
	for (const candidate of [
		{ ...raw, cancel_at_period_end: true },
		{ ...raw, default_payment_method: 'pm_other' },
		{ ...raw, latest_invoice: 'in_other' },
	])
		assert.notEqual(
			supporterState(candidate, expected).fingerprint,
			state.fingerprint,
		);
	assert.doesNotThrow(() => assertChangeAction('upgrade', state));
	assert.throws(() => assertChangeAction('downgrade', state));
	assert.throws(() =>
		assertChangeAction('upgrade', { ...state, cancelAtPeriodEnd: true }),
	);
	assert.throws(() => assertChangeAction('resume', state));
	assert.doesNotThrow(() =>
		assertChangeAction('undo', state, {
			action: 'upgrade',
			status: 'pending_payment',
		}),
	);
});

test('dunning may stop or resume future billing without unpaid tier changes', () => {
	for (const status of ['past_due', 'unpaid']) {
		assert.throws(() => supporterState({ ...raw, status }, expected));
		const management = supporterState(
			{ ...raw, status },
			{ ...expected, allowUnpaidManagement: true },
		);
		assert.doesNotThrow(() => assertChangeAction('cancel', management));
	}
});

const previewExpected = {
	accountId: raw.customer_account,
	subscriptionId: raw.id,
	livemode: false,
	itemId: 'si_only',
	sourcePriceId: 'price_supporter',
	targetPriceId: 'price_sustainer',
	prorationDate: now,
	periodEnd: now + 1000,
};
const line = (price: string, amount: number) => ({
	amount,
	currency: 'usd',
	period: { start: now, end: now + 1000 },
	pricing: { price_details: { price } },
	parent: {
		type: 'subscription_item_details',
		subscription_item_details: {
			subscription_item: 'si_only',
			proration: true,
		},
	},
});
const preview = {
	currency: 'usd',
	livemode: false,
	customer_account: raw.customer_account,
	amount_due: 500,
	total: 500,
	parent: { subscription_details: { subscription: raw.id } },
	lines: {
		has_more: false,
		data: [line('price_supporter', -250), line('price_sustainer', 750)],
	},
};
test('upgrade preview admits only exact two-line owned proration without credit-only or unrelated amounts', () => {
	assert.equal(validateUpgradePreview(preview, previewExpected), 500);
	for (const candidate of [
		{ ...preview, amount_due: 0 },
		{ ...preview, amount_due: 400 },
		{ ...preview, total_taxes: [{}] },
		{ ...preview, customer_account: 'acct_other' },
		{ ...preview, lines: { ...preview.lines, has_more: true } },
		{
			...preview,
			lines: {
				...preview.lines,
				data: [line('price_supporter', -250), line('price_other', 750)],
			},
		},
	])
		assert.throws(() => validateUpgradePreview(candidate, previewExpected));
	assert.throws(() =>
		validateUpgradePreview(preview, {
			...previewExpected,
			prorationDate: now - 1,
		}),
	);
});

test('schedule must be first-class owned, preserve current phase and match intended period-end change', () => {
	const rawSchedule = {
		id: 'sub_sched_owned',
		livemode: false,
		customer_account: raw.customer_account,
		subscription: raw.id,
		status: 'active',
		end_behavior: 'release',
		phases: [
			{
				start_date: now - 1000,
				end_date: now + 1000,
				items: [{ price: 'price_sustainer', quantity: 1 }],
			},
			{
				start_date: now + 1000,
				end_date: now + 2000,
				items: [{ price: 'price_supporter', quantity: 1 }],
			},
		],
	};
	const owner = {
		id: rawSchedule.id,
		subscriptionId: raw.id,
		accountId: raw.customer_account,
		livemode: false,
	};
	const schedule = validateOwnedSchedule(rawSchedule, owner);
	const change = {
		action: 'downgrade' as const,
		sourcePriceId: 'price_sustainer',
		targetPriceId: 'price_supporter',
		periodEnd: now + 1000,
	};
	assert.equal(scheduleMatchesPlan(schedule, change), true);
	assert.equal(
		scheduleMatchesPlan(schedule, { ...change, periodEnd: now + 999 }),
		false,
	);
	assert.equal(
		scheduleMatchesPlan({ ...schedule, end_behavior: 'cancel' }, change),
		false,
	);
	assert.throws(() =>
		validateOwnedSchedule(
			{ ...rawSchedule, subscription: 'sub_other' },
			owner,
		),
	);
	assert.throws(() =>
		validateOwnedSchedule({ ...rawSchedule, livemode: true }, owner),
	);
	assert.throws(() =>
		validateOwnedSchedule(
			{
				...rawSchedule,
				phases: rawSchedule.phases.map((phase) => ({
					...phase,
					discounts: [{ coupon: 'coupon_external' }],
				})),
			},
			owner,
		),
	);
	assert.equal(
		scheduleMatchesPlan(
			validateOwnedSchedule(
				{
					...rawSchedule,
					phases: [
						...rawSchedule.phases,
						{
							start_date: now + 2000,
							end_date: now + 3000,
							items: [{ price: 'price_other', quantity: 1 }],
						},
					],
				},
				owner,
			),
			change,
		),
		false,
	);
});

test('safe recovery has a bounded idempotency window and only verified HTTPS invoice handoff', () => {
	assert.equal(
		retryWithinProviderWindow(new Date(0), 23 * 60 * 60_000 - 1),
		true,
	);
	assert.equal(
		retryWithinProviderWindow(new Date(0), 23 * 60 * 60_000),
		false,
	);
	assert.equal(
		invoiceHandoff('https://invoice.stripe.com/i/acct_example/invoice'),
		'https://invoice.stripe.com/i/acct_example/invoice',
	);
	for (const url of [
		'http://invoice.stripe.com/i/test',
		'https://stripe.com.attacker.invalid/',
		'https://user@invoice.stripe.com/i/test',
		'javascript:alert(1)',
	])
		assert.throws(() => invoiceHandoff(url));
	assert.equal(pendingUpdatePaymentMethod('card'), true);
	assert.equal(pendingUpdatePaymentMethod('link'), true);
	assert.equal(pendingUpdatePaymentMethod('us_bank_account'), false);
});
