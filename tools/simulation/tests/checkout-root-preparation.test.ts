// Real SQLite admission/filesystem/crypto, injected member/provider/remote IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { prepareHostedCheckoutInput } from '../src/checkout-root-preparation.ts';
import { UiCheckoutPreparation } from '../src/ui-checkout-preparation.ts';
import { approved, digest, assetName, type Manifest, type Proof } from '../src/hosted-checkout-policy.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
import type { SandboxPlan } from '../src/sandbox-plan.ts';
const NOW = Date.parse('2026-10-08T21:30:00Z'), HEAD = 'a'.repeat(40);
function fixture(mode = 'ok') {
 const manifest: Manifest = { protocol: 1, purpose: 'one-member-test-checkout-policy',
  job: { repository: approved.repository, actor: approved.actor, triggeringActor: approved.actor, event: 'workflow_dispatch', ref: 'refs/heads/main', attempt: 1,
   id: '123', headSha: HEAD, nonce: 'b'.repeat(32), publicRepository: true, runner: 'ubuntu-24.04', platform: 'linux', nodeMajor: 24 },
  releaseId: 456, createdAt: new Date(NOW).toISOString(), runId: approved.runId, actorId: approved.actorId, operationId: approved.operationId,
  origin: approved.origin, databaseIdentity: approved.databaseIdentity, sourceDigest: approved.sourceDigest, canonicalSourceDigest: approved.canonicalSourceDigest,
  rootLockDigest: approved.rootLockDigest, runnerDigest: approved.runnerDigest, currency: 'usd', maximumAmountCents: 1500, expectedTier: 'sustainer', scenario: 'success',
  budget: { runBudgetCents: 2500, actorBudgetCents: 1500, priorExpiredReservedCents: 1000, candidateReservedCents: 1500,
   originalAdmissionDigest: '1'.repeat(64), expiredHistoryDigests: ['2'.repeat(64), '3'.repeat(64)], noReset: true },
  rootProof: { observedAt: new Date(NOW).toISOString(), localIsolationVerified: true, normalMemberOnly: true, noMemberTokens: true,
   noCheckoutSubmitAdmission: true, canonicalCustomerClockVerified: true, releaseVerified: true, supportsTestSubscriptionsOnly: true } };
 const opening: Proof = { protocol: 1, kind: 'local-operator-provider-read', phase: 'open', proofNonce: 'c'.repeat(32), manifestDigest: digest(manifest), jobId: '123',
  jobNonce: manifest.job.nonce, headSha: HEAD, runId: approved.runId, actorId: approved.actorId, operationId: approved.operationId,
  verifiedAt: new Date(NOW).toISOString(), platformAccountId: approved.platformAccountId, databaseIdentity: approved.databaseIdentity,
  customerAccountId: 'acct_fixtureCustomer', sessionId: 'cs_test_fixtureSession', url: 'https://checkout.stripe.com/c/pay/cs_test_fixtureSession',
  livemode: false, currency: 'usd', amountTotal: 1500, mode: 'subscription', status: 'open', paymentStatus: 'unpaid', expiresAt: NOW / 1000 + 3600,
  successUrl: `${approved.origin}/giving/${approved.operationId}?checkout=returned`, cancelUrl: `${approved.origin}/giving/${approved.operationId}?checkout=canceled`,
  providerIdentityVerified: true, canonicalCustomerClockVerified: true, providerInvoiceAbsent: true, providerSubscriptionAbsent: true };
 const root = mkdtempSync(join(tmpdir(), 'g2g-root-prepare-'));
 const plan: SandboxPlan = { runId: approved.runId, runBudgetCents: 2500, actorBudgetCents: 1500, steps: [{ operationId: approved.operationId,
  agentId: approved.memberId, scenario: 'success', maximumAmountCents: 1500, expectedTier: 'sustainer', checkout: { kind: 'supporter', tier: 'sustainer', recurring: true } }] };
 const preparation = new UiCheckoutPreparation(join(root, 'original-budget.sqlite'), plan), calls: string[] = [];
 let now = NOW, closed = 0;
 const options = { root, key: Buffer.alloc(32, 4), plan, preparation, signal: new AbortController().signal, now: () => now,
  readiness: { protocol: 1 as const, purpose: 'checkout-parent-readiness' as const, repository: approved.repository, headSha: HEAD,
   runId: '789', jobId: '123', jobNonce: manifest.job.nonce, observedAt: new Date(NOW).toISOString(), canonicalSourceDigest: approved.canonicalSourceDigest,
   rootLockDigest: approved.rootLockDigest, runnerDigest: approved.runnerDigest, freeBytes: 8 * 1024 ** 3, bootstrapSourceApprovalStillRequired: true as const,
   noCheckoutAdmission: true as const, paymentAccepted: false as const, retryAllowed: false as const },
  account: { id: approved.memberId, userId: approved.actorId, email: approved.memberEmail, password: 'PRIVATE-FIXTURE-PASSWORD' }, stagingBypass: 'PRIVATE-FIXTURE-BYPASS',
  session: { userId: approved.actorId, query: async () => undefined, mutate: async (procedure: string) => {
   calls.push('prepare'); assert.equal(procedure, 'billing.createCheckout');
   if (mode === 'uncertain-prepare') throw Error('PRIVATE-ERROR'); return { url: 'PRIVATE-UNTRUSTED-RESPONSE' }; } },
  verifyCurrent: async () => { calls.push('verify'); if (mode === 'wrong-current') throw Error('PRIVATE-ERROR'); },
  createOwnedReader: async () => { calls.push('owned-reader'); return { close: () => { closed++; }, read: async () => {
   calls.push('provider'); if (mode === 'provider-failure') throw Error('PRIVATE-ERROR'); return opening; } }; },
  draft: { upload: async (__phase: string, bytes: Buffer): Promise<RetainedCheckoutAsset> => {
   calls.push('upload'); if (mode === 'uncertain-upload') throw Error('PRIVATE-ERROR');
   if (mode === 'stale-upload') now += 30001;
   return { phase: 'input', assetId: 999, name: assetName(manifest, 'input'), size: bytes.length,
    ciphertextDigest: createHash('sha256').update(bytes).digest('hex'), releaseId: 456, jobId: '123', jobNonce: manifest.job.nonce,
    headSha: HEAD, operationId: approved.operationId, anonymousDraft404: true, anonymousAsset404: true,
    observedAt: new Date(now).toISOString(), exactRetainedAssetVerified: true, readbackVerified: true, retryAllowed: false, paymentAccepted: false }; } } };
 return { manifest, options, calls, root, closed: () => closed };
}
test('original normal preparation budget is consumed once before provider proof and private input handoff', async () => {
 const f = fixture(); try {
  const result = await prepareHostedCheckoutInput(f.manifest, HEAD, f.options);
  assert.deepEqual(f.calls, ['verify', 'prepare', 'verify', 'owned-reader', 'provider', 'verify', 'upload']);
  assert.equal(result.privateInputRetained, true); assert.equal(result.paymentAccepted, false); assert.equal(f.closed(), 0);
  const directory = join(f.root, readdirSync(f.root).find(name => name.startsWith('checkout-root-input-'))!);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.json')))
   assert.doesNotMatch(readFileSync(join(directory, file), 'utf8'), /PRIVATE-|cs_test_/);
  result.reader.close(); assert.equal(f.closed(), 1);
  await assert.rejects(prepareHostedCheckoutInput(f.manifest, HEAD, f.options));
  assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
 } finally { f.options.preparation.close(); }
});
test('uncertain preparation, provider failure and uncertain or stale transfer never repeat a financial mutation', async () => {
 for (const mode of ['uncertain-prepare', 'provider-failure', 'uncertain-upload', 'stale-upload']) {
  const f = fixture(mode); try {
   await assert.rejects(prepareHostedCheckoutInput(f.manifest, HEAD, f.options), /preparation unresolved/);
   assert.equal(f.options.preparation.state(approved.operationId), mode === 'uncertain-prepare' ? 'unresolved' : 'prepared');
   await assert.rejects(prepareHostedCheckoutInput(f.manifest, HEAD, f.options));
   assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
   if (mode !== 'uncertain-prepare') assert.equal(f.closed(), 1);
  } finally { f.options.preparation.close(); }
 }
});
test('wrong current binding, stale readiness or malformed local secret fails before any member mutation', async () => {
 for (const mode of ['wrong-current', 'stale-readiness', 'missing-password', 'changed-recurring']) {
  const f = fixture(mode); try {
   if (mode === 'stale-readiness') f.options.readiness.observedAt = new Date(NOW - 30001).toISOString();
   if (mode === 'missing-password') f.options.account.password = '';
   if (mode === 'changed-recurring') f.options.plan.steps[0]!.checkout.recurring = false;
   await assert.rejects(prepareHostedCheckoutInput(f.manifest, HEAD, f.options));
   assert.equal(f.calls.includes('prepare'), false); assert.equal(f.options.preparation.state(approved.operationId), undefined);
  } finally { f.options.preparation.close(); }
 }
});
