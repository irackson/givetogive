/** Synthetic policy fixtures; these are not authenticated Stripe sandbox evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type Stripe from 'stripe';
import {
	applicationProofFromEvent,
	applicationProvesLine,
	applicationSubscriptionId,
	sameApplicationProof,
} from '../../src/server/payments/supporter-application-policy.ts';

const owner = {
	actorId: 'local_member',
	subscriptionId: 'sub_owned',
	accountId: 'acct_owned',
	livemode: false,
};
const platform = 'acct_platform';
const start = 1_790_000_000;
const end = start + 2_592_000;
function fixture(
	overrides: Record<string, unknown> = {},
	itemOverrides: Record<string, unknown> = {},
): Stripe.CustomerSubscriptionPendingUpdateAppliedEvent {
	return {
		id: 'evt_applied',
		type: 'customer.subscription.pending_update_applied',
		created: start + 100,
		livemode: false,
		data: {
			object: {
				id: owner.subscriptionId,
				object: 'subscription',
				customer_account: owner.accountId,
				livemode: false,
				pending_update: null,
				latest_invoice: 'in_upgrade',
				metadata: { userId: 'metadata_is_not_authority' },
				items: {
					has_more: false,
					data: [
						{
							id: 'si_owned',
							subscription: owner.subscriptionId,
							quantity: 1,
							current_period_start: start,
							current_period_end: end,
							price: {
								id: 'price_applied',
								livemode: false,
								currency: 'usd',
								type: 'recurring',
								recurring: {
									interval: 'month',
									interval_count: 1,
									usage_type: 'licensed',
								},
							},
							...itemOverrides,
						},
					],
				},
				...overrides,
			},
		},
	} as unknown as Stripe.CustomerSubscriptionPendingUpdateAppliedEvent;
}
const line = {
	invoiceLineId: 'il_owned',
	itemId: 'si_owned',
	priceId: 'price_applied',
	periodStart: new Date((start + 100) * 1000),
	periodEnd: new Date(end * 1000),
	proration: true,
};

test('application proof stores only minimal first-class ownership and historical snapshot evidence', () => {
	const proof = applicationProofFromEvent(fixture(), owner, platform);
	assert.equal(proof.invoiceId, 'in_upgrade');
	assert.equal(proof.actorId, owner.actorId);
	assert.equal(proof.itemId, 'si_owned');
	assert.equal('metadata' in proof, false);
	assert.equal('data' in proof, false);
	assert.equal(
		sameApplicationProof(
			proof,
			applicationProofFromEvent(fixture(), owner, platform),
		),
		true,
	);
});
test('event type, mode and platform account are mandatory authority boundaries', () => {
	for (const event of [
		{ ...fixture(), type: 'customer.subscription.updated' },
		{ ...fixture(), livemode: true },
		{ ...fixture(), account: 'acct_foreign' },
		{ ...fixture(), created: Number.NaN },
	] as Stripe.Event[])
		assert.throws(
			() => applicationProofFromEvent(event, owner, platform),
			/authority/,
		);
	assert.equal(
		applicationSubscriptionId({
			...fixture(),
			type: 'customer.subscription.updated',
		} as Stripe.Event),
		null,
	);
});
test('metadata cannot override mismatched subscription, customer-account, item or mode', () => {
	for (const event of [
		fixture({ customer_account: 'acct_foreign' }),
		fixture({ id: 'sub_foreign' }),
		fixture({ livemode: true }),
		fixture({}, { subscription: 'sub_foreign' }),
		fixture(
			{},
			{
				price: {
					id: 'price_applied',
					livemode: true,
					currency: 'usd',
					type: 'recurring',
					recurring: {
						interval: 'month',
						interval_count: 1,
						usage_type: 'licensed',
					},
				},
			},
		),
	])
		assert.throws(
			() => applicationProofFromEvent(event, owner, platform),
			/ownership/,
		);
});
test('pending updates, ambiguous items, unsupported quantities and invalid intervals fail closed', () => {
	for (const event of [
		fixture({ pending_update: { expires_at: end } }),
		fixture({ latest_invoice: null }),
		fixture({ items: { has_more: true, data: [] } }),
		fixture({}, { quantity: 2 }),
		fixture({}, { current_period_end: start }),
		fixture({}, { current_period_start: -1 }),
	])
		assert.throws(
			() => applicationProofFromEvent(event, owner, platform),
			/snapshot|period/,
		);
});
test('applied historical proration remains provable after a later renewal or tier change', () => {
	const proof = applicationProofFromEvent(fixture(), owner, platform);
	assert.equal(applicationProvesLine(proof, line), true);
	// No current subscription price/invoice/period is an input to historical proof.
	assert.equal(
		applicationProvesLine(proof, {
			...line,
			periodStart: new Date(end * 1000),
			periodEnd: new Date((end + 2_592_000) * 1000),
		}),
		false,
	);
});
test('line proof binds exact item and price plus matching end and contained proration start', () => {
	const proof = applicationProofFromEvent(fixture(), owner, platform);
	for (const changed of [
		{ itemId: 'si_other' },
		{ priceId: 'price_other' },
		{ proration: false },
		{ periodEnd: new Date(end * 1000 + 1) },
		{ periodStart: new Date(start * 1000 - 1) },
		{ periodStart: new Date(end * 1000) },
		{ periodStart: new Date(Number.NaN) },
	])
		assert.equal(
			applicationProvesLine(proof, { ...line, ...changed }),
			false,
		);
});
test('same event ID cannot silently change historical immutable evidence', () => {
	const proof = applicationProofFromEvent(fixture(), owner, platform);
	for (const changed of [
		{ invoiceId: 'in_other' },
		{ itemId: 'si_other' },
		{ priceId: 'price_other' },
		{ actorId: 'other' },
		{ accountId: 'acct_other' },
		{ livemode: true },
		{ platformAccountId: 'acct_other' },
		{ providerCreatedAt: new Date(0) },
		{ periodEnd: new Date(0) },
	])
		assert.equal(
			sameApplicationProof(proof, { ...proof, ...changed }),
			false,
		);
});
