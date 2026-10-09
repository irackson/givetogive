import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCurrentProviderDecline, type CurrentDeclineReads } from '../src/checkout-current-decline.ts';
const target = { operationId: '398c5cf9-62de-4908-afb0-ce6321e8b3ad', sessionId: 'cs_test_fixture',
 customerAccountId: 'acct_fixture', origin: 'https://givetogive-staging.vercel.app' };
function fixture() {
 const session = { id: target.sessionId, object: 'checkout.session', customer_account: target.customerAccountId,
  client_reference_id: target.operationId, livemode: false, currency: 'usd', amount_total: 500, mode: 'subscription',
  status: 'open', payment_status: 'unpaid', invoice: 'in_fixture', subscription: 'sub_fixture', payment_intent: null,
  success_url: `${target.origin}/giving/${target.operationId}?checkout=returned`, cancel_url: `${target.origin}/giving/${target.operationId}?checkout=canceled` };
 const invoice = { id: 'in_fixture', object: 'invoice', customer_account: target.customerAccountId, livemode: false,
  currency: 'usd', amount_due: 500, amount_paid: 0, amount_remaining: 500, status: 'open' };
 const entry = { id: 'inpay_fixture', object: 'invoice_payment', invoice: invoice.id, livemode: false,
  currency: 'usd', amount_requested: 500, amount_paid: null, is_default: true, status: 'open',
  status_transitions: { paid_at: null }, payment: { type: 'payment_intent', payment_intent: 'pi_fixture' } };
 const intent = { id: 'pi_fixture', object: 'payment_intent', customer_account: target.customerAccountId, livemode: false,
  currency: 'usd', amount: 500, amount_received: 0, status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } };
 const payments = { data: [entry], has_more: false };
 const calls: string[] = [];
 const reads: CurrentDeclineReads = { checkout: async id => { calls.push(`checkout:${id}`); return session; },
  invoice: async id => { calls.push(`invoice:${id}`); return invoice; }, invoicePayments: async id => { calls.push(`invoicePayments:${id}`); return payments; },
  paymentIntent: async id => { calls.push(`intent:${id}`); return intent; } };
 return { session, invoice, entry, intent, payments, calls, reads };
}
test('observes the exact unpaid declined graph without financial acceptance or journal writes', async () => {
 const f = fixture(), result = await observeCurrentProviderDecline(target, f.reads, new AbortController().signal);
 assert.equal(result.providerDeclineObserved, true); assert.equal(result.paymentAccepted, false);
 assert.equal(result.originalHoldsRetained, true); assert.equal(result.retryAllowed, false);
 assert.deepEqual(f.calls, ['checkout:cs_test_fixture', 'invoice:in_fixture', 'invoicePayments:in_fixture', 'intent:pi_fixture', 'checkout:cs_test_fixture']);
});
test('missing exact session invoice remains unresolved without searching other customer payments', async () => {
 const f = fixture(); (f.session as Record<string, unknown>).invoice = null;
 const result = await observeCurrentProviderDecline(target, f.reads, new AbortController().signal);
 assert.equal(result.providerDeclineObserved, false); assert.equal(result.originalHoldsRetained, true);
 assert.deepEqual(f.calls, ['checkout:cs_test_fixture']);
});
test('missing default invoice PaymentIntent remains unresolved', async () => {
 for (const missing of ['entry', 'intent']) {
  const f = fixture(); if (missing === 'entry') f.payments.data = []; else (f.entry.payment as Record<string, unknown>).payment_intent = null;
  const result = await observeCurrentProviderDecline(target, f.reads, new AbortController().signal);
  assert.equal(result.providerDeclineObserved, false); assert.equal(f.calls.some(call => call.startsWith('intent:')), false);
 }
});
test('rejects foreign, live, paid, wrong-amount and incomplete provider objects', async () => {
 const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
  f => { f.session.customer_account = 'acct_other'; }, f => { f.session.client_reference_id = 'other'; },
  f => { f.session.payment_status = 'paid'; }, f => { f.session.amount_total = 1500; }, f => { f.session.success_url += '&other=1'; },
  f => { f.invoice.id = 'in_other'; }, f => { f.invoice.customer_account = 'acct_other'; }, f => { f.invoice.amount_paid = 500; },
  f => { f.entry.invoice = 'in_other'; }, f => { f.entry.livemode = true; }, f => { (f.entry as Record<string, unknown>).amount_paid = 500; },
  f => { f.payments.has_more = true; }, f => { f.payments.data.push({ ...f.entry }); },
  f => { f.payments.data.push({ ...f.entry, id: 'inpay_other' }); },
  f => { f.intent.id = 'pi_other'; }, f => { f.intent.customer_account = 'acct_other'; }, f => { f.intent.livemode = true; },
  f => { f.intent.amount_received = 500; }, f => { f.intent.last_payment_error.code = 'authentication_required'; },
 ];
 for (const change of changes) { const f = fixture(); change(f);
  await assert.rejects(observeCurrentProviderDecline(target, f.reads, new AbortController().signal), /private details withheld/);
 }
});
test('rejects a graph change between bracketing session reads', async () => {
 const f = fixture(); let count = 0;
 f.reads.checkout = async () => ({ ...f.session, invoice: ++count === 1 ? 'in_fixture' : 'in_changed' });
 await assert.rejects(observeCurrentProviderDecline(target, f.reads, new AbortController().signal), /private details withheld/);
});
test('aborted observation performs no provider reads and provider errors are redacted', async () => {
 const f = fixture(), controller = new AbortController(); controller.abort();
 await assert.rejects(observeCurrentProviderDecline(target, f.reads, controller.signal), /private details withheld/); assert.deepEqual(f.calls, []);
 f.reads.checkout = async () => { throw Error('PRIVATE_RAW_PROVIDER_DATA'); };
 await assert.rejects(observeCurrentProviderDecline(target, f.reads, new AbortController().signal), error =>
  error instanceof Error && !error.message.includes('PRIVATE_RAW_PROVIDER_DATA'));
});
test('abort interrupts an outstanding read without resubmitting or waiting for adapter completion', async () => {
 const f = fixture(), controller = new AbortController(); let calls = 0;
 f.reads.checkout = async () => { calls++; controller.abort(); return new Promise(() => {}); };
 await assert.rejects(observeCurrentProviderDecline(target, f.reads, controller.signal), /private details withheld/);
 assert.equal(calls, 1);
});
