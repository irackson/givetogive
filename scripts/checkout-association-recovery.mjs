// Exact preparation-free transport failure only. Never repair/rebind the old
// draft, reuse its worker, clear a journal/hold, or replay a financial attempt.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readinessRecoveryBinding } from './checkout-readiness-recovery.mjs';
export const associationRecoveryBinding = Object.freeze({
 ...readinessRecoveryBinding, priorHead: '85058456806392f1c6fe5df729ac614e301c9283', priorRunId: '37961347241',
 originalReceiptDigest: '95c1a433020e9e74f76bfc1c1f0d390e9e5571ee958fcb01c3dbf64d99c3a525',
});
const fail = () => { throw Error('Association recovery refused; originals and financial holds retained.'); };
/** @param {unknown} value */
function guard(value) { if (!value) fail(); }
/** @param {string} root @param {string} operationId @param {string} memberId */
export function readAssociationRecovery(root, operationId, memberId) {
 guard(operationId === '398c5cf9-62de-4908-afb0-ce6321e8b3ad' && memberId === 'synthetic-bcfa98ea084ed93e-003');
 const directory = resolve(root), dispatchName = 'current-dispatch-' + operationId, dispatch = join(directory, dispatchName);
 for (const path of [directory, dispatch]) guard(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
 const names = ['operator-lease.json','release.original.json','prerequisites.original.json',
  'readiness-recovery.original.json','member-sign-in.intent.json',dispatchName].sort();
 const children = ['dispatch-lease.json','draft-create.intent.json','draft-create.result.json','workflow-dispatch.intent.json',
  'workflow-dispatch.result.json','readiness.original.json','association-write.intent.json'].sort();
 guard(readdirSync(directory).sort().join(',') === names.join(',') && readdirSync(dispatch).sort().join(',') === children.join(','));
 const hash = createHash('sha256'), records = new Map();
 /** @param {string} relative */
 const read = relative => { const path = join(directory, relative); guard(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  const bytes = readFileSync(path); try { guard(bytes.length < 65536); hash.update(relative).update('\0').update(bytes).update('\0');
   records.set(relative, JSON.parse(bytes.toString())); } finally { bytes.fill(0); } };
 for (const name of names) if (name === dispatchName) for (const child of children) read(name + '/' + child); else read(name);
 guard(hash.digest('hex') === associationRecoveryBinding.originalReceiptDigest);
 const original = z.object({ workflowRunId: z.literal(associationRecoveryBinding.priorRunId), releaseId: z.number().int().safe().positive(),
  headSha: z.literal(associationRecoveryBinding.priorHead), retryAllowed: z.literal(false) }).strict()
  .parse(records.get(dispatchName + '/workflow-dispatch.result.json'));
 const p = records.get(dispatchName + '/readiness.original.json').readiness.profile;
 const association = { protocol: 1, purpose: 'current-cohort-private-checkout-draft', repository: p.job.repository,
  runId: p.runId, operationId: p.operationId, headSha: p.job.headSha, workflowRunId: p.job.workflowRunId,
  jobId: p.job.jobId, jobNonce: p.job.jobNonce, profileDigest: createHash('sha256').update(JSON.stringify(p)).digest('hex') };
 return Object.freeze({ ...associationRecoveryBinding, priorReleaseId: original.releaseId, association,
  originalsPreserved: true, priorPrivateInputAbsent: true, priorPreparationAbsent: true, priorSubmissionAbsent: true,
  financialRetry: false, providerAndOriginalBudgetRecheckRequired: true });
}
/** Shape validation only, never native evidence. @param {number} releaseId
 * @param {object} association @param {unknown} run @param {unknown} release */
export function validateAssociationRecoveryRemote(releaseId, association, run, release) {
 const b = associationRecoveryBinding;
 guard(Number.isSafeInteger(releaseId) && releaseId > 0);
 z.object({ protocol: z.literal(1), purpose: z.literal('current-cohort-private-checkout-draft'), repository: z.literal('irackson/givetogive'),
  runId: z.literal('01d34cf1-7880-4978-aec3-e3c3ccc94b67'), operationId: z.literal('398c5cf9-62de-4908-afb0-ce6321e8b3ad'),
  headSha: z.literal(b.priorHead), workflowRunId: z.literal(b.priorRunId), jobId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  jobNonce: z.string().regex(/^[a-f0-9]{32}$/), profileDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(association);
 z.object({ id: z.literal(Number(b.priorRunId)), head_sha: z.literal(b.priorHead), event: z.literal('workflow_dispatch'),
  head_branch: z.literal('main'), run_attempt: z.literal(1), status: z.literal('completed'), conclusion: z.literal('failure'),
  path: z.literal('.github/workflows/checkout-current-staging.yml'), actor: z.object({ login: z.literal('irackson') }),
  triggering_actor: z.object({ login: z.literal('irackson') }) }).parse(run);
 z.object({ id: z.literal(releaseId), draft: z.literal(true), prerelease: z.literal(false), published_at: z.null(),
  target_commitish: z.literal(b.priorHead), tag_name: z.string().regex(/^untagged-[a-f0-9]{20}$/),
  body: z.literal(JSON.stringify(association)), assets: z.array(z.unknown()).length(0) }).parse(release);
 return Object.freeze({ failedDispatchPreserved: true, exactOldAssociationRetained: true, priorPrivateInputAbsent: true,
  priorPreparationAbsent: true, priorSubmissionAbsent: true, originalUntaggedDraftNotRepaired: true, noFinancialActionAuthorized: true });
}
/** Native caller owns the token; injected requests are explicitly offline.
 * @param {ReturnType<typeof readAssociationRecovery>} original @param {string} token
 * @param {{request?: typeof fetch, signal?: AbortSignal}} [options] */
export async function observeAssociationRecoveryRemote(original, token, options = {}) {
 guard(typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token));
 const request = options.request ?? fetch, signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(60000)]);
 const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
 const base = 'https://api.github.com/repos/irackson/givetogive/';
 /** @param {string} path */
 const get = async path => { const response = await request(base + path, { method: 'GET', headers, redirect: 'error', signal });
  guard(response.ok); return response.json(); };
 const proof = validateAssociationRecoveryRemote(original.priorReleaseId, original.association,
  await get('actions/runs/' + associationRecoveryBinding.priorRunId), await get('releases/' + original.priorReleaseId));
 const publicDraft = await request(base + 'releases/' + original.priorReleaseId, { method: 'GET', redirect: 'manual', signal });
 try { guard(publicDraft.status === 404); } finally { await publicDraft.body?.cancel(); }
 signal.throwIfAborted(); return Object.freeze({ ...proof, anonymousDraft404: true,
  transportEvidence: options.request ? 'injected-offline-http' : 'github-live-association-recovery' });
}
