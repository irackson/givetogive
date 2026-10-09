/** Read-only post-submit provider observation. An exact session -> invoice ->
 * InvoicePayment -> PaymentIntent graph is mandatory. Never searches a customer's
 * unrelated payments or infers a decline from a browser alert. Injected adapters
 * are test evidence only; this module grants no entitlement or journal authority. */
import { z } from 'zod';
export interface CurrentDeclineReads {
 checkout(id: string): Promise<unknown>;
 invoice(id: string): Promise<unknown>;
 invoicePayments(id: string): Promise<unknown>;
 paymentIntent(id: string): Promise<unknown>;
}
const id = z.string().min(1);
const targetSchema = z.object({ operationId: z.uuid(), sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]+$/),
 customerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), origin: z.literal('https://givetogive-staging.vercel.app') }).strict();
const reference = z.union([id, z.object({ id })]).nullable();
const ref = (value: z.infer<typeof reference>) => typeof value === 'string' ? value : value?.id ?? null;
const sessionSchema = z.object({ id, object: z.literal('checkout.session'), customer_account: id, client_reference_id: id,
 livemode: z.literal(false), currency: z.literal('usd'), amount_total: z.literal(500), mode: z.literal('subscription'),
 status: z.enum(['open', 'expired']), payment_status: z.literal('unpaid'), invoice: reference,
 subscription: reference, payment_intent: z.null(), success_url: id, cancel_url: id });
const invoiceSchema = z.object({ id, object: z.literal('invoice'), customer_account: id, livemode: z.literal(false),
 currency: z.literal('usd'), amount_due: z.literal(500), amount_paid: z.literal(0), amount_remaining: z.literal(500),
 status: z.literal('open') });
const entrySchema = z.object({ id, object: z.literal('invoice_payment'), invoice: reference, livemode: z.literal(false),
 currency: z.literal('usd'), amount_requested: z.literal(500), amount_paid: z.union([z.literal(0), z.null()]),
 is_default: z.boolean(), status: z.literal('open'), status_transitions: z.object({ paid_at: z.null() }),
 payment: z.object({ type: z.literal('payment_intent'), payment_intent: reference }) });
const intentSchema = z.object({ id, object: z.literal('payment_intent'), customer_account: id, livemode: z.literal(false),
 currency: z.literal('usd'), amount: z.literal(500), amount_received: z.literal(0), status: z.literal('requires_payment_method'),
 last_payment_error: z.object({ code: z.literal('card_declined') }) });
export async function observeCurrentProviderDecline(rawTarget: unknown, reads: CurrentDeclineReads, signal: AbortSignal) {
 const started = Date.now();
 const active = () => { signal.throwIfAborted(); if (Date.now() - started > 30000) throw Error('Observation deadline exceeded'); };
 const read = async (operation: () => Promise<unknown>) => {
  active();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(15000, 30000 - (Date.now() - started))))]);
  let stop: () => void = () => {};
  try {
   return await Promise.race([Promise.resolve().then(operation), new Promise<never>((__resolve, reject) => {
    stop = () => reject(Error('Read observation interrupted')); deadline.addEventListener('abort', stop, { once: true });
    if (deadline.aborted) stop();
   })]);
  } finally { deadline.removeEventListener('abort', stop); }
 };
 const unresolved = () => Object.freeze({ providerDeclineObserved: false, reason: 'exact-checkout-payment-graph-unavailable',
  paymentAccepted: false, retryAllowed: false, originalHoldsRetained: true });
 try {
  active();
  const target = targetSchema.parse(rawTarget);
  const parseSession = (raw: unknown) => {
   const session = sessionSchema.parse(raw);
   if (session.id !== target.sessionId || session.customer_account !== target.customerAccountId ||
    session.client_reference_id !== target.operationId || session.success_url !== `${target.origin}/giving/${target.operationId}?checkout=returned` ||
    session.cancel_url !== `${target.origin}/giving/${target.operationId}?checkout=canceled`) throw Error('Session ownership mismatch');
   return session;
  };
  const before = parseSession(await read(() => reads.checkout(target.sessionId))); active();
  const invoiceId = ref(before.invoice);
  if (!invoiceId) return unresolved();
  const invoice = invoiceSchema.parse(await read(() => reads.invoice(invoiceId))); active();
  if (invoice.id !== invoiceId || invoice.customer_account !== target.customerAccountId) throw Error('Invoice ownership mismatch');
  const payments = z.object({ data: z.array(entrySchema).max(10), has_more: z.literal(false) })
   .parse(await read(() => reads.invoicePayments(invoiceId))); active();
  if (payments.data.some(entry => ref(entry.invoice) !== invoiceId) || new Set(payments.data.map(entry => entry.id)).size !== payments.data.length)
   throw Error('Invoice payment mismatch');
  const defaults = payments.data.filter(entry => entry.is_default);
  if (defaults.length === 0) return unresolved();
  if (defaults.length !== 1) throw Error('Ambiguous default invoice payment');
  const intentId = ref(defaults[0]!.payment.payment_intent);
  if (!intentId) return unresolved();
  const intent = intentSchema.parse(await read(() => reads.paymentIntent(intentId))); active();
  if (intent.id !== intentId || intent.customer_account !== target.customerAccountId) throw Error('PaymentIntent ownership mismatch');
  const after = parseSession(await read(() => reads.checkout(target.sessionId))); active();
  if (ref(after.invoice) !== invoiceId || ref(after.subscription) !== ref(before.subscription) || after.status !== before.status)
   throw Error('Session changed during observation');
  return Object.freeze({ providerDeclineObserved: true, observedAt: new Date().toISOString(), sessionId: target.sessionId,
   invoiceId, invoicePaymentId: defaults[0]!.id, paymentIntentId: intentId, amountReceivedCents: 0,
   paymentAccepted: false, retryAllowed: false, originalHoldsRetained: true, independentAppWebhookAndLedgerVerificationRequired: true });
 } catch { throw Error('Current decline graph rejected; originals and holds retained; no retry; private details withheld.'); }
}
