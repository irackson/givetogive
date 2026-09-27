import type Stripe from 'stripe';
import type { VerifiedCoverageLine } from '../src/server/payments/coverage-policy.ts';

export class CoveragePreflightError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}
function reject(code: string): never {
	throw new CoveragePreflightError(code);
}

export function preflightOptions(args: readonly string[]) {
	const values = new Map<string, string>();
	let apply = false;
	for (let i = 0; i < args.length; i++) {
		const key = args[i]!;
		if (key === '--apply') {
			if (apply) reject('duplicate_option');
			apply = true;
			continue;
		}
		if (
			![
				'--operator',
				'--confirm-identity',
				'--subscription',
				'--after-subscription',
				'--invoice-after',
				'--subscriptions',
				'--invoices',
			].includes(key)
		)
			reject('unknown_option');
		const value = args[++i];
		if (!value || value.startsWith('--') || values.has(key))
			reject('invalid_option');
		values.set(key, value);
	}
	const operatorId = values.get('--operator');
	if (!operatorId || !/^[A-Za-z0-9_-]{1,255}$/.test(operatorId))
		reject('operator_required');
	const bound = (key: string, fallback: number, maximum: number) => {
		const raw = values.get(key) ?? String(fallback);
		const value = Number(raw);
		if (
			!/^\d+$/.test(raw) ||
			!Number.isSafeInteger(value) ||
			value < 1 ||
			value > maximum
		)
			reject('invalid_scan_bound');
		return value;
	};
	const subscriptionId = values.get('--subscription');
	const afterSubscription = values.get('--after-subscription');
	const invoiceAfter = values.get('--invoice-after');
	for (const id of [subscriptionId, afterSubscription])
		if (id && !/^sub_[A-Za-z0-9_]{1,240}$/.test(id))
			reject('invalid_subscription_id');
	if (subscriptionId && afterSubscription)
		reject('conflicting_subscription_scope');
	if (
		invoiceAfter &&
		(!subscriptionId || !/^in_[A-Za-z0-9_]{1,240}$/.test(invoiceAfter))
	)
		reject('invoice_cursor_requires_one_subscription');
	const confirmIdentity = values.get('--confirm-identity');
	if (apply && !confirmIdentity)
		reject('apply_requires_identity_confirmation');
	return {
		apply,
		operatorId: operatorId!,
		confirmIdentity,
		subscriptionId,
		afterSubscription,
		invoiceAfter,
		subscriptionLimit: bound('--subscriptions', 10, 20),
		invoiceLimit: bound('--invoices', 12, 50),
	};
}
export type PreflightOptions = ReturnType<typeof preflightOptions>;

export type CoverageOwner = {
	id: string;
	actorId: string;
	accountId: string;
	kind: string;
	livemode: boolean;
};
export type CoveragePayment = {
	id: string;
	actorId: string;
	kind: string;
	livemode: boolean;
	subscriptionId: string | null;
	invoiceId: string | null;
	paymentIntentId: string | null;
	chargeId: string | null;
	currency: string;
	grossAmount: number;
	refundedAmount: number;
	disputedAmount: number;
	disputePendingAmount: number;
	status: string;
	paidAt: Date | null;
};
const idOf = (value: string | { id: string } | null | undefined) =>
	typeof value === 'string' ? value : (value?.id ?? null);

export function verifyPreflightInvoiceOwner(
	invoice: Stripe.Invoice,
	owner: CoverageOwner,
) {
	if (
		owner.kind !== 'supporter' ||
		owner.livemode ||
		invoice.livemode ||
		invoice.customer_account !== owner.accountId ||
		idOf(invoice.parent?.subscription_details?.subscription) !== owner.id
	)
		reject('invoice_ownership_mismatch');
	if (
		invoice.status !== 'paid' ||
		invoice.currency !== 'usd' ||
		!Number.isSafeInteger(invoice.amount_paid) ||
		invoice.amount_paid <= 0 ||
		!invoice.status_transitions.paid_at
	)
		reject('unsupported_or_zero_paid_invoice');
}

