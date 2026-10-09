/** GET-only final lifecycle observation. May observe completed jobs, NEVER
 * financial admission. Live phases retain the separate in-progress validator. */
import { z } from 'zod';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
const id = z.string().regex(/^[1-9][0-9]{0,19}$/), head = z.string().regex(/^[a-f0-9]{40}$/);
const fail = (): never => { throw Error('Current final job observation rejected; private details withheld; no payment acceptance.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
export async function observeCurrentCheckoutFinalJob(raw: unknown, options: {
 token: string; signal: AbortSignal; request?: typeof fetch;
}) {
 try {
  const target = z.object({ headSha: head, workflowRunId: id, jobId: id }).strict().parse(raw);
  guard(typeof options.token === 'string' && options.token.length >= 20 && options.token.length <= 4096 && !/[\r\n]/.test(options.token));
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30000)]), request = options.request ?? fetch;
  const json = async (path: string) => {
   signal.throwIfAborted(); const response = await request(`https://api.github.com/repos/irackson/givetogive/${path}`, {
    method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${options.token}`,
     Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } });
   if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return fail(); }
   const bytes = await checkoutResponseBytes(response, 262144, signal); try { return JSON.parse(bytes.toString()) as unknown; } finally { bytes.fill(0); }
  };
  const lifecycle = { status: z.enum(['in_progress', 'completed']), conclusion: z.string().nullable() };
  const run = z.object({ id: z.number().int().safe().positive(), head_sha: head, event: z.literal('workflow_dispatch'), head_branch: z.literal('main'),
   run_attempt: z.literal(1), path: z.literal('.github/workflows/checkout-current-staging.yml'), ...lifecycle,
   actor: z.object({ login: z.literal('irackson') }), triggering_actor: z.object({ login: z.literal('irackson') }),
   repository: z.object({ full_name: z.literal('irackson/givetogive'), private: z.literal(false) }) }).parse(await json(`actions/runs/${target.workflowRunId}`));
  const jobs = z.object({ total_count: z.literal(1), jobs: z.array(z.object({ id: z.number().int().safe().positive(),
   run_id: z.number().int().safe().positive(), head_sha: head, run_attempt: z.literal(1), name: z.literal('checkout-current-parent'),
   labels: z.array(z.string()).max(20), ...lifecycle })).length(1) }).parse(await json(`actions/runs/${target.workflowRunId}/jobs?filter=latest&per_page=100`));
  const job = jobs.jobs[0]!;
  guard(String(run.id) === target.workflowRunId && run.head_sha === target.headSha && String(job.id) === target.jobId &&
   String(job.run_id) === target.workflowRunId && job.head_sha === target.headSha && job.labels.includes('ubuntu-24.04'));
  for (const item of [run, job]) guard(item.status === 'in_progress' ? item.conclusion === null : item.conclusion !== null);
  guard(run.status !== 'completed' || job.status === 'completed'); signal.throwIfAborted();
  return Object.freeze({ workflowRunId: target.workflowRunId, jobId: target.jobId, headSha: target.headSha,
   runFinished: run.status === 'completed', jobFinished: job.status === 'completed',
   successful: run.status === 'completed' && run.conclusion === 'success' && job.conclusion === 'success',
   financialAdmission: false, paymentAccepted: false, independentClosureAndSettlementRequired: true,
   transportEvidence: options.request ? 'injected-offline-http' : 'github-live-current-final-job' });
 } catch { return fail(); }
}
