// Real original filesystem retention, injected GitHub transport only.
// No actual job/draft/member/payment action is claimed by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { dispatchCurrentCheckoutWorker, currentCheckoutRepositoryUrl } from '../src/checkout-current-dispatch.ts';
import { currentInput, head, source, now } from './fixtures/current-checkout.ts';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
function fixture(mode = 'ok') {
 const root = mkdtempSync(join(tmpdir(), 'g2g-current-dispatch-')), directory = join(root, `current-dispatch-${c.operationId}`), input = currentInput();
 const writes: string[] = []; let contexts = 0;
 const ready = { protocol: 1, purpose: 'current-checkout-browser-readiness', profile: input.profile, profileDigest: input.profileDigest,
  connectionNonce: 'd'.repeat(32), observedAt: new Date(now).toISOString(), freeBytes: 4 * 1024 ** 3, browserConnected: true,
  parentEvidence: 'native-linux-parent', rootSourceAndJobReviewStillRequired: true, financialAdmission: false, paymentAccepted: false, retryAllowed: false };
 const name = 'GiveToGive current Checkout browser readiness', external = `current-checkout-ready-1234-5678-${input.profile.job.jobNonce}`;
 let release: Record<string, unknown> = {};
 const run = { id: 1234, head_sha: head, event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1, status: 'in_progress',
  conclusion: null, path: '.github/workflows/checkout-current-staging.yml', actor: { login: 'irackson' },
  triggering_actor: { login: 'irackson' }, repository: { full_name: 'irackson/givetogive', private: false } };
 const request: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const authenticated = new Headers(init?.headers).has('Authorization');
  if (path.includes('/releases/tags/')) return new Response(null, { status: mode === 'existing-tag' ? 200 : 404 });
  if (path.endsWith('/releases/42') && !authenticated) return new Response(null, { status: mode === 'public-draft' ? 200 : 404 });
  if (method === 'POST' && path.endsWith('/releases')) {
   assert.ok(existsSync(join(directory, 'draft-create.intent.json'))); writes.push('create');
   const body = JSON.parse(String(init?.body)); release = { id: 42, published_at: null, assets: [], ...body };
   if (mode === 'uncertain-create') throw Error('offline uncertain create'); return reply(release, 201);
  }
  if (method === 'POST' && path.endsWith('/dispatches')) {
   assert.ok(existsSync(join(directory, 'workflow-dispatch.intent.json'))); writes.push('dispatch');
   if (mode === 'uncertain-dispatch') throw Error('offline uncertain dispatch');
   return reply({ workflow_run_id: 1234, run_url: 'https://api.github.com/repos/irackson/givetogive/actions/runs/1234',
    html_url: 'https://github.com/irackson/givetogive/actions/runs/1234' });
  }
  if (method === 'PATCH') {
   assert.equal(path.endsWith('/releases/42'), true); assert.ok(existsSync(join(directory, 'association-write.intent.json')));
   writes.push('associate'); release = { ...release, ...JSON.parse(String(init?.body)) };
   if (mode === 'uncertain-patch') throw Error('offline uncertain patch'); return reply(release);
  }
  assert.equal(method, 'GET');
  if (path.endsWith('/releases/42')) {
   if (mode === 'changed-readback') return reply({ ...release, target_commitish: 'e'.repeat(40) });
   return reply(release);
  }
  if (path.endsWith('/checkout-current-staging.yml/runs')) return reply({ total_count: 0, workflow_runs: [] });
  if (path.endsWith('/actions/runs/1234/jobs')) return reply({ total_count: 1, jobs: [{ id: 5678, run_id: 1234,
   head_sha: head, run_attempt: 1, name: 'checkout-current-parent', status: 'in_progress', conclusion: null, labels: ['ubuntu-24.04'] }] });
  if (path.endsWith('/actions/runs/1234')) return reply(run);
  if (path.includes('/commits/')) return reply({ total_count: 1, check_runs: [{ id: 99, name, external_id: external }] });
  if (path.endsWith('/check-runs/99')) return reply({ id: 99, name, head_sha: head, external_id: external, status: 'in_progress', conclusion: null,
   app: { slug: 'github-actions' }, output: { title: name, summary: JSON.stringify(ready) } });
  assert.equal(path, '/repos/irackson/givetogive'); return reply({ full_name: 'irackson/givetogive', private: false });
 };
 const options = { root, headSha: head, source, token: 'public-fixture-token-only', signal: new AbortController().signal, request,
  now: () => now, pollMs: 1, verifyCurrent: async () => { contexts++; if (mode === 'context') throw Error('offline stale source'); } };
 return { root, directory, writes, options, contexts: () => contexts, cleanup() {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true }); } };
}
test('repository root is canonical without a trailing slash; unsafe suffixes reject', () => {
 assert.equal(currentCheckoutRepositoryUrl(''), 'https://api.github.com/repos/irackson/givetogive');
 assert.equal(currentCheckoutRepositoryUrl('releases'), 'https://api.github.com/repos/irackson/givetogive/releases');
 for (const path of ['/releases', '../other', 'releases#fragment']) assert.throws(() => currentCheckoutRepositoryUrl(path));
});
test('one current dispatch and exact private association retain all write intents before transport', async () => {
 const f = fixture(); try {
  const result = await dispatchCurrentCheckoutWorker(f.options);
  assert.deepEqual(f.writes, ['create', 'dispatch', 'associate']); assert.equal(result.nativeEvidence, 'injected-offline-http');
  assert.equal(result.paymentAccepted, false); assert.equal(result.memberInputStillRequired, true);
  for (const name of readdirSync(f.directory)) assert.doesNotMatch(readFileSync(join(f.directory, name), 'utf8'), /public-fixture-token|password|stagingBypass/);
  await assert.rejects(() => dispatchCurrentCheckoutWorker(f.options)); assert.deepEqual(f.writes, ['create', 'dispatch', 'associate']);
 } finally { f.cleanup(); }
});
test('uncertain create, dispatch, association and changed readback never replay', async () => {
 for (const mode of ['uncertain-create', 'uncertain-dispatch', 'uncertain-patch', 'changed-readback', 'public-draft']) {
  const f = fixture(mode); try {
   await assert.rejects(() => dispatchCurrentCheckoutWorker(f.options)); const writes = [...f.writes];
   await assert.rejects(() => dispatchCurrentCheckoutWorker(f.options)); assert.deepEqual(f.writes, writes);
   assert.equal(new Set(f.writes).size, f.writes.length);
  } finally { f.cleanup(); }
 }
});
test('failed source context or preexisting draft prevents remote writes', async () => {
 for (const mode of ['context', 'existing-tag']) {
  const f = fixture(mode); try { await assert.rejects(() => dispatchCurrentCheckoutWorker(f.options)); assert.deepEqual(f.writes, []); }
  finally { f.cleanup(); }
 }
});
test('abort prevents lease creation and all remote writes', async () => {
 const f = fixture(); try {
  const controller = new AbortController(); controller.abort(); f.options.signal = controller.signal;
  await assert.rejects(() => dispatchCurrentCheckoutWorker(f.options)); assert.deepEqual(f.writes, []); assert.equal(existsSync(f.directory), false);
 } finally { f.cleanup(); }
});
