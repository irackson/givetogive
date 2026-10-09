// Real temporary SQLite/crypto/files, injected browser/job/provider/transport.
// These tests do not claim native readiness or actual financial acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { prepareCurrentCheckoutInput, handoffPreparedCurrentCheckoutInput } from '../src/checkout-current-prepare.ts';
import { UiCheckoutPreparation } from '../src/ui-checkout-preparation.ts';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
import { assetName } from '../src/hosted-checkout-policy.ts';
import { currentInput, now } from './fixtures/current-checkout.ts';
import { validateCurrentCheckoutProof } from '../src/checkout-current-input.ts';
import type { SandboxPlan } from '../src/sandbox-plan.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
async function fixture(mode = 'ok') {
 const root = mkdtempSync(join(tmpdir(), 'g2g-current-prepare-')), input = currentInput(), calls: string[] = [];
 const plan: SandboxPlan = { runId: c.runId, runBudgetCents: 2500, actorBudgetCents: 1500,
  steps: ['001', '002', '003'].map((suffix, index) => ({ agentId: `bot_bcfa98ea084ed93e_${suffix}`,
   operationId: index === 2 ? c.operationId : index === 0 ? 'c89fc875-d2d2-41a9-81bd-a1cb246ad53c' : '92aa9a3f-d47f-4af1-a333-9456ea34b727',
   scenario: index === 2 ? 'decline' : 'success', maximumAmountCents: index === 1 ? 1500 : 500,
   expectedTier: index === 2 ? 'neighbor' : index === 1 ? 'sustainer' : 'supporter',
   checkout: { kind: 'supporter', tier: index === 1 ? 'sustainer' : 'supporter', recurring: true } })) };
 const preparation = new UiCheckoutPreparation(join(root, 'original.sqlite'), plan);
 for (const step of plan.steps.slice(0, 2)) await preparation.prepare({ userId: step.agentId, query: async () => undefined,
  mutate: async () => ({ fixture: true }) }, step.agentId, step);
 const ready = { protocol: 1, purpose: 'current-checkout-browser-readiness', profile: input.profile,
  profileDigest: input.profileDigest, connectionNonce: 'd'.repeat(32), observedAt: new Date(now).toISOString(),
  freeBytes: 4 * 1024 ** 3, browserConnected: true, parentEvidence: 'native-linux-parent',
  rootSourceAndJobReviewStillRequired: true, financialAdmission: false, paymentAccepted: false, retryAllowed: false };
 const options = { root, key: Buffer.alloc(32, 7), releaseId: 42, account: input.member, stagingBypass: input.stagingBypass,
  plan, preparation, signal: new AbortController().signal, now: () => now,
  retainOriginalRunIntent: async () => { calls.push('run-intent'); },
  session: { userId: c.memberId as string, query: async () => undefined, mutate: async (procedure: string) => {
   calls.push('prepare'); assert.equal(procedure, 'billing.createCheckout');
   if (mode === 'uncertain-prepare') throw Error('public ambiguous fixture'); return { ignoredResponse: true };
  } }, observeCurrent: async (boundary: 'unused' | 'prepared') => {
   calls.push(boundary); if (mode === 'wrong-current' || mode === 'post-prepare-failure' && boundary === 'prepared') throw Error('public context fixture');
   return input.profile;
  }, observeOpening: async () => { calls.push('provider'); if (mode === 'provider-failure') throw Error('public provider fixture'); return validateCurrentCheckoutProof(input.proof, input.profile, now); },
  draft: { async upload(phase: Parameters<typeof assetName>[1], bytes: Buffer): Promise<RetainedCheckoutAsset> {
   calls.push('upload'); if (mode === 'uncertain-upload') throw Error('public transport fixture');
   const p = input.profile, binding = { releaseId: 42, operationId: c.operationId, job: { id: p.job.jobId, nonce: p.job.jobNonce, headSha: p.job.headSha } };
   const receipt: RetainedCheckoutAsset = { phase, assetId: 99, name: assetName(binding, phase), size: bytes.length,
    ciphertextDigest: createHash('sha256').update(bytes).digest('hex'), releaseId: 42, operationId: c.operationId,
    jobId: p.job.jobId, jobNonce: p.job.jobNonce, headSha: p.job.headSha, observedAt: new Date(now).toISOString(),
    anonymousDraft404: true, anonymousAsset404: true, exactRetainedAssetVerified: true, readbackVerified: true,
    retryAllowed: false, paymentAccepted: false };
   return mode === 'bad-readback' ? { ...receipt, readbackVerified: false } as unknown as RetainedCheckoutAsset : receipt;
  } } };
 return { root, ready, options, calls, cleanup() { preparation.close();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true }); } };
}
test('original 2000-cent holds plus current 500-cent preparation hand off encrypted normal-member input once', async () => {
 const f = await fixture(); try {
  const result = await prepareCurrentCheckoutInput(f.ready, f.options);
  assert.equal(result.paymentAccepted, false); assert.equal(result.privateInputRetained, true);
  assert.deepEqual(f.calls, ['unused', 'run-intent', 'prepare', 'prepared', 'provider', 'prepared', 'upload']);
  assert.equal(f.options.preparation.state(c.operationId), 'prepared');
  const directory = join(f.root, readdirSync(f.root).find(name => name.startsWith('current-root-input-'))!);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.json')))
   assert.doesNotMatch(readFileSync(join(directory, name), 'utf8'), /public-fixture-password|public-fixture-bypass|cs_test_|checkout\.stripe/);
  await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options));
  assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
  assert.ok(f.options.key.equals(Buffer.alloc(32, 7)));
 } finally { f.cleanup(); }
});
test('uncertain mutation and post-admission failures preserve admission and never prepare twice', async () => {
 for (const mode of ['uncertain-prepare', 'post-prepare-failure', 'provider-failure', 'uncertain-upload', 'bad-readback']) {
  const f = await fixture(mode); try {
   await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options));
   assert.equal(f.options.preparation.state(c.operationId), mode === 'uncertain-prepare' ? 'unresolved' : 'prepared');
   await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options));
   assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
  } finally { f.cleanup(); }
 }
});
test('invalid readiness, wrong member and changed plan fail before normal mutation', async () => {
 for (const mode of ['stale', 'browser', 'member', 'amount', 'wrong-current', 'extra-checkout-key']) {
  const f = await fixture(mode); try {
   if (mode === 'stale') f.ready.observedAt = new Date(now - 30001).toISOString();
   if (mode === 'browser') f.ready.browserConnected = false;
   if (mode === 'member') f.options.session.userId = 'foreign-member';
   if (mode === 'amount') f.options.plan.steps[2]!.maximumAmountCents = 1500;
   if (mode === 'extra-checkout-key') f.options.plan.steps[2]!.checkout.askId = 7;
   await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options));
   assert.equal(f.options.preparation.state(c.operationId), undefined); assert.equal(f.calls.includes('prepare'), false);
  } finally { f.cleanup(); }
 }
});
test('aborted handoff cannot prepare or upload', async () => {
 const f = await fixture(); try {
  const controller = new AbortController(); controller.abort(); f.options.signal = controller.signal;
  await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options)); assert.deepEqual(f.calls, []);
 } finally { f.cleanup(); }
});
test('original run intent retention occurs after unused observation and failure prevents mutation', async () => {
 const f = await fixture(); try {
  f.options.retainOriginalRunIntent = async () => { assert.deepEqual(f.calls, ['unused']); throw Error('offline original intent exists'); };
  await assert.rejects(() => prepareCurrentCheckoutInput(f.ready, f.options));
  assert.deepEqual(f.calls, ['unused']); assert.equal(f.options.preparation.state(c.operationId), undefined);
 } finally { f.cleanup(); }
});

