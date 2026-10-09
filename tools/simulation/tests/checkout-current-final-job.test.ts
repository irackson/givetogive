// Injected GitHub only; terminal job success is not payment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCurrentCheckoutFinalJob } from '../src/checkout-current-final-job.ts';
const head = 'a'.repeat(40), target = { headSha: head, workflowRunId: '1234', jobId: '5678' };
function fixture() {
 const run = { id: 1234, head_sha: head, event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1,
  status: 'completed', conclusion: 'success' as string | null, path: '.github/workflows/checkout-current-staging.yml',
  actor: { login: 'irackson' }, triggering_actor: { login: 'irackson' }, repository: { full_name: 'irackson/givetogive', private: false } };
 const jobs = { total_count: 1, jobs: [{ id: 5678, run_id: 1234, head_sha: head, run_attempt: 1, name: 'checkout-current-parent',
  status: 'completed', conclusion: 'success' as string | null, labels: ['ubuntu-24.04'] }] };
 let calls = 0;
 const request: typeof fetch = async (url, init) => {
  calls++; assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
  return new Response(JSON.stringify(new URL(String(url)).pathname.endsWith('/jobs') ? jobs : run));
 };
 return { run, jobs, calls: () => calls, options: { token: 'public-fixture-token-only', request, signal: new AbortController().signal } };
}
test('exact successful terminal run/job is observed but never admits payment', async () => {
 const f = fixture(); const result = await observeCurrentCheckoutFinalJob(target, f.options);
 assert.equal(result.successful, true); assert.equal(result.runFinished, true); assert.equal(result.financialAdmission, false);
 assert.equal(result.paymentAccepted, false); assert.equal(result.independentClosureAndSettlementRequired, true); assert.equal(f.calls(), 2);
});
test('live job and a failed terminal job remain distinct from successful completion', async () => {
 const f = fixture(); f.run.status = f.jobs.jobs[0]!.status = 'in_progress'; f.run.conclusion = f.jobs.jobs[0]!.conclusion = null;
 const live = await observeCurrentCheckoutFinalJob(target, f.options); assert.equal(live.runFinished, false); assert.equal(live.successful, false);
 const g = fixture(); g.run.conclusion = g.jobs.jobs[0]!.conclusion = 'failure';
 const failed = await observeCurrentCheckoutFinalJob(target, g.options); assert.equal(failed.runFinished, true); assert.equal(failed.successful, false);
});
test('foreign job/head, historical workflow, attempt rollover and inconsistent completion reject', async () => {
 for (const mode of ['job', 'head', 'workflow', 'attempt', 'inconsistent', 'null-conclusion']) {
  const f = fixture();
  if (mode === 'job') f.jobs.jobs[0]!.id = 999;
  if (mode === 'head') f.run.head_sha = 'e'.repeat(40);
  if (mode === 'workflow') f.run.path = '.github/workflows/checkout-staging.yml';
  if (mode === 'attempt') f.run.run_attempt = 2;
  if (mode === 'inconsistent') { f.jobs.jobs[0]!.status = 'in_progress'; f.jobs.jobs[0]!.conclusion = null; }
  if (mode === 'null-conclusion') f.run.conclusion = null;
  await assert.rejects(() => observeCurrentCheckoutFinalJob(target, f.options));
 }
});
