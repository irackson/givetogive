/** GET-only correlation of processed application webhook rows with exact Stripe
 * snapshot events. This is not a verifier for arbitrary supplied webhook bytes:
 * the caller must obtain rows from the isolated DB and events from native Stripe.
 * Missing/unprocessed events remain unresolved; no journal mutation or retry. */
import { z } from 'zod';
const targetSchema = z.object({ platformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
 customerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/),
 paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/) }).strict();
const type = z.enum(['payment_intent.payment_failed', 'invoice.payment_failed']);
const rowSchema = z.object({ eventId: z.string().regex(/^evt_[A-Za-z0-9]+$/), objectId: z.string(), type,
 status: z.enum(['pending', 'processed', 'failed', 'ignored']), processedAt: z.union([z.string(), z.date(), z.null()]) });
export async function observeCurrentFailureEvents(rawTarget: unknown, rawRows: unknown,
 readEvent: (id: string) => Promise<unknown>, signal: AbortSignal) {
 const local = new AbortController(), deadline = AbortSignal.any([signal, local.signal, AbortSignal.timeout(30000)]);
 let stop: () => void = () => {};
 const interrupted = new Promise<never>((__resolve, reject) => {
  stop = () => reject(Error('Failure event observation interrupted'));
  deadline.addEventListener('abort', stop, { once: true }); if (deadline.aborted) stop();
 });
 try {
  const work = async () => {
   deadline.throwIfAborted();
   const target = targetSchema.parse(rawTarget), rows = z.array(rowSchema).max(100).parse(rawRows);
   if (new Set(rows.map(row => row.eventId)).size !== rows.length) throw Error('Duplicate events');
   for (const row of rows) if (row.objectId !== (row.type === 'invoice.payment_failed' ? target.invoiceId : target.paymentIntentId)) throw Error('Foreign object');
   const eligible = rows.filter(row => row.status === 'processed');
   // One admitted submission has at most one event of each accepted failure type.
   if (eligible.length > 2 || new Set(eligible.map(row => row.type)).size !== eligible.length) throw Error('Ambiguous event history');
   for (const row of eligible) {
    const processed = new Date(row.processedAt ?? '').getTime();
    if (!Number.isFinite(processed) || processed <= 0 || processed > Date.now() + 5000) throw Error('Invalid processed timestamp');
    const event = z.object({ id: z.literal(row.eventId), object: z.literal('event'), type: z.literal(row.type),
     livemode: z.literal(false), created: z.number().int().positive(), account: z.string().nullable().optional(),
     data: z.object({ object: z.unknown() }) }).parse(await readEvent(row.eventId)); deadline.throwIfAborted();
    if ((event.account ?? target.platformAccountId) !== target.platformAccountId) throw Error('Foreign account');
    if (row.type === 'payment_intent.payment_failed') z.object({ id: z.literal(target.paymentIntentId), object: z.literal('payment_intent'),
     livemode: z.literal(false), customer_account: z.literal(target.customerAccountId), currency: z.literal('usd'), amount: z.literal(500),
     amount_received: z.literal(0), status: z.literal('requires_payment_method'), last_payment_error: z.object({ code: z.literal('card_declined') }) }).parse(event.data.object);
    else z.object({ id: z.literal(target.invoiceId), object: z.literal('invoice'), livemode: z.literal(false),
     customer_account: z.literal(target.customerAccountId), currency: z.literal('usd'), amount_due: z.literal(500), amount_paid: z.literal(0),
     amount_remaining: z.literal(500), status: z.literal('open') }).parse(event.data.object);
   }
   return Object.freeze({ processedFailureEventCorrelated: eligible.length > 0,
    processedEventsChecked: eligible.length, webhookProcessingPending: rows.some(row => ['pending', 'failed'].includes(row.status)),
    paymentAccepted: false, retryAllowed: false, originalJournalFinalizationAllowed: false,
    nativeProviderAndSignatureIngressEvidenceRequired: true });
  };
  return await Promise.race([work(), interrupted]);
 } catch { throw Error('Current failure event rejected; original holds retained; private details withheld.'); }
 finally { deadline.removeEventListener('abort', stop); local.abort(); }
}
