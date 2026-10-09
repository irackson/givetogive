// Injected transport/context only: no native payment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateCurrentCheckout } from '../src/checkout-current-coordinate.ts';
import { assetName, type CheckoutAssetBinding } from '../src/hosted-checkout-policy.ts';
const binding: CheckoutAssetBinding = { releaseId: 42, operationId: '398c5cf9-62de-4908-afb0-ce6321e8b3ad',
 job: { id: '123', nonce: 'd'.repeat(32), headSha: 'a'.repeat(40) } };
type Phase = Parameters<typeof assetName>[1];
function fixture(notice = false) {
 const assets = new Set<Phase>(['input', 'opening-request']);
 const calls: string[] = []; let closed = 0, contexts = 0;
 const options = { binding, signal: new AbortController().signal, timeoutMs: 1000, pollMs: 1,
  transport: { async inspect() { return { releaseId: 42, privateDraftVerified: true as const,
   assets: [...assets].map((phase, index) => ({ id: index + 1, name: assetName(binding, phase), size: 50, digest: 'sha256:fixture' })) }; } },
  responder: { async respond(phase: 'opening' | 'fixture' | 'notice' | 'submission') {
   calls.push(phase); assets.add(`${phase}-response`);
   assets.add(phase === 'opening' ? 'fixture-request' : phase === 'fixture' && notice ? 'notice-request' :
    phase === 'submission' ? 'final' : 'submission-request');
   return { phase, privateResponseRetained: true as const, originalAdmissionRequiresReconciliation: true as const,
    paymentAccepted: false as const, retryAllowed: false as const };
  }, close() { closed++; } }, verifyContext: async () => { contexts++; } };
 return { options, assets, calls, counts: () => ({ closed, contexts }) };
}
for (const notice of [false, true]) test(`ordered coordination, optional notice ${notice}`, async () => {
 const f = fixture(notice); const result = await coordinateCurrentCheckout(f.options);
 assert.deepEqual(f.calls, notice ? ['opening', 'fixture', 'notice', 'submission'] : ['opening', 'fixture', 'submission']);
 assert.equal(result.paymentAccepted, false); assert.equal(result.independentReconciliationRequired, true);
 assert.equal(f.counts().closed, 1);
});
test('early final and foreign response stop without admission', async () => {
 for (const phase of ['final', 'submission-response'] as const) {
  const f = fixture(); f.assets.add(phase); await assert.rejects(() => coordinateCurrentCheckout(f.options));
  assert.deepEqual(f.calls, []); assert.equal(f.counts().closed, 1);
 }
});
test('responder failure is not retried', async () => {
 const f = fixture(); let count = 0;
 f.options.responder.respond = async () => { count++; throw Error('offline uncertain response'); };
 await assert.rejects(() => coordinateCurrentCheckout(f.options)); assert.equal(count, 1); assert.equal(f.counts().closed, 1);
});
test('out-of-order requests do not reach the responder', async () => {
 const f = fixture(); f.assets.add('fixture-request');
 await assert.rejects(() => coordinateCurrentCheckout(f.options)); assert.deepEqual(f.calls, []);
});
test('context failure prevents requests', async () => {
 const f = fixture(); f.options.verifyContext = async () => { throw Error('offline stale source'); };
 await assert.rejects(() => coordinateCurrentCheckout(f.options)); assert.deepEqual(f.calls, []);
});
test('timeout and cancellation close waiting responder', async () => {
 const f = fixture(); f.assets.delete('opening-request'); f.options.timeoutMs = 20;
 await assert.rejects(() => coordinateCurrentCheckout(f.options)); assert.deepEqual(f.calls, []); assert.equal(f.counts().closed, 1);
 const g = fixture(); const controller = new AbortController(); controller.abort(); g.options.signal = controller.signal;
 await assert.rejects(() => coordinateCurrentCheckout(g.options)); assert.deepEqual(g.calls, []); assert.equal(g.counts().closed, 1);
});
test('timeout interrupts a hung context callback', async () => {
 const f = fixture(); f.options.timeoutMs = 20; f.options.verifyContext = () => new Promise(() => {});
 // Keep the test process alive: AbortSignal.timeout itself is unref'ed.
 const timer = setTimeout(() => {}, 1000);
 try { await assert.rejects(() => coordinateCurrentCheckout(f.options)); assert.equal(f.counts().closed, 1); }
 finally { clearTimeout(timer); }
});
