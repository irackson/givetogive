import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedCheckoutRequest, sandboxOrigin, validateCheckoutContext, type SandboxBoundary, type CheckoutScenario } from '../src/sandbox-policy.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { SandboxCheckoutExecutor } from '../src/sandbox-checkout.ts';
import { StripeCheckoutDriver, checkoutBrowserEnvironment, checkoutRequestCategory, checkoutFailureCategory, type CheckoutDriver } from '../src/stripe-checkout-driver.ts';
import { SurfaceReadUnavailable } from '../src/hosted-checkout-worker.ts';

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

test('payment Chromium receives only platform OS variables, never root observer credentials or debug hooks', () => {
  const env = { PATH: '/public/bin', HOME: '/public/home', LANG: 'en_US.UTF-8', PROGRAMDATA: 'C:/ProgramData', SYSTEMROOT: 'C:/Windows',
    STRIPE_SECRET_KEY: 'public-forbidden-fixture', DATABASE_URL: 'public-forbidden-fixture', NEXTAUTH_SECRET: 'public-forbidden-fixture',
    GITHUB_TOKEN: 'public-forbidden-fixture', CHECKOUT_BUNDLE_KEY: 'public-forbidden-fixture', DEBUG: 'public-forbidden-fixture',
    PWDEBUG: 'public-forbidden-fixture', NODE_OPTIONS: 'public-forbidden-fixture', LD_PRELOAD: 'public-forbidden-fixture' };
  assert.deepEqual(checkoutBrowserEnvironment(env, 'linux'), { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG });
  assert.deepEqual(checkoutBrowserEnvironment(env, 'darwin'), { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG });
  assert.deepEqual(checkoutBrowserEnvironment(env, 'win32'), { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG, PROGRAMDATA: env.PROGRAMDATA, SYSTEMROOT: env.SYSTEMROOT });
});

test('driver diagnostics expose fixed booleans/counters, never an unknown provider label or digest', () => {
  const observed = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'diagnostic@givetogive.invalid');
  // Deliberately synthetic adapter data, not actual provider/browser evidence.
  Object.assign(observed, { lastSurface: { testModeLabel: true, visibleCard: false, panelCount: 1,
    panelDigest: 'private-digest-sentinel', controlName: 'private-label-sentinel', controlCount: 1,
    visible: true, enabled: false, unchecked: true, requiresCaptchaOrWalletOrAttestation: true, unknownInstructions: true } });
  const diagnostic = observed.diagnostics();
  assert.equal(diagnostic.reviewedPanelMatches, false);
  assert.equal(diagnostic.reviewedControlMatches, false);
  assert.equal(diagnostic.requiresCaptchaOrWalletOrAttestation, true);
  assert.equal(JSON.stringify(diagnostic).includes('private-'), false);
  assert.equal('controlName' in diagnostic, false);
  assert.equal('panelDigest' in diagnostic, false);
});
test('network diagnostics discard private URLs, resource names and unknown failure messages without granting admission', () => {
  const samples = [
    ['https://checkout.stripe.com/private-sentinel?secret=private-sentinel', 'stripe-owned'],
    ['https://fonts.googleapis.com/private-sentinel', 'google-fonts'],
    ['https://m.stripe.network/private-sentinel', 'stripe-network'],
    ['https://newassets.hcaptcha.com/private-sentinel', 'hcaptcha'],
    [`${sandboxOrigin}/private-sentinel`, 'staging'],
    ['https://private-sentinel.example.invalid/private-sentinel', 'other-https'],
    ['https://checkout.stripe.com.evil.invalid/private-sentinel', 'other-https'],
    ['https://private-sentinel@checkout.stripe.com/private-sentinel', 'unsafe-or-non-https'],
    ['private-sentinel', 'unsafe-or-non-https'],
  ] as const;
  for (const [url, destination] of samples) {
    const category = checkoutRequestCategory(url, 'private-resource-sentinel', true);
    assert.deepEqual(category, { destination, resource: 'other', topNavigation: true });
    assert.equal(JSON.stringify(category).includes('private-'), false);
  }
  assert.equal(checkoutRequestCategory('https://fonts.gstatic.com/private-sentinel', 'font', false).resource, 'font');
  assert.equal(checkoutFailureCategory('net::ERR_ABORTED'), 'aborted');
  assert.equal(checkoutFailureCategory('net::ERR_BLOCKED_BY_CLIENT'), 'blocked');
  assert.equal(checkoutFailureCategory('net::ERR_TIMED_OUT'), 'timeout');
  assert.equal(checkoutFailureCategory('net::ERR_CONNECTION_RESET'), 'connection');
  assert.equal(checkoutFailureCategory('private-sentinel https://private-sentinel.invalid'), 'other');
  const { boundary, context } = fixture();
  assert.equal(allowedCheckoutRequest('https://fonts.googleapis.com/private-sentinel', false, validateCheckoutContext(context, boundary)), false);
});
test('read-only frame observation may reread a transient tree without performing a control action', async () => {
  const observed = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'readonly@givetogive.invalid');
  let reads = 0;
  Object.assign(observed, {
    async readSurface() {
      reads++;
      if (reads === 1) throw new SurfaceReadUnavailable('frame-discovery');
      return { visibleCard: true };
    },
    async fillFixture() { assert.fail('Read-only inspection cannot enter values.'); },
    async submit() { assert.fail('Read-only inspection cannot submit.'); },
    async cancel() { assert.fail('Read-only inspection cannot cancel.'); },
  });
  await observed.inspectSurface(1000);
  assert.equal(reads, 2);
  assert.equal(observed.diagnostics().noticeClickAttempts, 0);
});
test('read-only observation refuses persistent frame failure and does not retry policy, memory or panel failures', async () => {
  for (const error of [new SurfaceReadUnavailable('panel-dom'), new Error('Hosted Checkout policy rejected; private details withheld.'), new Error('Sandbox Checkout memory floor reached.')]) {
    const observed = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'readonly@givetogive.invalid');
    let reads = 0;
    Object.assign(observed, { async readSurface() { reads++; throw error; } });
    await assert.rejects(observed.inspectSurface(1000));
    assert.equal(reads, 1);
  }
  const observed = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'readonly@givetogive.invalid');
  let reads = 0;
  Object.assign(observed, { async readSurface() { reads++; throw new SurfaceReadUnavailable('frame-discovery'); } });
  await assert.rejects(observed.inspectSurface(1), SurfaceReadUnavailable);
  assert.equal(reads, 1);
});
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
  for (const dependency of ['https://m.stripe.network/inner.html', 'https://hcaptcha.com/1/api.js', 'https://newassets.hcaptcha.com/captcha/v1/challenge.html']) {
    assert.equal(allowedCheckoutRequest(dependency, false, verified), true);
    assert.equal(allowedCheckoutRequest(dependency, true, verified), false);
  }
  for (const forbidden of ['http://hcaptcha.com/api.js', 'https://hcaptcha.com.evil.example/api.js', 'https://evil.example/m.stripe.network', 'https://user:password@hcaptcha.com/api.js', 'https://m.stripe.network:8443/inner.html']) assert.equal(allowedCheckoutRequest(forbidden, false, verified), false);
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

