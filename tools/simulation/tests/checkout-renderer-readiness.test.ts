import test from 'node:test';
import assert from 'node:assert/strict';
import { approved } from '../src/hosted-checkout-policy.ts';
import { waitForHostedCheckoutSurface, SurfaceReadUnavailable, type CheckoutSurface } from '../src/hosted-checkout-worker.ts';

const now = Date.parse('2026-10-09T00:00:00Z');
const ready: CheckoutSurface = { observedAt: new Date(now).toISOString(), testModeLabel: true, visibleCard: true,
  panelCount: 0, panelDigest: null, controlCount: 0, controlName: '', visible: false, enabled: false, unchecked: false,
  optionalLinkDeferred: true, unknownInstructions: false, requiresCaptchaOrWalletOrAttestation: false,
  consoleErrors: 0, pageErrors: 0, httpErrors: 0 };
const empty: CheckoutSurface = { ...ready, testModeLabel: false, visibleCard: false };
const panel: CheckoutSurface = { ...empty, panelCount: 1, panelDigest: approved.panelDigest, controlCount: 1,
  controlName: approved.controlName, visible: true, enabled: true, unchecked: true };
const options = () => ({ signal: new AbortController().signal, now: () => now, timeoutMs: 1000, pause: async () => {} });

test('clean empty rendering can settle without changing proof/surface timestamps or admitting an action', async () => {
  let reads = 0, pauses = 0;
  const result = await waitForHostedCheckoutSurface(async () => ++reads < 3 ? empty : ready,
    { ...options(), pause: async () => { pauses++; } });
  assert.equal(result, ready); assert.equal(result.observedAt, ready.observedAt);
  assert.equal(reads, 3); assert.equal(pauses, 2);
});
test('opening returns only the reviewed notice, while a known acknowledged notice can fade to native readiness', async () => {
  assert.equal(await waitForHostedCheckoutSurface(async () => panel, options()), panel);
  let reads = 0;
  const result = await waitForHostedCheckoutSurface(async () => ++reads === 1 ? { ...panel, unchecked: false } : ready,
    { ...options(), afterNotice: true });
  assert.equal(result, ready); assert.equal(reads, 2);
});
test('unknown/challenge/error/stale and changed or duplicate notices fail on the first observation', async () => {
  for (const surface of [{ ...empty, unknownInstructions: true }, { ...empty, requiresCaptchaOrWalletOrAttestation: true },
    { ...empty, consoleErrors: 1 }, { ...empty, pageErrors: 1 }, { ...empty, httpErrors: 1 },
    { ...empty, observedAt: new Date(now - 5001).toISOString() },
    { ...panel, panelDigest: '0'.repeat(64) }, { ...panel, panelCount: 2 }]) {
    for (const afterNotice of [false, true]) {
      let reads = 0;
      await assert.rejects(waitForHostedCheckoutSurface(async () => { reads++; return surface; }, { ...options(), afterNotice }));
      assert.equal(reads, 1);
    }
  }
});
test('frame discovery errors are not retried by a financial renderer wait', async () => {
  let reads = 0;
  await assert.rejects(waitForHostedCheckoutSurface(async () => { reads++; throw new SurfaceReadUnavailable('frame-discovery'); }, options()), SurfaceReadUnavailable);
  assert.equal(reads, 1);
});
test('hard renderer deadline fences a hung read instead of waiting for its completion', async () => {
  let reads = 0;
  await assert.rejects(waitForHostedCheckoutSurface(async () => { reads++; return new Promise<CheckoutSurface>(() => {}); },
    { ...options(), timeoutMs: 15 }));
  assert.equal(reads, 1);
});
test('parent abort and late observation never restart a read or expose abort details', async () => {
  const controller = new AbortController(); let reads = 0, finish: (surface: CheckoutSurface) => void = () => {};
  const pending = waitForHostedCheckoutSurface(async () => { reads++; return new Promise<CheckoutSurface>(resolve => { finish = resolve; }); },
    { ...options(), signal: controller.signal });
  controller.abort(new Error('private-fixture-do-not-retain'));
  await assert.rejects(pending, error => { assert.ok(error instanceof Error); assert.equal(error.message.includes('private-fixture'), false); return true; });
  finish(ready); await Promise.resolve(); await Promise.resolve();
  assert.equal(reads, 1);
});
