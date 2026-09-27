import test from 'node:test';
import assert from 'node:assert/strict';
import {
	tierFromCoverage,
	verifiedSupporterLines,
} from '../../src/server/payments/coverage-policy.ts';

const context = {
	invoiceId: 'in_ci',
	subscriptionId: 'sub_ci',
	livemode: false,
	supporterPriceId: 'price_supporter',
	sustainerPriceId: 'price_sustainer',
};
const line = {
	id: 'il_ci',
	invoice: 'in_ci',
	livemode: false,
	currency: 'usd',
	amount: 500,
	period: { start: 1000, end: 2000 },
	parent: {
		type: 'subscription_item_details',
		subscription_item_details: {
			subscription: 'sub_ci',
			subscription_item: 'si_ci',
			proration: false,
		},
	},
	pricing: { price_details: { price: 'price_supporter' } },
};

test('coverage preserves invoice price and both dates independent of present subscription price', () => {
	const [coverage] = verifiedSupporterLines([line], context);
	assert.equal(coverage?.tier, 'supporter');
	assert.equal(coverage?.periodStart.getTime(), 1000_000);
	assert.equal(coverage?.periodEnd.getTime(), 2000_000);
	assert.equal(coverage?.invoiceLineId, 'il_ci');
	assert.equal(coverage?.itemId, 'si_ci');
});

test('credit lines do not grant coverage and unknown positive lines fail closed', () => {
	const credit = { ...line, id: 'il_credit', amount: -200 };
	assert.equal(verifiedSupporterLines([credit, line], context).length, 1);
	assert.throws(
		() => verifiedSupporterLines([credit], context),
		/No positive/,
	);
	assert.throws(
		() =>
			verifiedSupporterLines(
				[
					{
						...line,
						pricing: { price_details: { price: 'price_unknown' } },
					},
				],
				context,
			),
		/Unsupported/,
	);
	assert.throws(
		() =>
			verifiedSupporterLines(
				[
					{
						...line,
						parent: {
							...line.parent,
							type: 'invoice_item_details',
						},
					},
				],
				context,
			),
		/Unsupported/,
	);
});

test('coverage rejects identity, mode, currency, dates and duplicate provenance', () => {
	for (const invalid of [
		{ ...line, invoice: 'in_other' },
		{ ...line, livemode: true },
		{ ...line, currency: 'eur' },
		{ ...line, period: { start: 2000, end: 2000 } },
		{ ...line, period: { start: 1000, end: Number.POSITIVE_INFINITY } },
		{
			...line,
			parent: {
				...line.parent,
				subscription_item_details: {
					subscription: 'sub_other',
					subscription_item: 'si_ci',
					proration: false,
				},
			},
		},
	])
		assert.throws(() => verifiedSupporterLines([invalid], context));
	assert.throws(() => verifiedSupporterLines([line, line], context));
	assert.throws(() =>
		verifiedSupporterLines([line], {
			...context,
			sustainerPriceId: context.supporterPriceId,
		}),
	);
});

test('future paid periods wait for inclusive start and expire at exclusive end', () => {
	const coverage = verifiedSupporterLines([line], context);
	assert.equal(tierFromCoverage(coverage, new Date(999_000)), 'neighbor');
	assert.equal(tierFromCoverage(coverage, new Date(1000_000)), 'supporter');
	assert.equal(tierFromCoverage(coverage, new Date(1999_000)), 'supporter');
	assert.equal(tierFromCoverage(coverage, new Date(2000_000)), 'neighbor');
});

test('overlapping paid upgrade selects higher tier only during its actual interval', () => {
	const lower = verifiedSupporterLines([line], context);
	const higher = verifiedSupporterLines(
		[
			{
				...line,
				id: 'il_upgrade',
				period: { start: 1500, end: 2000 },
				pricing: { price_details: { price: 'price_sustainer' } },
				parent: {
					...line.parent,
					subscription_item_details: {
						subscription: 'sub_ci',
						subscription_item: 'si_ci',
						proration: true,
					},
				},
			},
		],
		context,
	);
	assert.equal(higher[0]?.proration, true);
	assert.equal(
		tierFromCoverage([...lower, ...higher], new Date(1499_000)),
		'supporter',
	);
	assert.equal(
		tierFromCoverage([...lower, ...higher], new Date(1500_000)),
		'sustainer',
	);
});