test('provider verification is refreshed after form entry and immediately before the only submit', async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = [];
  try {
    const executor = new SandboxCheckoutExecutor(store, () => driver(events));
    await executor.execute({
      context: async () => { events.push('verify'); return { ...context, verifiedAt: new Date().toISOString() }; },
      outcome: async () => ({ operationId: context.operationId, actorId: context.actorId, livemode: false, databaseStatus: 'succeeded', providerPaymentStatus: 'succeeded', providerErrorCode: null, webhookVerified: true }),
    }, boundary, 'success');
    assert.deepEqual(events, ['verify', 'open', 'verify', 'success', 'verify', 'submit', 'close']);
  } finally { store.close(); }
});

test('agent notice permission is member-owned, consumed once and survives ledger restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'g2g-notice-')), 'sandbox.sqlite');
  const operation = randomUUID(); const first = new SandboxLedger(path, 'sandbox-run', 1500, 1000);
  assert.throws(() => first.acknowledgeAgentNotice(operation, 'one'), /reserved/);
  first.reserve(operation, 'one', 500, 'success');
  assert.throws(() => first.acknowledgeAgentNotice(operation, 'other'), /reserved/);
  first.acknowledgeAgentNotice(operation, 'one'); first.close();
  const reopened = new SandboxLedger(path, 'sandbox-run', 1500, 1000);
  try {
    assert.throws(() => reopened.acknowledgeAgentNotice(operation, 'one'), /already consumed/);
    const second = randomUUID(); reopened.reserve(second, 'one', 500, 'success'); reopened.update(second, 'submitted');
    assert.throws(() => reopened.acknowledgeAgentNotice(second, 'one'), /reserved/);
  } finally { reopened.close(); }
});

test('the driver notice callback independently refreshes the exact admitted context', async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = []; let reads = 0;
  try {
    const executor = new SandboxCheckoutExecutor(store, admitNotice => ({
      ...driver(events), async fillFixture() { events.push('notice'); await admitNotice(); },
    }));
    await assert.rejects(executor.execute({
      context: async () => (++reads < 3 ? context : { ...context, amountTotal: 600 }),
      outcome: async () => ({}),
    }, boundary, 'success'), /during filling/);
    assert.deepEqual(events, ['open', 'notice', 'close']);
    assert.equal(store.get(context.operationId)?.state, 'ambiguous');
  } finally { store.close(); }
});

for (const patch of [
  { status: 'expired' }, { paymentStatus: 'paid' }, { amountTotal: 600 },
  { mode: 'subscription' }, { expiresAt: 1 },
  { verifiedAt: new Date(Date.now() - 60000).toISOString() },
  { sessionId: 'cs_test_replaced', url: 'https://checkout.stripe.com/c/pay/cs_test_replaced#opaque' },
  { url: 'https://checkout.stripe.com/c/pay/cs_test_publicfixture#changed' },
  { actorId: 'different-actor' }, { livemode: true },
]) test(`changed or stale post-fill context prevents submission: ${Object.keys(patch).join(',')}`, async () => {
  const { boundary, context } = fixture(); const store = ledger(); const events: string[] = []; let reads = 0;
  try {
    const executor = new SandboxCheckoutExecutor(store, () => driver(events));
    await assert.rejects(executor.execute({
      context: async () => (++reads < 3 ? context : { ...context, ...patch }),
      outcome: async () => { throw Error('Outcome must not be read before a submit.'); },
    }, boundary, 'success'), /during pre-submit verification/);
    assert.equal(reads, 3);
    assert.deepEqual(events, ['open', 'success', 'close']);
    assert.equal(store.get(context.operationId)?.state, 'ambiguous');
    await assert.rejects(executor.execute({ context: async () => context, outcome: async () => ({}) }, boundary, 'success'), /already/);
    assert.equal(events.filter(event => event === 'submit').length, 0);
  } finally { store.close(); }
});
