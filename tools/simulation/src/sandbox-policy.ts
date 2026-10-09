import { z } from 'zod';
import type { Credentials } from './protocol.ts';

export const sandboxOrigin = 'https://givetogive-staging.vercel.app';
export const checkoutScenarios = ['success', 'decline', 'three_ds_success', 'three_ds_failure', 'cancel'] as const;
export type CheckoutScenario = typeof checkoutScenarios[number];
export const checkoutContextSchema = z.object({
  environment: z.literal('staging'), databaseIdentity: z.string().min(1), runId: z.string().min(1),
  operationId: z.uuid(), actorId: z.string().min(1), sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]+$/),
  url: z.url(), livemode: z.literal(false), currency: z.literal('usd'), amountTotal: z.number().int().positive().max(100_000_000),
  mode: z.enum(['payment', 'subscription']), status: z.enum(['open', 'complete', 'expired']),
  paymentStatus: z.enum(['paid', 'unpaid', 'no_payment_required']), expiresAt: z.number().int().positive(),
  returnOrigin: z.url(), verifiedAt: z.iso.datetime(),
});
export type VerifiedCheckout = z.infer<typeof checkoutContextSchema>;
export type SandboxBoundary = { credentials: Credentials; actorId: string; operationId: string; protectionBypass: string; maximumAmountCents: number };

export function assertSandboxBoundary(credentials: Credentials, bypass: string | undefined) {
  if (credentials.origin !== sandboxOrigin || !credentials.runId || !bypass || bypass.length < 16) throw new Error('Sandbox payments require the exact protected staging origin and run-scoped credentials.');
}
export function validateCheckoutContext(raw: unknown, boundary: SandboxBoundary, now = Date.now()): VerifiedCheckout {
  assertSandboxBoundary(boundary.credentials, boundary.protectionBypass);
  const parsed = checkoutContextSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Checkout verification response is invalid or not test mode.');
  const value = parsed.data;
  if (value.databaseIdentity !== boundary.credentials.databaseIdentity || value.runId !== boundary.credentials.runId || value.actorId !== boundary.actorId || value.operationId !== boundary.operationId || value.returnOrigin !== sandboxOrigin) throw new Error('Checkout ownership or environment verification failed.');
  if (!Number.isSafeInteger(boundary.maximumAmountCents) || boundary.maximumAmountCents < 1 || value.amountTotal > boundary.maximumAmountCents) throw new Error('Checkout exceeds the explicit sandbox budget.');
  if (value.status !== 'open' || value.paymentStatus !== 'unpaid' || value.expiresAt * 1000 <= now + 15_000) throw new Error('Checkout is not an open, unpaid, unexpired test session.');
  const age = now - Date.parse(value.verifiedAt);
  if (age < -5000 || age > 30000) throw new Error('Checkout verification is stale.');
  const url = new URL(value.url);
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password || url.search || url.pathname !== `/c/pay/${value.sessionId}`) throw new Error('Checkout must be the verified Stripe-hosted test session URL.');
  return value;
}
export function stripeOwnedOrigin(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com') || url.hostname === 'stripecdn.com' || url.hostname.endsWith('.stripecdn.com'));
}
export function allowedCheckoutRequest(rawUrl: string, topLevelNavigation: boolean, checkout: VerifiedCheckout): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.origin === sandboxOrigin) return url.pathname === `/giving/${checkout.operationId}` || (!topLevelNavigation && /^\/(?:_next\/|api\/auth\/|api\/trpc\/|favicon)/.test(url.pathname));
  // Observed dependencies of the genuine hosted Checkout page. These may load
  // inside Checkout but can never receive our staging bypass or navigate the tab.
  // Loading Stripe's fraud challenge is not permission to solve/bypass a CAPTCHA.
  if (!topLevelNavigation && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
    (['m.stripe.network', 'hcaptcha.com'].includes(url.hostname) || url.hostname.endsWith('.hcaptcha.com'))) return true;
  if (!stripeOwnedOrigin(url)) return false;
  return !topLevelNavigation || (url.origin === 'https://checkout.stripe.com' && url.pathname === `/c/pay/${checkout.sessionId}`);
}

/** Passive wallet SDKs observed on genuine Checkout, verified against Apple and
 * Amazon developer docs. Never grants wallet login, navigation or payment APIs.
 * https://developer.apple.com/documentation/applepayontheweb/loading-the-latest-version-of-apple-pay-js
 * https://developer.amazon.com/docs/amazon-pay-checkout/amazon-pay-script.html */
export function allowedPassiveCheckoutWalletScript(rawUrl: string, topLevelNavigation: boolean, resourceType: string, method: string) {
  if (topLevelNavigation || resourceType !== 'script' || !['GET', 'HEAD'].includes(method)) return false;
  let url: URL; try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.search || url.hash) return false;
  if (url.hostname === 'applepay.cdn-apple.com')
    // The public SDK dynamically imports these two default components from its
    // own version directory. This does not admit merchant status/validation,
    // wallet frames, authentication or payment requests to Apple services.
    return /^\/jsapi\/(?:v?1(?:\.\d+\.\d+)?|1\.latest)\/(?:apple-pay-sdk|apple-pay-button|apple-wallet-sdk)\.js$/.test(url.pathname);
  // Amazon's public bootstrap also identifies cPSPcheckout.js for its Stripe
  // integration. Both are static JavaScript; no Amazon checkout/session APIs.
  return ['static-na.payments-amazon.com', 'static-eu.payments-amazon.com', 'static-fe.payments-amazon.com'].includes(url.hostname) && ['/checkout.js', '/cPSPcheckout.js'].includes(url.pathname);
}

export const checkoutOutcomeSchema = z.object({
  operationId: z.uuid(), actorId: z.string(), livemode: z.literal(false),
  databaseStatus: z.string(), providerPaymentStatus: z.string(), providerErrorCode: z.string().nullable(),
  webhookVerified: z.boolean(), effectiveTier: z.enum(['neighbor', 'supporter', 'sustainer']).optional(),
});
export type CheckoutOutcome = z.infer<typeof checkoutOutcomeSchema>;
