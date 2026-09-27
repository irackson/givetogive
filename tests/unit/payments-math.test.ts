import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertBalancedJournal,
	cumulativeRefund,
	netVerifiedFunding,
	quotePayment,
	recognizedSupporterTier,
	selectPaidSubscriptionLine,
} from '../../src/server/payments/math.ts';

const policy = {
	version: 'test',
	platformBps: 500,
	processingBps: 290,
	processingFixed: 30,
};
test('upgrade proration recognizes the positive new-tier coverage, not the old-tier credit line', () => {
	const credit = {
		amount: -400,
		period: { end: 100 },
		parent: { type: 'subscription_item_details' },
		pricing: { price_details: { price: 'price_supporter' } },
	};
	const debit = {
		amount: 1200,
		period: { end: 100 },
		parent: { type: 'subscription_item_details' },
		pricing: { price_details: { price: 'price_sustainer' } },
	};
	assert.equal(
		selectPaidSubscriptionLine([credit, debit], 'price_sustainer'),
		debit,
	);
	assert.equal(
		selectPaidSubscriptionLine([debit, credit], 'price_sustainer'),
		debit,
	);
	assert.equal(
		selectPaidSubscriptionLine([credit], 'price_supporter'),
		undefined,
	);
});
test('supporter recognition requires verified paid coverage, preserves paid cancellation time, and prefers the higher tier', () => {
	const now = new Date('2026-09-26T12:00:00Z');
	const paid = {
		kind: 'supporter',
		tier: 'supporter',
		paidThrough: new Date('2026-10-26T12:00:00Z'),
		status: 'active',
	};
	assert.equal(
		recognizedSupporterTier([{ ...paid, paidThrough: null }], now),
		'neighbor',
	);
	assert.equal(
		recognizedSupporterTier([{ ...paid, status: 'canceled' }], now),
		'supporter',
	);
	assert.equal(
		recognizedSupporterTier([{ ...paid, paidThrough: now }], now),
		'neighbor',
	);
	assert.equal(
		recognizedSupporterTier([{ ...paid, status: 'incomplete' }], now),
		'neighbor',
	);
	assert.equal(
		recognizedSupporterTier([paid, { ...paid, tier: 'sustainer' }], now),
		'sustainer',
	);
	assert.equal(
		recognizedSupporterTier([{ ...paid, kind: 'fund' }], now),
		'neighbor',
	);
});
test('payment quote freezes five percent and separate processing deduction', () => {
	assert.deepEqual(quotePayment(10_000, policy), {
		grossAmount: 10_000,
		platformFee: 500,
		processingEstimate: 320,
		recipientAmount: 9180,
		currency: 'usd',
		version: 'test',
	});
});
test('payment quotes reject fractional, unsafe, negative and too-small amounts', () => {
	for (const amount of [
		-1,
		0,
		50,
		100.1,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER,
	])
		assert.throws(() => quotePayment(amount, policy));
	assert.throws(() => quotePayment(1000, { ...policy, platformBps: 400 }));
});
test('all quote amounts balance over a wide rounding range', () => {
	for (let gross = 100; gross < 50000; gross += 17) {
		const q = quotePayment(gross, policy);
		assert.equal(
			q.platformFee + q.processingEstimate + q.recipientAmount,
			gross,
		);
		assert.ok(q.recipientAmount > 0);
	}
});
test('cumulative refunds sum exactly through the last cent', () => {
	const quote = quotePayment(12345, policy);
	let recipient = 0;
	let platform = 0;
	let processing = 0;
	for (let amount = 1; amount <= 12345; amount++) {
		const refund = cumulativeRefund(quote, amount);
		recipient += refund.recipientAmount - recipient;
		platform += refund.platformFee - platform;
		processing += refund.processingEstimate - processing;
		assert.equal(
			refund.recipientAmount +
				refund.platformFee +
				refund.processingEstimate,
			amount,
		);
	}
	assert.equal(recipient, quote.recipientAmount);
	assert.equal(platform, quote.platformFee);
	assert.equal(processing, quote.processingEstimate);
	assert.throws(() => cumulativeRefund(quote, 12346));
});
test('journals require integer signed entries and a zero balance', () => {
	assert.doesNotThrow(() =>
		assertBalancedJournal([
			{ account: 'cash', amount: 1000 },
			{ account: 'liability', amount: -950 },
			{ account: 'revenue', amount: -50 },
		]),
	);
	assert.throws(() =>
		assertBalancedJournal([
			{ account: 'cash', amount: 1000 },
			{ account: 'revenue', amount: -999 },
		]),
	);
	assert.throws(() =>
		assertBalancedJournal([
			{ account: 'cash', amount: 1.5 },
			{ account: 'revenue', amount: -1.5 },
		]),
	);
});
test('verified progress excludes pending, refunded and disputed funding', () => {
	const row = {
		recipientAmount: 900,
		refundedRecipientAmount: 100,
		disputedAmount: 200,
		status: 'succeeded',
	};
	assert.equal(netVerifiedFunding(row), 600);
	assert.equal(netVerifiedFunding({ ...row, status: 'pending' }), 0);
	assert.equal(
		netVerifiedFunding({ ...row, refundedRecipientAmount: 900 }),
		0,
	);
});
test('refund rounding never invents a negative processing component, even with zero processing rates', () => {
	for (const gross of [100, 101, 999, 1234]) {
		for (const processing of [0, 10, 290]) {
			const quote = quotePayment(gross, {
				...policy,
				processingBps: processing,
				processingFixed: 0,
			});
			for (let refund = 0; refund <= gross; refund++) {
				const result = cumulativeRefund(quote, refund);
				assert.ok(
					result.recipientAmount >= 0 &&
						result.platformFee >= 0 &&
						result.processingEstimate >= 0,
				);
				assert.equal(
					result.recipientAmount +
						result.platformFee +
						result.processingEstimate,
					refund,
				);
			}
		}
	}
});
