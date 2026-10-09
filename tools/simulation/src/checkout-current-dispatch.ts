/** Explicit root dispatch and one-shot private association, no member/payment
 * actions. Native caller must independently review staging/source/original budget
 * before invocation and in verifyCurrent. Injected HTTP is offline evidence. */
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { currentCheckoutCandidate as c, type CurrentCheckoutSource } from './checkout-current-profile.ts';
import { currentCheckoutSourceEvidence } from './checkout-current-preflight.ts';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
import { writeBootstrapOriginal } from './checkout-bootstrap-retention.ts';
import { observeCurrentCheckoutReadiness } from './checkout-current-readiness.ts';
import { CurrentCheckoutPrivateDraft, currentCheckoutDraftTag } from './checkout-current-draft.ts';
const fail = (): never => { throw Error('Current native dispatch unresolved; originals retained; no automatic retry; private details withheld.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
export function currentCheckoutRepositoryUrl(path: string) {
  guard(!path.startsWith('/') && !path.includes('..') && !path.includes('#'));
  return `https://api.github.com/repos/irackson/givetogive${path ? `/${path}` : ''}`;
}
export async function dispatchCurrentCheckoutWorker(options: {
 root: string; headSha: string; source: CurrentCheckoutSource; token: string; signal: AbortSignal;
 verifyCurrent(signal: AbortSignal): Promise<void>; request?: typeof fetch; now?: () => number; pollMs?: number;
}) {
 try {
  const now = options.now ?? Date.now, request = options.request ?? fetch, poll = options.pollMs ?? 2000;
  currentCheckoutSourceEvidence(options.source, options.headSha);
  guard(typeof options.token === 'string' && options.token.length >= 20 && options.token.length <= 4096 && !/[\r\n]/.test(options.token) &&
   Number.isSafeInteger(poll) && poll > 0 && poll <= 10000);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(720000)]), root = resolve(options.root);
  for (let path = root;; path = dirname(path)) {
   guard(!lstatSync(path).isSymbolicLink() && realpathSync(path) === path); if (dirname(path) === path) break;
  }
  guard(lstatSync(root).isDirectory()); signal.throwIfAborted();
  await options.verifyCurrent(signal); signal.throwIfAborted();
  const directory = join(root, `current-dispatch-${c.operationId}`); mkdirSync(directory, { mode: 0o700 });
  const record = (name: string, value: unknown) => {
   const bytes = Buffer.from(JSON.stringify(value)); try { writeBootstrapOriginal(directory, name, bytes); } finally { bytes.fill(0); }
  };
  const api = async (path: string, method = 'GET', body?: unknown, status = 200) => {
   signal.throwIfAborted();
   const response = await request(currentCheckoutRepositoryUrl(path), { method, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), headers: { Authorization: `Bearer ${options.token}`,
     Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
   if (response.status !== status) { void response.body?.cancel().catch(() => undefined); return fail(); }
   const bytes = await checkoutResponseBytes(response, 262144, signal);
   try { return JSON.parse(bytes.toString()) as unknown; } finally { bytes.fill(0); }
  };
  const private404 = async (path: string, authenticated: boolean) => {
   const response = await request(`https://api.github.com/repos/irackson/givetogive/${path}`, { method: 'GET', redirect: 'manual', signal,
    headers: { Accept: 'application/vnd.github+json', ...(authenticated ? { Authorization: `Bearer ${options.token}` } : {}) } });
   try { guard(response.status === 404); } finally { void response.body?.cancel().catch(() => undefined); }
  };
  const tag = currentCheckoutDraftTag(c.operationId), pending = { protocol: 1, purpose: 'current-cohort-private-checkout-pending',
   repository: 'irackson/givetogive', runId: c.runId, operationId: c.operationId, headSha: options.headSha };
  record('dispatch-lease.json', { headSha: options.headSha, operationId: c.operationId, maximumDispatches: 1,
   maximumDraftCreates: 1, maximumAssociationWrites: 1, paymentAccepted: false, retryAllowed: false });
  const repo = z.object({ full_name: z.literal('irackson/givetogive'), private: z.literal(false) }).parse(await api(''));
  guard(repo.full_name === pending.repository); await private404(`releases/tags/${tag}`, true);
  const prior = z.object({ total_count: z.number().int().nonnegative().max(100), workflow_runs: z.array(z.object({
   status: z.string(),
  })).max(100) }).parse(await api('actions/workflows/checkout-current-staging.yml/runs?event=workflow_dispatch&branch=main&per_page=100'));
  guard(prior.total_count === prior.workflow_runs.length && prior.workflow_runs.every(run => run.status === 'completed'));
  await options.verifyCurrent(signal); signal.throwIfAborted();
  record('draft-create.intent.json', { tag, headSha: options.headSha, maximumPosts: 1, retryAllowed: false });
  const created = z.object({ id: z.number().int().safe().positive(), draft: z.literal(true), prerelease: z.literal(false),
   published_at: z.null(), target_commitish: z.literal(options.headSha), tag_name: z.literal(tag), body: z.literal(JSON.stringify(pending)),
   assets: z.array(z.unknown()).length(0) }).parse(await api('releases', 'POST', {
    tag_name: tag, target_commitish: options.headSha, name: 'Private current staging Checkout', draft: true, prerelease: false, body: JSON.stringify(pending),
   }, 201));
  record('draft-create.result.json', { releaseId: created.id, headSha: options.headSha, tag, retryAllowed: false });
  await private404(`releases/${created.id}`, false); await options.verifyCurrent(signal); signal.throwIfAborted();
  record('workflow-dispatch.intent.json', { releaseId: created.id, headSha: options.headSha, maximumPosts: 1, retryAllowed: false });
  const dispatched = z.object({ workflow_run_id: z.number().int().safe().positive(), run_url: z.string(), html_url: z.string() }).strict()
   .parse(await api('actions/workflows/checkout-current-staging.yml/dispatches', 'POST', {
    ref: 'main', inputs: { expected_sha: options.headSha, release_id: String(created.id) },
   }));
  const workflowRunId = String(dispatched.workflow_run_id);
  guard(dispatched.run_url === `https://api.github.com/repos/irackson/givetogive/actions/runs/${workflowRunId}` &&
   dispatched.html_url === `https://github.com/irackson/givetogive/actions/runs/${workflowRunId}`);
  record('workflow-dispatch.result.json', { workflowRunId, releaseId: created.id, headSha: options.headSha, retryAllowed: false });
  let observation: Awaited<ReturnType<typeof observeCurrentCheckoutReadiness>> | undefined;
  while (!observation) {
   await options.verifyCurrent(signal); signal.throwIfAborted();
   const run = z.object({ id: z.literal(dispatched.workflow_run_id), head_sha: z.literal(options.headSha), event: z.literal('workflow_dispatch'),
    head_branch: z.literal('main'), run_attempt: z.literal(1), status: z.enum(['queued', 'in_progress']), conclusion: z.null(),
    path: z.literal('.github/workflows/checkout-current-staging.yml'), actor: z.object({ login: z.literal('irackson') }),
    triggering_actor: z.object({ login: z.literal('irackson') }) }).parse(await api(`actions/runs/${workflowRunId}`));
   if (run.status === 'in_progress') {
    const checks = z.object({ total_count: z.number().int().nonnegative().max(100), check_runs: z.array(z.object({ external_id: z.string().nullable() })).max(100) })
     .parse(await api(`commits/${options.headSha}/check-runs?check_name=${encodeURIComponent('GiveToGive current Checkout browser readiness')}&per_page=100&filter=all`));
    guard(checks.total_count === checks.check_runs.length);
    const matches = checks.check_runs.filter(check => check.external_id?.startsWith(`current-checkout-ready-${workflowRunId}-`));
    guard(matches.length <= 1);
    if (matches.length === 1) observation = await observeCurrentCheckoutReadiness({ headSha: options.headSha, workflowRunId }, options.source,
     { token: options.token, signal, request: options.request, now });
   }
   if (!observation) await sleep(poll, undefined, { signal });
  }
  record('readiness.original.json', observation);
  const draft = new CurrentCheckoutPrivateDraft(observation.readiness.profile, options.headSha, options.source, created.id, options.token,
   { ...(options.request ? { request: options.request } : {}), now });
  await options.verifyCurrent(signal); signal.throwIfAborted();
  record('association-write.intent.json', { releaseId: created.id, profileDigest: observation.readiness.profileDigest, maximumPatches: 1, retryAllowed: false });
  await api(`releases/${created.id}`, 'PATCH', { body: JSON.stringify(draft.association) });
  const inventory = await draft.inspect(signal); guard(inventory.assets.length === 0);
  await observeCurrentCheckoutReadiness({ headSha: options.headSha, workflowRunId }, options.source,
   { token: options.token, signal, request: options.request, now, original: observation });
  await options.verifyCurrent(signal); signal.throwIfAborted();
  record('association-write.result.json', { releaseId: created.id, exactPrivateDraftReadback: true, profileDigest: observation.readiness.profileDigest,
   paymentAccepted: false, retryAllowed: false });
  return { draft, observation, directory, workflowRunId, releaseId: created.id,
   nativeEvidence: options.request ? 'injected-offline-http' : 'github-live-current-dispatch',
   memberInputStillRequired: true, paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); }
}
