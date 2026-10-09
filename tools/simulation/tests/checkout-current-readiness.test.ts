// Injected GitHub responses only, not native readiness or payment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCurrentCheckoutReadiness } from '../src/checkout-current-readiness.ts';
import { currentInput, head, source, now } from './fixtures/current-checkout.ts';
const name = 'GiveToGive current Checkout browser readiness';
function fixture() {
 const input = currentInput(), p = input.profile, paths: string[] = [];
 const ready = { protocol: 1, purpose: 'current-checkout-browser-readiness', profile: p,
  profileDigest: input.profileDigest, connectionNonce: 'd'.repeat(32), observedAt: new Date(now).toISOString(),
  freeBytes: 4 * 1024 ** 3, browserConnected: true, parentEvidence: 'native-linux-parent',
  rootSourceAndJobReviewStillRequired: true, financialAdmission: false, paymentAccepted: false, retryAllowed: false };
 const external = `current-checkout-ready-1234-5678-${p.job.jobNonce}`;
 const run = { id: 1234, head_sha: head, event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1,
  status: 'in_progress', conclusion: null, path: '.github/workflows/checkout-current-staging.yml',
  actor: { login: 'irackson' }, triggering_actor: { login: 'irackson' }, repository: { full_name: 'irackson/givetogive', private: false } };
 const jobs = { total_count: 1, jobs: [{ id: 5678, run_id: 1234, head_sha: head, run_attempt: 1,
  name: 'checkout-current-parent', status: 'in_progress', conclusion: null, labels: ['ubuntu-24.04'] }] };
 const check = { id: 99, name, head_sha: head, external_id: external, status: 'in_progress', conclusion: null,
  app: { slug: 'github-actions' }, output: { title: name, summary: JSON.stringify(ready) } };
 const list = { total_count: 1, check_runs: [{ id: 99, name, external_id: external }] };
 const request: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname; paths.push(path);
  assert.equal(init?.redirect, 'error'); assert.equal(init?.method ?? 'GET', 'GET');
  const result = path.endsWith('/jobs') ? jobs : path.includes('/commits/') ? list : path.includes('/check-runs/') ? check : run;
  return new Response(JSON.stringify(result));
 };
 return { ready, run, jobs, check, list, paths, options: { token: 'public-fixture-token-only',
  signal: new AbortController().signal, request, now: () => now }, target: { headSha: head, workflowRunId: '1234' } };
}
test('discovers exact current check and brackets it with live job observations', async () => {
 const f = fixture(); const result = await observeCurrentCheckoutReadiness(f.target, source, f.options);
 assert.equal(result.checkRunId, '99'); assert.equal(result.paymentAccepted, false);
 assert.equal(result.transportEvidence, 'injected-offline-http'); assert.equal(f.paths.length, 7);
 assert.equal(result.readiness.observedAt, f.ready.observedAt);
});
test('original recheck preserves memory timestamp rather than admitting a stale marker afresh', async () => {
 const f = fixture(), first = await observeCurrentCheckoutReadiness(f.target, source, f.options);
 f.options.now = () => now + 60000;
 await assert.rejects(() => observeCurrentCheckoutReadiness(f.target, source, f.options));
 const result = await observeCurrentCheckoutReadiness(f.target, source, { ...f.options, original: first });
 assert.equal(result.readiness.observedAt, first.readiness.observedAt);
 assert.equal(result.readiness.freeBytes, first.readiness.freeBytes);
 assert.equal(result.originalMemoryObservationOnly, true);
});
test('foreign or duplicate check, wrong job, historical workflow and stale marker reject', async () => {
 for (const mode of ['foreign', 'duplicate', 'wrong-job', 'historical', 'stale', 'source', 'browser']) {
  const f = fixture();
  if (mode === 'foreign') f.check.external_id += '-foreign';
  if (mode === 'duplicate') { f.list.total_count = 2; f.list.check_runs.push({ ...f.list.check_runs[0]!, id: 100 }); }
  if (mode === 'wrong-job') f.jobs.jobs[0]!.id = 999;
  if (mode === 'historical') f.run.path = '.github/workflows/checkout-staging.yml';
  if (mode === 'stale') f.options.now = () => now + 30001;
  if (mode === 'browser') { f.ready.browserConnected = false; f.check.output.summary = JSON.stringify(f.ready); }
  await assert.rejects(() => observeCurrentCheckoutReadiness(f.target, mode === 'source' ? { ...source, runnerDigest: 'e'.repeat(64) } : source, f.options));
 }
});
test('changed publication between readbacks is rejected', async () => {
 const f = fixture(), request = f.options.request; let reads = 0;
 f.options.request = async (url, init) => {
  if (String(url).includes('/check-runs/99') && ++reads === 2) f.check.output.summary = JSON.stringify({ ...f.ready, connectionNonce: 'e'.repeat(32) });
  return request(url, init);
 };
 await assert.rejects(() => observeCurrentCheckoutReadiness(f.target, source, f.options));
});
test('terminal job or truncated check inventory is not readiness', async () => {
 const f = fixture(); f.run.status = 'completed'; await assert.rejects(() => observeCurrentCheckoutReadiness(f.target, source, f.options));
 const g = fixture(); g.list.total_count = 101; await assert.rejects(() => observeCurrentCheckoutReadiness(g.target, source, g.options));
});
