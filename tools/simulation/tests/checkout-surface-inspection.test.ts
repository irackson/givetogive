import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sealSurfaceInspection, openSurfaceInspection } from '../src/checkout-surface-inspection.ts';
import { sandboxOrigin, validateCheckoutContext, type VerifiedCheckout } from '../src/sandbox-policy.ts';

function fixture() {
  const now = Date.now(), key = Buffer.alloc(32, 7), binding = { head: 'a'.repeat(40), nonce: 'b'.repeat(32) };
  const checkout: VerifiedCheckout = { environment: 'staging', databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
    runId: '88888888-8888-4888-8888-888888888888', operationId: '99999999-9999-4999-8999-999999999999',
    actorId: 'synthetic-private-fixture', sessionId: 'cs_test_privateFixture',
    url: 'https://checkout.stripe.com/c/pay/cs_test_privateFixture#private-fixture',
    livemode: false, currency: 'usd', amountTotal: 500, mode: 'subscription', status: 'open', paymentStatus: 'unpaid',
    expiresAt: Math.floor(now / 1000) + 1800, returnOrigin: sandboxOrigin, verifiedAt: new Date(now).toISOString() };
  return { now, key, binding, checkout, email: 'private-fixture@givetogive.invalid' };
}
test('surface inspection ciphertext binds purpose, exact head and nonce without exposing the owned URL', () => {
  const { key, checkout, email, binding, now } = fixture();
  const encrypted = sealSurfaceInspection(key, checkout, email, binding, now);
  assert.equal(encrypted.includes('private-fixture'), false);
  assert.equal(encrypted.includes(checkout.url), false);
  assert.deepEqual(openSurfaceInspection(key, encrypted, binding, now).checkout, checkout);
  assert.notEqual(sealSurfaceInspection(key, checkout, email, binding, now), encrypted, 'Every encryption uses a fresh IV.');
  for (const altered of [{ head: 'c'.repeat(40), nonce: binding.nonce }, { ...binding, nonce: 'd'.repeat(32) }])
    assert.throws(() => openSurfaceInspection(key, encrypted, altered, now));
  assert.throws(() => openSurfaceInspection(Buffer.alloc(32, 8), encrypted, binding, now));
  const tampered = Buffer.from(encrypted, 'base64'); tampered[20] = tampered[20]! ^ 1;
  assert.throws(() => openSurfaceInspection(key, tampered.toString('base64'), binding, now));
  for (const malformed of ['', 'not-base64-private-fixture', 'A'.repeat(12001), encrypted.slice(0, -4)])
    assert.throws(() => openSurfaceInspection(key, malformed, binding, now), error => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'Read-only Checkout inspection input rejected; private details withheld.'); return true;
    });
});
test('inspection preserves capture timestamps and cannot become financial pre-submit proof after queue time', () => {
  const { key, checkout, email, binding, now } = fixture();
  const encrypted = sealSurfaceInspection(key, checkout, email, binding, now);
  const observed = openSurfaceInspection(key, encrypted, binding, now + 120000);
  assert.equal(observed.checkout.verifiedAt, checkout.verifiedAt);
  assert.throws(() => validateCheckoutContext(observed.checkout, { actorId: checkout.actorId, operationId: checkout.operationId,
    maximumAmountCents: 500, protectionBypass: 'public-fixture-bypass', credentials: { runId: checkout.runId,
      origin: sandboxOrigin, databaseIdentity: checkout.databaseIdentity, runnerToken: 'public-fixture-runner-token', agents: [] } }, now + 120000));
  assert.throws(() => openSurfaceInspection(key, encrypted, binding, now + 600000));
  assert.throws(() => openSurfaceInspection(key, encrypted, binding, now - 5001));
});
test('inspection rejects real identities, live/foreign/expired/paid sessions and stale original capture proof', () => {
  const { key, checkout, email, binding, now } = fixture();
  for (const change of [{ actorId: 'real-person' }, { livemode: true }, { databaseIdentity: 'production' },
    { status: 'expired' }, { paymentStatus: 'paid' }, { amountTotal: 1501 }, { expiresAt: 1 },
    { url: 'https://checkout.stripe.com.evil.invalid/c/pay/cs_test_privateFixture' },
    { url: checkout.url.replace('#private-fixture', '?private-fixture=1') },
    { verifiedAt: new Date(now - 30001).toISOString() }]) {
    assert.throws(() => sealSurfaceInspection(key, { ...checkout, ...change } as VerifiedCheckout, email, binding, now));
  }
  assert.throws(() => sealSurfaceInspection(key, checkout, 'real@example.invalid', binding, now));
});
test('hosted surface mode is encrypted and read-only, with no browser secrets, payment action calls or public artifacts', () => {
  const source = readFileSync(new URL('../src/checkout-transport-diagnostic.ts', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../../.github/workflows/checkout-diagnostic.yml', import.meta.url), 'utf8');
  assert.match(source, /openSurfaceInspection/); assert.match(source, /driver\.inspectSurface\(30000\)/);
  assert.doesNotMatch(source, /driver\.(?:fillFixture|submit|challenge|cancel)\(/);
  assert.match(source, /delete process\.env\.CHECKOUT_SURFACE_PAYLOAD/);
  assert.match(workflow, /surface_payload:/); assert.match(workflow, /CHECKOUT_SURFACE_PAYLOAD:/);
  assert.doesNotMatch(workflow, /STRIPE_|DATABASE_|upload-artifact|save-cache/);
  assert.match(workflow, /Install locked read-only Chromium without credentials/);
});
