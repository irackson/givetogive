import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCurrentFailureEvents } from '../src/checkout-current-failure-event.ts';
const target = { platformAccountId: 'acct_platform', customerAccountId: 'acct_member', invoiceId: 'in_fixture', paymentIntentId: 'pi_fixture' };
function fixture(): { rows: Record<string, any>[]; event: Record<string, any> } {
 return { rows: [{ eventId: 'evt_fixture', objectId: 'pi_fixture', type: 'payment_intent.payment_failed', status: 'processed', processedAt: new Date().toISOString() }],
  event: { id: 'evt_fixture', object: 'event', type: 'payment_intent.payment_failed', livemode: false, created: Math.floor(Date.now() / 1000),
   data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, customer_account: target.customerAccountId,
    currency: 'usd', amount: 500, amount_received: 0, status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } } } } };
}
test('correlates one exact processed failed PaymentIntent event without journal authority', async () => {
 const f = fixture(), calls: string[] = [];
 const result = await observeCurrentFailureEvents(target, f.rows, async id => { calls.push(id); return f.event; }, new AbortController().signal);
 assert.deepEqual(calls, ['evt_fixture']); assert.equal(result.processedFailureEventCorrelated, true);
 assert.equal(result.paymentAccepted, false); assert.equal(result.originalJournalFinalizationAllowed, false);
});
test('correlates the original open unpaid invoice failure event', async () => {
 const f = fixture(); f.rows[0]!.objectId = target.invoiceId; f.rows[0]!.type = 'invoice.payment_failed'; f.event.type = 'invoice.payment_failed';
 f.event.data.object = { id: target.invoiceId, object: 'invoice', livemode: false, customer_account: target.customerAccountId,
  currency: 'usd', amount_due: 500, amount_paid: 0, amount_remaining: 500, status: 'open' };
 assert.equal((await observeCurrentFailureEvents(target, f.rows, async () => f.event, new AbortController().signal)).processedFailureEventCorrelated, true);
});
test('missing, pending and failed processing remain unresolved without a Stripe request', async () => {
 for (const state of ['absent', 'pending', 'failed']) {
  const f = fixture(); if (state === 'absent') f.rows = []; else { f.rows[0]!.status = state; f.rows[0]!.processedAt = null; }
  const result = await observeCurrentFailureEvents(target, f.rows, async () => { throw Error('must not read'); }, new AbortController().signal);
  assert.equal(result.processedFailureEventCorrelated, false); assert.equal(result.webhookProcessingPending, state !== 'absent');
 }
});
test('rejects foreign, duplicate, old-object, live and paid event evidence', async () => {
 const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
  f => { f.rows.push({ ...f.rows[0] }); }, f => { f.rows[0]!.objectId = 'pi_foreign'; },
  f => { f.rows[0]!.processedAt = null; }, f => { f.rows[0]!.processedAt = 'invalid'; },
  f => { f.event.id = 'evt_other'; }, f => { f.event.account = 'acct_other'; }, f => { f.event.livemode = true; },
  f => { f.event.type = 'payment_intent.succeeded'; }, f => { f.event.data.object.id = 'pi_other'; },
  f => { f.event.data.object.customer_account = 'acct_other'; }, f => { f.event.data.object.amount_received = 500; },
  f => { f.event.data.object.amount = 1500; }, f => { f.event.data.object.last_payment_error.code = 'authentication_required'; },
 ];
 for (const change of changes) { const f = fixture(); change(f);
  await assert.rejects(observeCurrentFailureEvents(target, f.rows, async () => f.event, new AbortController().signal), /private details withheld/);
 }
});
test('interrupts a hung read without retries and redacts provider errors', async () => {
 const f = fixture(), controller = new AbortController(); let calls = 0;
 await assert.rejects(observeCurrentFailureEvents(target, f.rows, async () => {
  calls++; controller.abort(); return new Promise(() => {});
 }, controller.signal), /private details withheld/); assert.equal(calls, 1);
 await assert.rejects(observeCurrentFailureEvents(target, f.rows, async () => { throw Error('PRIVATE_PROVIDER_BODY'); }, new AbortController().signal),
  error => error instanceof Error && !error.message.includes('PRIVATE_PROVIDER_BODY'));
});
