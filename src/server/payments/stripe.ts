import Stripe from 'stripe';
import { TRPCError } from '@trpc/server';
import { paymentConfiguration } from './config';

let client: Stripe | undefined;
let currentKey: string | undefined;
export function stripeClient() {
	const key = process.env['STRIPE_SECRET_KEY'];
	if (!key || !paymentConfiguration().configured)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'Stripe is not configured for this environment.',
		});
	if (!client || currentKey !== key) {
		client = new Stripe(key, {
			apiVersion: '2026-08-26.dahlia',
			maxNetworkRetries: 2,
			timeout: 20_000,
			appInfo: {
				name: 'GiveToGive',
				version: '1.0.0',
				url: 'https://givetogive.vercel.app',
			},
		});
		currentKey = key;
	}
	return client;
}

export function stripeId(
	value: string | { id: string } | null | undefined,
): string | null {
	return typeof value === 'string' ? value : (value?.id ?? null);
}

/** Error logs intentionally exclude request bodies, provider messages, and credentials. */
export function paymentErrorCode(error: unknown): string {
	if (error instanceof Stripe.errors.StripeError)
		return `${error.type}:${error.code ?? error.statusCode ?? 'unknown'}`.slice(
			0,
			160,
		);
	if (error instanceof TRPCError) return error.code;
	return 'payment_processing_error';
}
