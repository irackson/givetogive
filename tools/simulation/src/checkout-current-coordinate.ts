/** Explicit root phase coordination. No credential discovery, dispatch, payment
 * preparation or retries. Transport and responder retain their own one-shot
 * originals. A final asset is evidence to reconcile, never payment acceptance. */
import { setTimeout as sleep } from 'node:timers/promises';
import { assetName, type CheckoutAssetBinding } from './hosted-checkout-policy.ts';
import type { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
import type { CurrentCheckoutRootResponder } from './checkout-current-responder.ts';
import type { CurrentCheckoutPhase } from './checkout-current-phase.ts';

type Options = {
 binding: CheckoutAssetBinding;
 transport: Pick<CurrentCheckoutPrivateDraft, 'inspect'>;
 responder: Pick<CurrentCheckoutRootResponder, 'respond' | 'close'>;
 verifyContext(signal: AbortSignal): Promise<void>;
 verifyFinalContext?(signal: AbortSignal): Promise<void>;
 signal: AbortSignal;
 timeoutMs?: number;
 pollMs?: number;
};
const fail = (): never => { throw Error('Current coordination stopped; originals and holds retained; no automatic retry.'); };

export async function coordinateCurrentCheckout(options: Options) {
 const timeout = options.timeoutMs ?? 900000, interval = options.pollMs ?? 2000;
 if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 900000 ||
     !Number.isSafeInteger(interval) || interval < 1 || interval > 10000) return fail();
 const signal = AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]);
 const run = async <T>(action: () => Promise<T>): Promise<T> => {
  signal.throwIfAborted();
  let remove = () => {};
  const canceled = new Promise<never>((__resolve, reject) => {
   const stop = () => reject(Error('Current coordination canceled.'));
   signal.addEventListener('abort', stop, { once: true });
   remove = () => signal.removeEventListener('abort', stop);
  });
  try { const value = await Promise.race([action(), canceled]); signal.throwIfAborted(); return value; }
  finally { remove(); }
 };
 const name = (phase: Parameters<typeof assetName>[1]) => assetName(options.binding, phase);
 const completed: CurrentCheckoutPhase[] = [];
 try {
  for (;;) {
   const inventory = await run(() => options.transport.inspect(signal));
   if (!inventory.privateDraftVerified || inventory.releaseId !== options.binding.releaseId) return fail();
   const names = new Set(inventory.assets.map(asset => asset.name));
   if (names.size !== inventory.assets.length || !names.has(name('input'))) return fail();
   // Transport independently rejects foreign assets. Reject a final arriving
   // before root submission, and phase responses not produced by this root.
   for (const phase of ['opening', 'fixture', 'notice', 'submission'] as const) {
    if (names.has(name(`${phase}-response`)) && !completed.includes(phase)) return fail();
   }
   if (names.has(name('final'))) {
    if (!completed.includes('submission')) return fail();
    await run(() => (options.verifyFinalContext ?? options.verifyContext)(signal));
    return Object.freeze({ phases: Object.freeze([...completed]), finalAvailable: true,
     independentReconciliationRequired: true, paymentAccepted: false, retryAllowed: false });
   }
   await run(() => (completed.includes('submission') ? options.verifyFinalContext ?? options.verifyContext : options.verifyContext)(signal));
   const previous = completed.at(-1);
   let next: CurrentCheckoutPhase | undefined;
   if (!previous) next = 'opening';
   else if (previous === 'opening') next = 'fixture';
   else if (previous === 'fixture') {
    if (names.has(name('notice-request')) && names.has(name('submission-request'))) return fail();
    next = names.has(name('notice-request')) ? 'notice' : 'submission';
   } else if (previous === 'notice') next = 'submission';
   for (const phase of ['opening', 'fixture', 'notice', 'submission'] as const) {
    const allowed = completed.includes(phase) || phase === next;
    if (names.has(name(`${phase}-request`)) && !allowed) return fail();
   }
   if (next && names.has(name(`${next}-request`))) {
    await run(() => options.responder.respond(next, signal));
    completed.push(next);
   } else await sleep(interval, undefined, { signal });
  }
 } catch { return fail(); }
 finally { options.responder.close(); }
}