/** Verifies an already-settled local mapping. This tool never creates money/ledger records. */
export function verifyPreflightSettlement(input: {
	owner: CoverageOwner;
	invoice: Stripe.Invoice;
	payment: CoveragePayment | undefined;
	invoicePayments: Pick<
		Stripe.ApiList<Stripe.InvoicePayment>,
		'data' | 'has_more'
	>;
	intent: Stripe.PaymentIntent;
	settlementJournal: boolean;
}) {
	const { owner, invoice, payment, invoicePayments, intent } = input;
	verifyPreflightInvoiceOwner(invoice, owner);
	if (!payment?.paidAt || !input.settlementJournal)
		reject('missing_local_settlement');
	if (
		payment.actorId !== owner.actorId ||
		payment.kind !== 'supporter' ||
		payment.livemode ||
		payment.invoiceId !== invoice.id ||
		payment.subscriptionId !== owner.id ||
		payment.currency !== 'usd' ||
		payment.grossAmount !== invoice.amount_paid
	)
		reject('local_payment_ownership_mismatch');
	const invoicePayment = invoicePayments.data[0];
	if (
		invoicePayments.has_more ||
		invoicePayments.data.length !== 1 ||
		!invoicePayment ||
		invoicePayment.invoice !== invoice.id ||
		invoicePayment.status !== 'paid' ||
		invoicePayment.amount_paid !== invoice.amount_paid ||
		invoicePayment.currency !== 'usd' ||
		invoicePayment.livemode ||
		invoicePayment.payment.type !== 'payment_intent' ||
		idOf(invoicePayment.payment.payment_intent) !== payment.paymentIntentId
	)
		reject('unsupported_invoice_payment');
	const charge =
		typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
	if (
		intent.id !== payment.paymentIntentId ||
		intent.livemode ||
		intent.customer_account !== owner.accountId ||
		intent.currency !== 'usd' ||
		intent.status !== 'succeeded' ||
		intent.amount !== payment.grossAmount ||
		intent.amount_received !== payment.grossAmount ||
		!charge ||
		charge.id !== payment.chargeId ||
		charge.livemode ||
		idOf(charge.payment_intent) !== intent.id ||
		!charge.paid ||
		!charge.captured ||
		charge.currency !== 'usd' ||
		charge.amount !== payment.grossAmount ||
		charge.amount_captured !== payment.grossAmount ||
		!idOf(charge.balance_transaction)
	)
		reject('provider_settlement_mismatch');
	if (charge.amount_refunded !== payment.refundedAmount)
		reject('refund_reconciliation_required');
	if (
		charge.disputed &&
		payment.status !== 'disputed' &&
		payment.disputedAmount === 0 &&
		payment.disputePendingAmount === 0
	)
		reject('dispute_reconciliation_required');
	// Open/closed dispute outcomes belong to the normal dispute reconciler. No new
	// recognition is admitted by this conservative offline backfill in either case.
	if (
		charge.disputed ||
		payment.disputedAmount > 0 ||
		payment.disputePendingAmount > 0 ||
		payment.status === 'disputed'
	)
		return 'excluded_dispute' as const;
	if (
		payment.refundedAmount === payment.grossAmount &&
		payment.status === 'refunded'
	)
		return 'excluded_full_refund' as const;
	if (
		payment.refundedAmount < 0 ||
		payment.refundedAmount >= payment.grossAmount ||
		!['succeeded', 'partially_refunded'].includes(payment.status) ||
		payment.refundedAmount > 0 !== (payment.status === 'partially_refunded')
	)
		reject('payment_state_reconciliation_required');
	return 'verified' as const;
}

/** Never infer historical application from the current tier, invoice or paid-through. */
export function planPreflightCoverage(
	lines: readonly VerifiedCoverageLine[],
	proven: ReadonlySet<string>,
) {
	return {
		eligible: lines.filter(
			(line) => !line.proration || proven.has(line.invoiceLineId),
		),
		missingApplicationEvidence: lines
			.filter((line) => line.proration && !proven.has(line.invoiceLineId))
			.map((line) => line.invoiceLineId),
	};
}

export function paymentEvidenceFingerprint(payment: CoveragePayment) {
	return JSON.stringify([
		payment.id,
		payment.actorId,
		payment.kind,
		payment.livemode,
		payment.subscriptionId,
		payment.invoiceId,
		payment.paymentIntentId,
		payment.chargeId,
		payment.currency,
		payment.grossAmount,
		payment.refundedAmount,
		payment.disputedAmount,
		payment.disputePendingAmount,
		payment.status,
		payment.paidAt?.toISOString() ?? null,
	]);
}

export function safePreflightCode(error: unknown) {
	return error instanceof CoveragePreflightError ?
			error.code
		:	'verification_or_database_error';
}
