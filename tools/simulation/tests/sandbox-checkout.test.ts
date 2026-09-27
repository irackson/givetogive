import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedCheckoutRequest, sandboxOrigin, validateCheckoutContext, type SandboxBoundary, type CheckoutScenario } from '../src/sandbox-policy.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { SandboxCheckoutExecutor } from '../src/sandbox-checkout.ts';
import type { CheckoutDriver } from '../src/stripe-checkout-driver.ts';

function fixture() {
  const operationId = randomUUID(); const actorId = 'synthetic-person-one';
  const boundary: SandboxBoundary = { credentials: { runId: 'sandbox-run', origin: sandboxOrigin, databaseIdentity: 'isolated-db', runnerToken: 'r'.repeat(40), agents: [{ id: 'one', userId: actorId, token: 't'.repeat(40) }] }, actorId, operationId, protectionBypass: 'b'.repeat(40), maximumAmountCents: 1000 };
  const context = { environment: 'staging' as const, databaseIdentity: 'isolated-db', runId: 'sandbox-run', operationId, actorId, sessionId: 'cs_test_publicfixture', url: 'https://checkout.stripe.com/c/pay/cs_test_publicfixture#opaque', livemode: false as const, currency: 'usd' as const, amountTotal: 500, mode: 'payment' as const, status: 'open' as const, paymentStatus: 'unpaid' as const, expiresAt: Math.floor(Date.now() / 1000) + 600, returnOrigin: sandboxOrigin, verifiedAt: new Date().toISOString() };
  return { boundary, context };
}
function ledger() { return new SandboxLedger(join(mkdtempSync(join(tmpdir(), 'g2g-payment-')), 'sandbox.sqlite'), 'sandbox-run', 1500, 1000); }
function driver(events: string[], fail = false): CheckoutDriver {
  return { async open() { events.push('open'); }, async fillFixture(scenario) { events.push(scenario); if (fail) throw new Error('secret card value and private URL'); }, async submit() { events.push('submit'); }, async challenge(success) { events.push(success ? '3ds-complete' : '3ds-fail'); }, async cancel() { events.push('cancel'); }, async close() { events.push('close'); } };
}
test('sandbox verification rejects live, wrong actor/origin/run, stale, expired and over-budget sessions before opening a browser', () => {
  const { boundary, context } = fixture();
  assert.doesNotThrow(() => validateCheckoutContext(context, boundary));
  for (const patch of [{ livemode: true }, { actorId: 'someone-else' }, { runId: 'another-run' }, { databaseIdentity: 'production' }, { currency: 'eur' }, { amountTotal: 1001 }, { amountTotal: Infinity }, { amountTotal: 0.5 }, { status: 'complete' }, { paymentStatus: 'paid' }, { expiresAt: 1 }, { verifiedAt: new Date(Date.now() - 60000).toISOString() }, { url: 'https://checkout.stripe.com.evil.example/c/pay/cs_test_publicfixture' }, { url: 'https://checkout.stripe.com/c/pay/cs_live_real' }, { sessionId: 'cs_live_real' }, { returnOrigin: 'https://givetogive.vercel.app' }]) assert.throws(() => validateCheckoutContext({ ...context, ...patch }, boundary));
  assert.throws(() => validateCheckoutContext(context, { ...boundary, protectionBypass: '' }));
  assert.throws(() => validateCheckoutContext(context, { ...boundary, credentials: { ...boundary.credentials, origin: 'https://givetogive.vercel.app' } }));
});
test('payment navigation only permits the exact verified Checkout and its own staging return', () => {
  const { boundary, context } = fixture(); const verified = validateCheckoutContext(context, boundary);
  assert.equal(allowedCheckoutRequest(context.url, true, verified), true);
  assert.equal(allowedCheckoutRequest(`https://checkout.stripe.com/c/pay/cs_test_other`, true, verified), false);
  assert.equal(allowedCheckoutRequest('https://evil.stripe.com.evil.example/x', false, verified), false);
  assert.equal(allowedCheckoutRequest('https://hooks.stripe.com/3d_secure_2/challenge', false, verified), true);
  assert.equal(allowedCheckoutRequest('https://hooks.stripe.com/3d_secure_2/challenge', true, verified), false);
  assert.equal(allowedCheckoutRequest(`${sandboxOrigin}/giving/${context.operationId}?checkout=returned`, true, verified), true);
  assert.equal(allowedCheckoutRequest(`${sandboxOrigin}/admin`, true, verified), false);
  assert.equal(allowedCheckoutRequest('https://givetogive.vercel.app/', false, verified), false);
});
test('durable admission prevents repeated submission, budget reuse and cross-operation overdrafts', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'g2g-budget-')), 'sandbox.sqlite');
  const first = new SandboxLedger(path, 'sandbox-run', 1500, 1000);
  const op = randomUUID(); first.reserve(op, 'one', 600, 'success'); first.update(op, 'ambiguous'); first.close();
  const reopened = new SandboxLedger(path, 'sandbox-run', 1500, 1000);
  try {
    assert.equal(reopened.get(op)?.state, 'ambiguous');
    assert.throws(() => reopened.reserve(op, 'one', 600, 'success'), /already/);
    assert.throws(() => reopened.reserve(randomUUID(), 'one', 500, 'success'), /budget/);
    reopened.reserve(randomUUID(), 'two', 800, 'decline');
    assert.throws(() => reopened.reserve(randomUUID(), 'three', 200, 'success'), /budget/);
    assert.throws(() => reopened.reserve(randomUUID(), 'three', NaN, 'success'));
  } finally { reopened.close(); }
});
for (const scenario of ['success', 'decline', 'three_ds_success', 'three_ds_failure', 'cancel'] as CheckoutScenario[]) test(`fixed ${scenario} scenario only accepts its authoritative outcome`, async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = [];
  const success = ['success', 'three_ds_success'].includes(scenario);
  const outcome = { operationId: context.operationId, actorId: context.actorId, livemode: false, databaseStatus: success ? 'succeeded' : 'checkout_open', providerPaymentStatus: success ? 'succeeded' : scenario === 'cancel' ? 'unpaid' : 'requires_payment_method', providerErrorCode: scenario === 'decline' ? 'card_declined' : scenario === 'three_ds_failure' ? 'payment_intent_authentication_failure' : null, webhookVerified: success };
  try {
    const executor = new SandboxCheckoutExecutor(store, () => driver(events));
    const result = await executor.execute({ context: async () => context, outcome: async () => outcome }, boundary, scenario);
    assert.match(result.result, scenario === 'cancel' ? /canceled_unpaid/ : /^verified_/);
    assert.equal(events.filter(event => event === 'submit').length, scenario === 'cancel' ? 0 : 1);
    assert.equal(events.at(-1), 'close');
    if (scenario.startsWith('three_ds_')) assert.ok(events.includes(scenario === 'three_ds_success' ? '3ds-complete' : '3ds-fail'));
  } finally { store.close(); }
});
test('redirect or provider success alone never grants a successful result; ambiguous attempts cannot auto-submit twice', async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = [];
  const api = { context: async () => context, outcome: async () => ({ operationId: context.operationId, actorId: context.actorId, livemode: false, databaseStatus: 'pending', providerPaymentStatus: 'succeeded', providerErrorCode: null, webhookVerified: false }) };
  try {
    const executor = new SandboxCheckoutExecutor(store, () => driver(events));
    await assert.rejects(executor.execute(api, boundary, 'success', { timeoutMs: 1 }), /Reconcile/);
    assert.equal(store.get(context.operationId)?.state, 'ambiguous');
    await assert.rejects(executor.execute(api, boundary, 'success'), /already/);
    assert.equal(events.filter(event => event === 'submit').length, 1);
  } finally { store.close(); }
});
test('sensitive driver exceptions are replaced with fixed phase-only errors and the browser closes', async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = [];
  try {
    const executor = new SandboxCheckoutExecutor(store, () => driver(events, true));
    await assert.rejects(executor.execute({ context: async () => context, outcome: async () => ({}) }, boundary, 'success'), error => error instanceof Error && error.message.includes('during filling') && !error.message.includes('secret card'));
    assert.equal(events.at(-1), 'close');
    assert.equal(store.get(context.operationId)?.state, 'ambiguous');
  } finally { store.close(); }
});
