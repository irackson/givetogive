import type Stripe from 'stripe';

export const simulationCheckoutOrigin = 'https://givetogive-staging.vercel.app';
export type CheckoutBinding = {
	operationId: string;
	checkoutId: string;
	customerAccountId: string;
	grossAmount: number;
	recurring: boolean;
};
type Session = Pick<
	Stripe.Checkout.Session,
	| 'id'
	| 'livemode'
	| 'customer_account'
	| 'client_reference_id'
	| 'amount_total'
	| 'currency'
	| 'mode'
	| 'success_url'
	| 'cancel_url'
	| 'url'
	| 'status'
	| 'payment_status'
	| 'expires_at'
>;

/** Provider response, never a caller-supplied URL, establishes the sandbox boundary. */
export function verifySandboxCheckoutSession(
	session: Session,
	binding: CheckoutBinding,
	requireOpen: boolean,
	now = Date.now(),
) {
	if (
		session.livemode ||
		!/^cs_test_[A-Za-z0-9]+$/.test(session.id) ||
		session.id !== binding.checkoutId ||
		session.customer_account !== binding.customerAccountId ||
		session.client_reference_id !== binding.operationId ||
		session.currency !== 'usd' ||
		!Number.isSafeInteger(binding.grossAmount) ||
		binding.grossAmount <= 0 ||
		session.amount_total !== binding.grossAmount ||
		session.mode !== (binding.recurring ? 'subscription' : 'payment')
	)
		throw new Error('Sandbox Checkout identity does not match.');
	for (const [field, value] of [
		['success_url', 'returned'],
		['cancel_url', 'canceled'],
	] as const) {
		if (
			session[field] !==
			`${simulationCheckoutOrigin}/giving/${binding.operationId}?checkout=${value}`
		)
			throw new Error('Sandbox Checkout return URL does not match.');
	}
	if (
		requireOpen &&
		(session.status !== 'open' ||
			session.payment_status !== 'unpaid' ||
			session.expires_at * 1000 <= now + 15000)
	)
		throw new Error('Sandbox Checkout is not open.');
	if (session.url) {
		const url = new URL(session.url);
		if (
			url.origin !== 'https://checkout.stripe.com' ||
			url.username ||
			url.password ||
			url.search ||
			url.pathname !== `/c/pay/${session.id}`
		)
			throw new Error('Sandbox Checkout hosted URL does not match.');
	} else if (requireOpen)
		throw new Error('Sandbox Checkout hosted URL is unavailable.');
}

export function verifySandboxPaymentIntent(
	intent: Pick<
		Stripe.PaymentIntent,
		'livemode' | 'customer_account' | 'amount' | 'currency'
	>,
	binding: CheckoutBinding,
) {
	if (
		intent.livemode ||
		intent.customer_account !== binding.customerAccountId ||
		intent.amount !== binding.grossAmount ||
		intent.currency !== 'usd'
	)
		throw new Error('Sandbox payment identity does not match.');
}