test('explicit existing preparation handoff preserves all holds and performs zero new mutations or intent rewrites', async () => {
 const f = await fixture(); try {
  await f.options.preparation.prepare(f.options.session, c.memberId, f.options.plan.steps[2]!);
  f.calls.length = 0;
  f.options.retainOriginalRunIntent = async () => { throw Error('Must never rewrite the original intent'); };
  const result = await handoffPreparedCurrentCheckoutInput(f.ready, f.options);
  assert.equal(result.privateInputRetained, true); assert.equal(result.paymentAccepted, false);
  assert.deepEqual(f.calls, ['prepared','prepared','provider','prepared','upload']);
  const directory = join(f.root, readdirSync(f.root).find(name => name.startsWith('current-root-input-'))!);
  assert.equal(JSON.parse(readFileSync(join(directory,'preparation-lease.json'),'utf8')).maximumPreparations,0);
  assert.ok(readdirSync(directory).includes('existing-preparation-observation.result.json'));
  assert.ok(!readdirSync(directory).includes('normal-preparation.intent.json'));
  await assert.rejects(() => handoffPreparedCurrentCheckoutInput(f.ready,f.options));
  assert.equal(f.calls.includes('prepare'),false);
 } finally { f.cleanup(); }
});

test('existing handoff refuses unused, unresolved and rejected preparation states before any provider or transport action', async () => {
 for (const state of [undefined,'unresolved','rejected']) { const f=await fixture(); try {
  await assert.rejects(() => handoffPreparedCurrentCheckoutInput(f.ready,{...f.options,preparation:{state:()=>state,prepare:async()=>{throw Error('Forbidden mutation');}}}));
  assert.deepEqual(f.calls,[]);
 } finally { f.cleanup(); } }
});
