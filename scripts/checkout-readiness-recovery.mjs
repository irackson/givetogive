// Read-only eligibility for the exact failed native readiness dispatch. This
// never resumes it, changes its draft, clears a hold or authorizes a retry.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const readinessRecoveryBinding = Object.freeze({
 priorHead: 'aed43e3304ffffdcdafbf53f2978c2d42b197182',
 priorRunId: '37953768787', diagnosticHead: 'b7cb0c8a2e59e6571e7bfe34e5b01319c453aa8d',
 diagnosticRunId: '37958435355',
 originalReceiptDigest: '9cbce2379a53f2aecfd5d8425e4f54f59d3fcd1b8d121360737998c36ad40a06',
});
const fail = () => { throw Error('Readiness recovery refused; original evidence and holds retained.'); };
/** @param {unknown} value */
function guard(value) { if (!value) fail(); }
/** @param {string} root @param {string} operationId @param {string} memberId */
export function readReadinessRecovery(root, operationId, memberId) {
 guard(operationId === '398c5cf9-62de-4908-afb0-ce6321e8b3ad' && memberId === 'synthetic-bcfa98ea084ed93e-003');
 const directory = resolve(root), dispatchName = 'current-dispatch-' + operationId, dispatch = join(directory, dispatchName);
 for (const path of [directory, dispatch]) guard(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
 const names = ['operator-lease.json', 'release.original.json', 'prerequisites.original.json',
  'predispatch-recovery.original.json', 'member-sign-in.intent.json', dispatchName].sort();
 const dispatchNames = ['dispatch-lease.json', 'draft-create.intent.json', 'draft-create.result.json',
  'workflow-dispatch.intent.json', 'workflow-dispatch.result.json'].sort();
 guard(readdirSync(directory).sort().join(',') === names.join(',') && readdirSync(dispatch).sort().join(',') === dispatchNames.join(','));
 const hash = createHash('sha256'), records = new Map();
 /** @param {string} relative */
 const read = relative => {
  const path = join(directory, relative); guard(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  const bytes = readFileSync(path);
  try { guard(bytes.length < 65536); hash.update(relative).update('\0').update(bytes).update('\0'); records.set(relative, JSON.parse(bytes.toString())); }
  finally { bytes.fill(0); }
 };
 for (const name of names) if (name === dispatchName) for (const child of dispatchNames) read(name + '/' + child); else read(name);
 guard(hash.digest('hex') === readinessRecoveryBinding.originalReceiptDigest);
 const original = z.object({ workflowRunId: z.literal(readinessRecoveryBinding.priorRunId),
  releaseId: z.number().int().safe().positive(), headSha: z.literal(readinessRecoveryBinding.priorHead), retryAllowed: z.literal(false) })
  .strict().parse(records.get(dispatchName + '/workflow-dispatch.result.json'));
 return Object.freeze({ ...readinessRecoveryBinding, operationId, memberId, priorReleaseId: original.releaseId,
  originalsPreserved: true, priorPreparationAbsent: true, priorAssociationAbsent: true, priorInputAbsent: true,
  priorSubmissionAbsent: true, financialRetry: false, providerAndOriginalBudgetRecheckRequired: true });
}
/** Pure shape checks are offline evidence; the native caller must obtain these
 * observations using its own authenticated GETs and fresh source/budget reads.
 * @param {number} priorReleaseId @param {string} operationId
 * @param {unknown} priorRun @param {unknown} diagnosticRun @param {unknown} release */
export function validateReadinessRecoveryRemote(priorReleaseId, operationId, priorRun, diagnosticRun, release) {
 guard(operationId === '398c5cf9-62de-4908-afb0-ce6321e8b3ad' && Number.isSafeInteger(priorReleaseId) && priorReleaseId > 0);
 const common = { event: z.literal('workflow_dispatch'), head_branch: z.literal('main'), run_attempt: z.literal(1),
  status: z.literal('completed'), path: z.literal('.github/workflows/checkout-current-staging.yml'),
  actor: z.object({ login: z.literal('irackson') }), triggering_actor: z.object({ login: z.literal('irackson') }) };
 z.object({ ...common, id: z.literal(Number(readinessRecoveryBinding.priorRunId)),
  head_sha: z.literal(readinessRecoveryBinding.priorHead), conclusion: z.literal('failure') }).parse(priorRun);
 z.object({ ...common, id: z.literal(Number(readinessRecoveryBinding.diagnosticRunId)),
  head_sha: z.literal(readinessRecoveryBinding.diagnosticHead), conclusion: z.literal('success') }).parse(diagnosticRun);
 const pending = { protocol: 1, purpose: 'current-cohort-private-checkout-pending', repository: 'irackson/givetogive',
  runId: '01d34cf1-7880-4978-aec3-e3c3ccc94b67', operationId, headSha: readinessRecoveryBinding.priorHead };
 z.object({ id: z.literal(priorReleaseId), draft: z.literal(true), prerelease: z.literal(false), published_at: z.null(),
  target_commitish: z.literal(readinessRecoveryBinding.priorHead), tag_name: z.literal('checkout-current-' + operationId),
  body: z.literal(JSON.stringify(pending)), assets: z.array(z.unknown()).length(0) }).parse(release);
 return Object.freeze({ failedDispatchPreserved: true, nativeReadinessDiagnosticSuccessful: true,
  priorDraftStillPendingAndEmpty: true, noFinancialActionAuthorized: true });
}
/** Authenticated GETs only. No retry, draft mutation, sign-in or payment action.
 * @param {number} priorReleaseId @param {string} operationId @param {string} token
 * @param {{request?: typeof fetch, signal?: AbortSignal}} [options] */
export async function observeReadinessRecoveryRemote(priorReleaseId, operationId, token, options = {}) {
 guard(typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token));
 const request = options.request ?? fetch, signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(60000)]);
 const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
 const base = 'https://api.github.com/repos/irackson/givetogive/';
 /** @param {string} path */
 const get = async path => {
  const response = await request(base + path, { method: 'GET', headers, redirect: 'error', signal });
  guard(response.ok); return response.json();
 };
 const proof = validateReadinessRecoveryRemote(priorReleaseId, operationId,
  await get('actions/runs/' + readinessRecoveryBinding.priorRunId),
  await get('actions/runs/' + readinessRecoveryBinding.diagnosticRunId), await get('releases/' + priorReleaseId));
 const publicDraft = await request(base + 'releases/' + priorReleaseId, { method: 'GET', redirect: 'manual', signal });
 try { guard(publicDraft.status === 404); } finally { await publicDraft.body?.cancel(); }
 signal.throwIfAborted();
 return Object.freeze({ ...proof, anonymousDraft404: true,
  transportEvidence: options.request ? 'injected-offline-http' : 'github-live-readiness-recovery' });
}
