/** Local read-only observer. A public marker alone is never financial admission.
 * Source/release/database/budget verification remains the operator's responsibility.
 * Rechecks preserve the original readiness time rather than inventing fresh memory evidence. */
import { z } from 'zod';
import { approved } from './hosted-checkout-policy.ts';
import { validateCheckoutReadiness, type CheckoutReadiness } from './checkout-readiness.ts';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const numericId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const fail = (): never => { throw Error('Local Checkout readiness observation unconfirmed; no financial admission.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const runSchema = z.object({ id: z.number().int().safe().positive(), head_sha: sha,
 event: z.literal('workflow_dispatch'), head_branch: z.literal('main'), run_attempt: z.literal(1),
 status: z.literal('in_progress'), conclusion: z.null(), path: z.literal('.github/workflows/checkout-staging.yml'),
 actor: z.object({ login: z.literal(approved.actor) }), triggering_actor: z.object({ login: z.literal(approved.actor) }),
 repository: z.object({ full_name: z.literal(approved.repository), private: z.literal(false) }) });
const name = 'GiveToGive Checkout parent readiness';
const checkSchema = z.object({ id: z.number().int().safe().positive(), name: z.literal(name), head_sha: sha,
 external_id: z.string(), status: z.literal('in_progress'), conclusion: z.null(),
 app: z.object({ slug: z.literal('github-actions') }), output: z.object({ title: z.literal(name), summary: z.string().max(16384) }) });

export async function observeCheckoutReadiness(binding: {
 headSha: string; runId: string; checkRunId: string;
 canonicalSourceDigest: string; rootLockDigest: string; runnerDigest: string;
}, options: { token: string; signal: AbortSignal; request?: typeof fetch; now?: () => number;
 original?: CheckoutReadiness }) {
 try {
  const now = options.now ?? Date.now, request = options.request ?? fetch;
  sha.parse(binding.headSha); numericId.parse(binding.runId); numericId.parse(binding.checkRunId);
  for (const digest of [binding.canonicalSourceDigest, binding.rootLockDigest, binding.runnerDigest])
   guard(/^[a-f0-9]{64}$/.test(digest));
  guard(options.token.length >= 20 && options.token.length <= 4096 && !/[\r\n]/.test(options.token));
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60000)]);
  async function json(path: string) {
   signal.throwIfAborted();
   const response = await request(`https://api.github.com/repos/${approved.repository}/${path}`, {
    method: 'GET', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
   });
   if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); fail(); }
   const bytes = await checkoutResponseBytes(response, 262144, signal);
   try { return JSON.parse(bytes.toString('utf8')) as unknown; } finally { bytes.fill(0); }
  }
  async function live(ready: CheckoutReadiness) {
   const run = runSchema.parse(await json(`actions/runs/${binding.runId}`));
   guard(String(run.id) === binding.runId && run.head_sha === binding.headSha);
   const jobs = z.object({ total_count: z.literal(1), jobs: z.array(z.object({
    id: z.number().int().safe().positive(), run_id: z.number().int().safe().positive(), head_sha: sha,
    run_attempt: z.literal(1), name: z.literal('checkout-parent'), status: z.literal('in_progress'),
    conclusion: z.null(), labels: z.array(z.string()).max(20),
   })).length(1) }).parse(await json(`actions/runs/${binding.runId}/jobs?filter=latest&per_page=100`));
   const job = jobs.jobs[0]!;
   guard(String(job.id) === ready.jobId && String(job.run_id) === binding.runId &&
    job.head_sha === binding.headSha && job.labels.includes('ubuntu-24.04'));
  }
  const first = checkSchema.parse(await json(`check-runs/${binding.checkRunId}`));
  const raw = z.object({ transportEvidence: z.literal('github-live-run-job-readback'),
   nativeParentReadinessStillRequired: z.literal(true) }).passthrough().parse(JSON.parse(first.output.summary));
  const { transportEvidence: _transport, nativeParentReadinessStillRequired: _native, ...metadata } = raw;
  const original = options.original;
  // The initial observation must be fresh. Later checks only prove continued live
  // identity; they cannot freshen the earlier free-RAM measurement or admission.
  const ready = validateCheckoutReadiness(metadata, binding.headSha, original ? Date.parse(original.observedAt) : now());
  guard(ready.runId === binding.runId && String(first.id) === binding.checkRunId && first.head_sha === binding.headSha &&
   first.external_id === `checkout-ready-${ready.runId}-${ready.jobId}-${ready.jobNonce}` &&
   ready.canonicalSourceDigest === binding.canonicalSourceDigest && ready.rootLockDigest === binding.rootLockDigest &&
   ready.runnerDigest === binding.runnerDigest);
  if (original) guard(JSON.stringify(ready) === JSON.stringify(validateCheckoutReadiness(original, binding.headSha, Date.parse(original.observedAt))) &&
   now() >= Date.parse(ready.observedAt) - 5000);
  await live(ready);
  const second = checkSchema.parse(await json(`check-runs/${binding.checkRunId}`));
  guard(JSON.stringify(second) === JSON.stringify(first));
  await live(ready);
  signal.throwIfAborted();
  if (!original) validateCheckoutReadiness(ready, binding.headSha, now());
  return { readiness: ready, observedAt: new Date(now()).toISOString(),
   transportEvidence: options.request ? 'injected-offline-http' : 'github-live-readiness-observation',
   originalMemoryObservationOnly: true, independentOperatorVerificationRequired: true,
   checkoutPrepared: false, paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); }
}
