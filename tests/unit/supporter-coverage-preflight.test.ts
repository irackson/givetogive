import assert from 'node:assert/strict';
import test from 'node:test';
import type Stripe from 'stripe';
import {
	paymentEvidenceFingerprint,
	planPreflightCoverage,
	preflightOptions,
	safePreflightCode,
	verifyPreflightInvoiceOwner,
	verifyPreflightSettlement,
	type CoveragePayment,
} from '../../scripts/supporter-coverage-preflight-policy.ts';
import type { VerifiedCoverageLine } from '../../src/server/payments/coverage-policy.ts';

function fixture() {
	const owner = {
		id: 'sub_owned',
		actorId: 'member',
		accountId: 'acct_owned',
		kind: 'supporter',
		livemode: false,
	};
	const payment: CoveragePayment = {
		id: 'local-payment',
		actorId: owner.actorId,
		kind: 'supporter',
		livemode: false,
		subscriptionId: owner.id,
		invoiceId: 'in_owned',
		paymentIntentId: 'pi_owned',
		chargeId: 'ch_owned',
		currency: 'usd',
		grossAmount: 500,
		refundedAmount: 0,
		disputedAmount: 0,
		disputePendingAmount: 0,
		status: 'succeeded',
		paidAt: new Date('2026-09-01'),
	};
	const invoice = {
		id: payment.invoiceId,
		status: 'paid',
		livemode: false,
		customer_account: owner.accountId,
		currency: 'usd',
		amount_paid: 500,
		status_transitions: { paid_at: 1790000000 },
		parent: { subscription_details: { subscription: owner.id } },
	} as Stripe.Invoice;
	const invoicePayment = {
		invoice: invoice.id,
		livemode: false,
		currency: 'usd',
		status: 'paid',
		amount_paid: 500,
		payment: {
			type: 'payment_intent',
			payment_intent: payment.paymentIntentId,
		},
	} as Stripe.InvoicePayment;
	const charge = {
		id: payment.chargeId,
		livemode: false,
		payment_intent: payment.paymentIntentId,
		amount: 500,
		amount_captured: 500,
		currency: 'usd',
		paid: true,
		captured: true,
		disputed: false,
		amount_refunded: 0,
		balance_transaction: 'txn_owned',
	} as Stripe.Charge;
	const intent = {
		id: payment.paymentIntentId,
		livemode: false,
		customer_account: owner.accountId,
		currency: 'usd',
		status: 'succeeded',
		amount: 500,
		amount_received: 500,
		latest_charge: charge,
	} as Stripe.PaymentIntent;
	return {
		owner,
		payment,
		invoice,
		charge,
		intent,
		invoicePayments: { data: [invoicePayment], has_more: false },
		settlementJournal: true,
	};
}

test('operator preflight defaults to dry-run and finite pages; application requires explicit identity', () => {
	const base = preflightOptions(['--operator', 'synthetic-admin']);
	assert.equal(base.apply, false);
	assert.equal(base.subscriptionLimit, 10);
	assert.equal(base.invoiceLimit, 12);
	assert.equal(
		preflightOptions([
			'--operator',
			'synthetic-admin',
			'--apply',
			'--confirm-identity',
			'identity',
		]).apply,
		true,
	);
	for (const extras of [
		['--apply'],
		['--apply', '--apply'],
		['--subscriptions', '21'],
		['--invoices', '51'],
		['--invoices', '0'],
		['--subscriptions', 'NaN'],
		['--all'],
		['--invoice-after', 'in_other'],
		['--subscription', 'sub_a', '--after-subscription', 'sub_b'],
		['--operator', 'duplicate'],
	])
		assert.throws(() =>
			preflightOptions(['--operator', 'synthetic-admin', ...extras]),
		);
	assert.throws(() => preflightOptions([]));
	assert.equal(
		preflightOptions([
			'--operator',
			'synthetic-admin',
			'--subscription',
			'sub_owned',
			'--invoice-after',
			'in_owned',
		]).invoiceAfter,
		'in_owned',
	);
});

test('a verified owned invoice, single actual payment, charge and local settlement are required', () => {
	assert.equal(verifyPreflightSettlement(fixture()), 'verified');
	for (const patch of [
		{ actorId: 'other' },
		{ subscriptionId: 'sub_other' },
		{ invoiceId: 'in_other' },
		{ livemode: true },
		{ kind: 'fund' },
		{ currency: 'eur' },
		{ grossAmount: 1000 },
		{ paidAt: null },
	]) {
		const f = fixture();
		Object.assign(f.payment, patch);
		assert.throws(() => verifyPreflightSettlement(f));
	}
	const f = fixture();
	f.settlementJournal = false;
	assert.throws(
		() => verifyPreflightSettlement(f),
		/missing_local_settlement/,
	);
	assert.throws(
		() => verifyPreflightSettlement({ ...fixture(), payment: undefined }),
		/missing_local_settlement/,
	);
});

