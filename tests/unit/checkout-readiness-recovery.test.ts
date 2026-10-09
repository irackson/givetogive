import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readReadinessRecovery, validateReadinessRecoveryRemote, readinessRecoveryBinding as b } from '../../scripts/checkout-readiness-recovery.mjs';
const operationId = '398c5cf9-62de-4908-afb0-ce6321e8b3ad', memberId = 'synthetic-bcfa98ea084ed93e-003';
function fixture() {
 const common = { event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1, status: 'completed',
  path: '.github/workflows/checkout-current-staging.yml', actor: { login: 'irackson' }, triggering_actor: { login: 'irackson' } };
 return { prior: { ...common, id: Number(b.priorRunId), head_sha: b.priorHead, conclusion: 'failure' },
  diagnostic: { ...common, id: Number(b.diagnosticRunId), head_sha: b.diagnosticHead, conclusion: 'success' },
  release: { id: 42, draft: true, prerelease: false, published_at: null, target_commitish: b.priorHead,
   tag_name: 'checkout-current-' + operationId, assets: [], body: JSON.stringify({ protocol: 1,
    purpose: 'current-cohort-private-checkout-pending', repository: 'irackson/givetogive',
    runId: '01d34cf1-7880-4978-aec3-e3c3ccc94b67', operationId, headSha: b.priorHead }) } };
}
test('readiness recovery requires the exact failed original dispatch, successful diagnostic and untouched empty private draft', () => {
 const f = fixture(); const value = validateReadinessRecoveryRemote(42, operationId, f.prior, f.diagnostic, f.release);
 assert.equal(value.noFinancialActionAuthorized, true);
 for (const prior of [{ ...f.prior, run_attempt: 2 }, { ...f.prior, conclusion: 'success' }, { ...f.prior, head_sha: b.diagnosticHead }])
  assert.throws(() => validateReadinessRecoveryRemote(42, operationId, prior, f.diagnostic, f.release));
 for (const diagnostic of [{ ...f.diagnostic, conclusion: 'failure' }, { ...f.diagnostic, status: 'in_progress' },
  { ...f.diagnostic, id: Number(b.priorRunId) }])
  assert.throws(() => validateReadinessRecoveryRemote(42, operationId, f.prior, diagnostic, f.release));
 for (const release of [{ ...f.release, draft: false }, { ...f.release, assets: [{ name: 'input' }] },
  { ...f.release, body: '{}' }, { ...f.release, target_commitish: b.diagnosticHead }, { ...f.release, id: 43 }])
  assert.throws(() => validateReadinessRecoveryRemote(42, operationId, f.prior, f.diagnostic, release));
});
test('filesystem recovery refuses fabricated receipts and any extra association/input/preparation/submission evidence', () => {
 const directory = mkdtempSync(join(tmpdir(), 'g2g-readiness-recovery-')), dispatch = 'current-dispatch-' + operationId;
 try {
  mkdirSync(join(directory, dispatch));
  for (const name of ['operator-lease.json','release.original.json','prerequisites.original.json',
   'predispatch-recovery.original.json','member-sign-in.intent.json']) writeFileSync(join(directory, name), '{}');
  for (const name of ['dispatch-lease.json','draft-create.intent.json','draft-create.result.json',
   'workflow-dispatch.intent.json','workflow-dispatch.result.json']) writeFileSync(join(directory, dispatch, name), '{}');
  assert.throws(() => readReadinessRecovery(directory, operationId, memberId));
  for (const name of ['association-write.intent.json','input-upload.intent.json','ui-acceptance.intent.json','submission.intent.json']) {
   writeFileSync(join(directory, dispatch, name), '{}');
   assert.throws(() => readReadinessRecovery(directory, operationId, memberId));
  }
  assert.throws(() => readReadinessRecovery(directory, operationId, 'foreign-member'));
 } finally { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true }); }
});
