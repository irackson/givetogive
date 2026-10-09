import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAssociationRecoveryRemote, associationRecoveryBinding as b } from '../../scripts/checkout-association-recovery.mjs';
function fixture() {
 const association = { protocol: 1, purpose: 'current-cohort-private-checkout-draft', repository: 'irackson/givetogive',
  runId: '01d34cf1-7880-4978-aec3-e3c3ccc94b67', operationId: '398c5cf9-62de-4908-afb0-ce6321e8b3ad',
  headSha: b.priorHead, workflowRunId: b.priorRunId, jobId: '1234', jobNonce: 'a'.repeat(32), profileDigest: 'b'.repeat(64) };
 return { association, run: { id: Number(b.priorRunId), head_sha: b.priorHead, event: 'workflow_dispatch', head_branch: 'main',
  run_attempt: 1, status: 'completed', conclusion: 'failure', path: '.github/workflows/checkout-current-staging.yml',
  actor: { login: 'irackson' }, triggering_actor: { login: 'irackson' } },
  release: { id: 42, draft: true, prerelease: false, published_at: null, target_commitish: b.priorHead,
   tag_name: 'untagged-' + 'a'.repeat(20), body: JSON.stringify(association), assets: [] } };
}
test('only exact failed preparation-free association with the observed untagged drift is eligible; no authority to repair it', () => {
 const f = fixture(); const value = validateAssociationRecoveryRemote(42, f.association, f.run, f.release);
 assert.equal(value.noFinancialActionAuthorized, true); assert.equal(value.originalUntaggedDraftNotRepaired, true);
 for (const release of [{ ...f.release, assets: [{ name: 'input' }] }, { ...f.release, body: '{}' },
  { ...f.release, target_commitish: 'a'.repeat(40) }, { ...f.release, draft: false },
  { ...f.release, tag_name: 'arbitrary-tag' }, { ...f.release, id: 43 }])
  assert.throws(() => validateAssociationRecoveryRemote(42, f.association, f.run, release));
 for (const run of [{ ...f.run, conclusion: 'success' }, { ...f.run, run_attempt: 2 }, { ...f.run, status: 'in_progress' }])
  assert.throws(() => validateAssociationRecoveryRemote(42, f.association, run, f.release));
 for (const association of [{ ...f.association, operationId: 'foreign-operation' }, { ...f.association, jobNonce: 'invalid' },
  { ...f.association, extra: true }]) assert.throws(() => validateAssociationRecoveryRemote(42, association, f.run,
   { ...f.release, body: JSON.stringify(association) }));
});