test('metadata cannot override invoice/account/subscription/mode or zero-payment mismatch', () => {
	for (const patch of [
		{ customer_account: 'acct_other' },
		{ parent: { subscription_details: { subscription: 'sub_other' } } },
		{ livemode: true },
		{ status: 'open' },
		{ amount_paid: 0 },
		{ currency: 'eur' },
	]) {
		const f = fixture();
		Object.assign(f.invoice, patch, {
			metadata: { actorId: f.owner.actorId, subscriptionId: f.owner.id },
		});
		assert.throws(() => verifyPreflightInvoiceOwner(f.invoice, f.owner));
	}
});

test('split/non-Stripe payments and foreign provider identities cannot produce coverage', () => {
	for (const patch of [
		{ has_more: true },
		{ data: [] },
		{
			data: [
				fixture().invoicePayments.data[0]!,
				fixture().invoicePayments.data[0]!,
			],
		},
	]) {
		const f = fixture();
		Object.assign(f.invoicePayments, patch);
		assert.throws(
			() => verifyPreflightSettlement(f),
			/unsupported_invoice_payment/,
		);
	}
	for (const patch of [
		{ customer_account: 'acct_other' },
		{ id: 'pi_other' },
		{ livemode: true },
		{ status: 'processing' },
		{ amount_received: 0 },
		{ latest_charge: 'ch_owned' },
	]) {
		const f = fixture();
		Object.assign(f.intent, patch);
		assert.throws(
			() => verifyPreflightSettlement(f),
			/provider_settlement_mismatch/,
		);
	}
	for (const patch of [
		{ id: 'ch_other' },
		{ payment_intent: 'pi_other' },
		{ livemode: true },
		{ amount_captured: 0 },
		{ paid: false },
		{ captured: false },
		{ balance_transaction: null },
	]) {
		const f = fixture();
		Object.assign(f.charge, patch);
		assert.throws(
			() => verifyPreflightSettlement(f),
			/provider_settlement_mismatch/,
		);
	}
});

test('partial refunds retain residual verified coverage; full refunds/disputes are excluded and drift requires review', () => {
	const partial = fixture();
	partial.charge.amount_refunded = partial.payment.refundedAmount = 100;
	partial.payment.status = 'partially_refunded';
	assert.equal(verifyPreflightSettlement(partial), 'verified');
	const full = fixture();
	full.charge.amount_refunded = full.payment.refundedAmount = 500;
	full.payment.status = 'refunded';
	assert.equal(verifyPreflightSettlement(full), 'excluded_full_refund');
	const disputed = fixture();
	disputed.charge.disputed = true;
	assert.throws(
		() => verifyPreflightSettlement(disputed),
		/dispute_reconciliation_required/,
	);
	disputed.payment.disputePendingAmount = 500;
	assert.equal(verifyPreflightSettlement(disputed), 'excluded_dispute');
	const drift = fixture();
	drift.charge.amount_refunded = 100;
	assert.throws(
		() => verifyPreflightSettlement(drift),
		/refund_reconciliation_required/,
	);
});

test('historical proration is unresolved without immutable application proof, even with a current higher tier', () => {
	const line: VerifiedCoverageLine = {
		invoiceLineId: 'il_old',
		invoiceId: 'in_old',
		subscriptionId: 'sub_owned',
		itemId: 'si_owned',
		priceId: 'price_sustainer',
		tier: 'sustainer',
		livemode: false,
		proration: true,
		periodStart: new Date('2025-01-01'),
		periodEnd: new Date('2025-02-01'),
	};
	assert.deepEqual(planPreflightCoverage([line], new Set()), {
		eligible: [],
		missingApplicationEvidence: ['il_old'],
	});
	assert.deepEqual(planPreflightCoverage([line], new Set(['il_old'])), {
		eligible: [line],
		missingApplicationEvidence: [],
	});
	assert.equal(
		planPreflightCoverage([{ ...line, proration: false }], new Set())
			.eligible.length,
		1,
	);
});

test('eligibility fingerprint catches intervening financial changes and errors never print private provider messages', () => {
	const f = fixture();
	const before = paymentEvidenceFingerprint(f.payment);
	f.payment.refundedAmount = 1;
	assert.notEqual(paymentEvidenceFingerprint(f.payment), before);
	assert.equal(
		safePreflightCode(new Error('private-account-email-and-secret')),
		'verification_or_database_error',
	);
});
