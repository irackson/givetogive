/** CURRENT read-only GitHub readiness discovery/readback. Never dispatches,
 * logs in, prepares or admits payment. Rechecks preserve the original memory
 * timestamp; live job observation is not fresh browser/memory evidence. */
import { z } from 'zod';
import { validateCurrentBootstrapReadiness } from './checkout-current-bootstrap.ts';
import { observeCurrentCheckoutJob } from './checkout-current-job.ts';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
import type { CurrentCheckoutSource } from './checkout-current-profile.ts';
const fail = (): never => { throw Error('Current readiness observation rejected; no financial admission; private details withheld.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const id = z.string().regex(/^[1-9][0-9]{0,19}$/), head = z.string().regex(/^[a-f0-9]{40}$/);
const targetSchema = z.object({ headSha: head, workflowRunId: id, jobId: id.optional() }).strict();
const name = 'GiveToGive current Checkout browser readiness';
const checkSchema = z.object({ id: z.number().int().safe().positive(), name: z.literal(name), head_sha: head,
 external_id: z.string(), status: z.literal('in_progress'), conclusion: z.null(),
 app: z.object({ slug: z.literal('github-actions') }), output: z.object({ title: z.literal(name), summary: z.string().max(16384) }) });
export async function observeCurrentCheckoutReadiness(rawTarget: unknown, source: CurrentCheckoutSource, options: {
 token: string; signal: AbortSignal; request?: typeof fetch; now?: () => number;
 original?: { checkRunId: string; readiness: ReturnType<typeof validateCurrentBootstrapReadiness> };
}) {
 try {
  const target = targetSchema.parse(rawTarget), now = options.now ?? Date.now, request = options.request ?? fetch;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60000)]);
  const job = await observeCurrentCheckoutJob(target, { token: options.token, signal, request: options.request, now });
  const json = async (path: string) => {
   signal.throwIfAborted();
   const response = await request(`https://api.github.com/repos/irackson/givetogive/${path}`, {
    method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${options.token}`,
     Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
   });
   if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return fail(); }
   const bytes = await checkoutResponseBytes(response, 262144, signal);
   try { return JSON.parse(bytes.toString()) as unknown; } finally { bytes.fill(0); }
  };
  let checkRunId: string;
  if (options.original) checkRunId = id.parse(options.original.checkRunId);
  else {
   const list = z.object({ total_count: z.number().int().nonnegative().max(100), check_runs: z.array(z.object({
    id: z.number().int().safe().positive(), name: z.string(), external_id: z.string().nullable(),
   })).max(100) }).parse(await json(`commits/${target.headSha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100&filter=all`));
   guard(list.total_count === list.check_runs.length);
   const matches = list.check_runs.filter(row => row.name === name && row.external_id?.startsWith(`current-checkout-ready-${target.workflowRunId}-${job.jobId}-`));
   guard(matches.length === 1); checkRunId = String(matches[0]!.id);
  }
  const first = checkSchema.parse(await json(`check-runs/${checkRunId}`));
  // Only initial observation admits freshness. A repeated GET cannot freshen the
  // original native browser/free-RAM evidence from the immutable publication.
  const time = options.original ? Date.parse(options.original.readiness.observedAt) : now();
  const ready = validateCurrentBootstrapReadiness(JSON.parse(first.output.summary), time), p = ready.profile;
  guard(String(first.id) === checkRunId && first.head_sha === target.headSha && p.job.headSha === target.headSha &&
   p.job.workflowRunId === target.workflowRunId && p.job.jobId === job.jobId &&
   first.external_id === `current-checkout-ready-${target.workflowRunId}-${job.jobId}-${p.job.jobNonce}` &&
   p.source.canonicalSourceDigest === source.canonicalSourceDigest && p.source.rootLockDigest === source.rootLockDigest &&
   p.source.runnerDigest === source.runnerDigest);
  if (options.original) guard(JSON.stringify(ready) === JSON.stringify(validateCurrentBootstrapReadiness(options.original.readiness, time)) &&
   now() >= time - 5000);
  const second = checkSchema.parse(await json(`check-runs/${checkRunId}`));
  guard(JSON.stringify(first) === JSON.stringify(second));
  await observeCurrentCheckoutJob({ ...target, jobId: job.jobId }, { token: options.token, signal, request: options.request, now });
  signal.throwIfAborted(); if (!options.original) validateCurrentBootstrapReadiness(ready, now());
  return { checkRunId, readiness: ready, observedAt: new Date(now()).toISOString(),
   transportEvidence: options.request ? 'injected-offline-http' : 'github-live-current-readiness',
   originalMemoryObservationOnly: true, independentOperatorVerificationRequired: true,
   checkoutPrepared: false, paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); }
}
