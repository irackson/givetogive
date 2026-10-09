/** Read-only wait for root's one-shot binding of the initially empty private
 * draft. The worker nonce exists only after dispatch. Pending is not authority;
 * unknown bodies/foreign assets reject rather than being waited past. */
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
import type { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
const fail = (): never => { throw Error('Current private draft association unconfirmed; no member action or retry; private details withheld.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
export function currentPendingDraftBody(draft: Pick<CurrentCheckoutPrivateDraft, 'association'>) {
 const a = draft.association;
 return { protocol: 1, purpose: 'current-cohort-private-checkout-pending', repository: a.repository,
  runId: a.runId, operationId: a.operationId, headSha: a.headSha };
}
export async function awaitCurrentDraftAssociation(draft: Pick<CurrentCheckoutPrivateDraft, 'association'>, releaseId: number, options: {
 token: string; signal: AbortSignal; verifyCurrent(signal: AbortSignal): Promise<void>;
 request?: typeof fetch; pollMs?: number; timeoutMs?: number;
}) {
 try {
  guard(Number.isSafeInteger(releaseId) && releaseId > 0 && typeof options.token === 'string' &&
   options.token.length >= 20 && options.token.length <= 4096 && !/[\r\n]/.test(options.token));
  const interval = options.pollMs ?? 2000, timeout = options.timeoutMs ?? 120000;
  guard(Number.isSafeInteger(interval) && interval >= 1 && interval <= 10000 && Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 120000);
  const request = options.request ?? fetch, signal = AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]);
  const url = `https://api.github.com/repos/irackson/givetogive/releases/${releaseId}`;
  const anonymous = async () => {
   const response = await request(url, { method: 'GET', redirect: 'manual', signal,
    headers: { Accept: 'application/vnd.github+json' } });
   try { guard(response.status === 404); } finally { void response.body?.cancel().catch(() => undefined); }
  };
  const same = (raw: unknown, expected: object) => raw && typeof raw === 'object' && !Array.isArray(raw) &&
   Object.keys(raw).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => (raw as Record<string, unknown>)[key] === value);
  for (;;) {
   signal.throwIfAborted(); await options.verifyCurrent(signal); signal.throwIfAborted(); await anonymous();
   const response = await request(url, { method: 'GET', redirect: 'error', signal, headers: {
    Authorization: `Bearer ${options.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } });
   if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return fail(); }
   const bytes = await checkoutResponseBytes(response, 262144, signal); let raw: unknown;
   try { raw = JSON.parse(bytes.toString()); } finally { bytes.fill(0); }
   const release = z.object({ id: z.literal(releaseId), draft: z.literal(true), prerelease: z.literal(false), published_at: z.null(),
    target_commitish: z.literal(draft.association.headSha), tag_name: z.literal(`checkout-current-${draft.association.operationId}`),
    body: z.string().max(16384), assets: z.array(z.unknown()).max(10) }).parse(raw);
   const body: unknown = JSON.parse(release.body);
   if (same(body, draft.association)) {
    await anonymous(); await options.verifyCurrent(signal); signal.throwIfAborted();
    return Object.freeze({ exactCurrentAssociationObserved: true, anonymousDraft404: true, originalInputStillRequired: true,
     paymentAccepted: false, retryAllowed: false, transportEvidence: options.request ? 'injected-offline-http' : 'github-live-current-association' });
   }
   guard(same(body, currentPendingDraftBody(draft)) && release.assets.length === 0);
   await sleep(interval, undefined, { signal });
  }
 } catch { return fail(); }
}
