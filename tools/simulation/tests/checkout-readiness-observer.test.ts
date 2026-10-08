import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCheckoutReadiness } from '../src/checkout-readiness-observer.ts';
const HEAD = 'a'.repeat(40), NOW = Date.parse('2026-10-08T21:00:00Z');
function fixture(mode = 'ok') {
 const ready = { protocol: 1 as const, purpose: 'checkout-parent-readiness' as const, repository: 'irackson/givetogive' as const,
  headSha: HEAD, runId: '123', jobId: '456', jobNonce: 'b'.repeat(32), observedAt: new Date(NOW).toISOString(),
  canonicalSourceDigest: 'c'.repeat(64), rootLockDigest: 'd'.repeat(64), runnerDigest: 'e'.repeat(64), freeBytes: 8 * 1024 ** 3,
  bootstrapSourceApprovalStillRequired: true as const, noCheckoutAdmission: true as const, paymentAccepted: false as const, retryAllowed: false as const };
 const binding = { headSha: HEAD, runId: '123', checkRunId: '789', canonicalSourceDigest: ready.canonicalSourceDigest,
  rootLockDigest: ready.rootLockDigest, runnerDigest: ready.runnerDigest };
 const check = { id: 789, name: 'GiveToGive Checkout parent readiness', head_sha: HEAD,
  external_id: 'checkout-ready-123-456-' + ready.jobNonce, status: 'in_progress', conclusion: null,
  app: { slug: 'github-actions' }, output: { title: 'GiveToGive Checkout parent readiness', summary: JSON.stringify({ ...ready,
   transportEvidence: mode === 'offline-marker' ? 'injected-offline-http' : 'github-live-run-job-readback', nativeParentReadinessStillRequired: true }) } };
 const run = { id: 123, head_sha: HEAD, event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1,
  status: 'in_progress', conclusion: null, path: '.github/workflows/checkout-staging.yml', actor: { login: 'irackson' },
  triggering_actor: { login: 'irackson' }, repository: { full_name: 'irackson/givetogive', private: false } };
 const job = { id: 456, run_id: 123, head_sha: HEAD, run_attempt: 1, name: 'checkout-parent', status: 'in_progress',
  conclusion: null, labels: ['ubuntu-24.04'] };
 let count = 0, checks = 0, jobs = 0;
 const request: typeof fetch = async (url, options) => {
  count++; assert.equal(options?.method, 'GET'); assert.equal(options?.redirect, 'error');
  const path = new URL(String(url)).pathname;
  if (path.includes('/check-runs/')) {
   checks++;
   return Response.json(mode === 'changed-marker' && checks === 2 ? { ...check, external_id: 'changed' } :
    mode === 'foreign-app' ? { ...check, app: { slug: 'someone' } } : check);
  }
  if (path.endsWith('/jobs')) {
   jobs++;
   return Response.json({ total_count: mode === 'extra-job' ? 2 : 1, jobs: [
    mode === 'terminal-job' || (mode === 'finished-during-check' && jobs === 2) ? { ...job, status: 'completed', conclusion: 'success' } :
     mode === 'wrong-job' ? { ...job, id: 457 } : job] });
  }
  return Response.json(mode === 'wrong-actor' ? { ...run, actor: { login: 'someone' } } :
   mode === 'rerun' ? { ...run, run_attempt: 2 } : run);
 };
 return { ready, binding, options: { token: 'PUBLIC-OFFLINE-TOKEN-NOT-A-CREDENTIAL', signal: new AbortController().signal,
  request, now: () => NOW }, count: () => count };
}
test('read-only exact native marker is checked between two live job observations without financial admission', async () => {
 const f = fixture(), result = await observeCheckoutReadiness(f.binding, f.options);
 assert.equal(f.count(), 6); assert.deepEqual(result.readiness, f.ready);
 assert.equal(result.transportEvidence, 'injected-offline-http'); assert.equal(result.paymentAccepted, false);
 assert.equal(result.independentOperatorVerificationRequired, true); assert.equal(result.checkoutPrepared, false);
});
test('foreign, rerun, stale, changed and terminal boundaries fail closed', async () => {
 for (const mode of ['offline-marker', 'foreign-app', 'wrong-actor', 'rerun', 'extra-job', 'wrong-job', 'terminal-job', 'changed-marker', 'finished-during-check']) {
  const f = fixture(mode); await assert.rejects(observeCheckoutReadiness(f.binding, f.options), /readiness observation unconfirmed/);
 }
 const f = fixture(); f.options.now = () => NOW + 30001;
 await assert.rejects(observeCheckoutReadiness(f.binding, f.options));
 await assert.rejects(observeCheckoutReadiness({ ...f.binding, runnerDigest: 'f'.repeat(64) }, fixture().options));
});
test('continued live recheck preserves old metadata without refreshing memory evidence', async () => {
 const f = fixture(), first = await observeCheckoutReadiness(f.binding, f.options);
 f.options.now = () => NOW + 120000;
 const second = await observeCheckoutReadiness(f.binding, { ...f.options, original: first.readiness });
 assert.equal(second.readiness.observedAt, new Date(NOW).toISOString());
 assert.equal(second.observedAt, new Date(NOW + 120000).toISOString());
 assert.equal(second.originalMemoryObservationOnly, true);
 await assert.rejects(observeCheckoutReadiness(f.binding, { ...f.options, original: { ...f.ready, jobNonce: 'f'.repeat(32) } }));
});
test('cancellation stops a stalled body and never repeats a request', async () => {
 const f = fixture(), controller = new AbortController(); let canceled = false, requests = 0;
 const request: typeof fetch = async () => { requests++; setTimeout(() => controller.abort(), 10);
  return new Response(new ReadableStream({ cancel() { canceled = true; } })); };
 await assert.rejects(observeCheckoutReadiness(f.binding, { ...f.options, signal: controller.signal, request }));
 assert.equal(requests, 1); assert.equal(canceled, true);
});
