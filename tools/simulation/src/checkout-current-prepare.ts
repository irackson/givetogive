/** Explicit CURRENT handoff; import is inert. Uses the supplied ORIGINAL UI
 * preparation journal, never constructs/resets it. Independent native callbacks
 * must observe source/job/member/budget/browser and provider state. This is not
 * financial submission, settlement or paid acceptance. */
import { createHash } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateCurrentBootstrapReadiness } from './checkout-current-bootstrap.ts';
import { currentCheckoutCandidate as c, recheckCurrentCheckoutProfile, type CurrentCheckoutProfile } from './checkout-current-profile.ts';
import { currentProfileDigest } from './checkout-current-phase.ts';
import { validateCurrentCheckoutInput, validateCurrentCheckoutProof, encryptCurrentCheckoutInput,
 decryptCurrentCheckoutInput, type CurrentCheckoutProof } from './checkout-current-input.ts';
import { validateRetainedCurrentPhaseAsset } from './checkout-current-exchange.ts';
import { assetName } from './hosted-checkout-policy.ts';
import { writeBootstrapOriginal, readBootstrapOriginal } from './checkout-bootstrap-retention.ts';
import type { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
import type { UiCheckoutPreparation } from './ui-checkout-preparation.ts';
import type { UiAccount, UiApi } from './ui-session.ts';
import type { SandboxPlan } from './sandbox-plan.ts';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (): never => { throw Error('Current input preparation unresolved; originals and holds retained; no retry; private details withheld.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }

export async function prepareCurrentCheckoutInput(rawReady: unknown, options: {
 root: string; key: Buffer; releaseId: number; account: UiAccount; session: UiApi;
 stagingBypass: string; plan: SandboxPlan;
 preparation: Pick<UiCheckoutPreparation, 'state' | 'prepare'>;
 draft: Pick<CurrentCheckoutPrivateDraft, 'upload'>;
 observeCurrent(boundary: 'unused' | 'prepared', signal: AbortSignal): Promise<CurrentCheckoutProfile>;
 observeOpening(profile: Readonly<CurrentCheckoutProfile>, signal: AbortSignal): Promise<CurrentCheckoutProof>;
 signal: AbortSignal; now?: () => number;
}) {
 let key: Buffer | undefined, ciphertext: Buffer | undefined;
 const now = options.now ?? Date.now, signal = AbortSignal.any([options.signal, AbortSignal.timeout(180000)]);
 const bounded = async <T>(action: () => Promise<T>): Promise<T> => {
  signal.throwIfAborted(); let remove = () => {};
  const interrupted = new Promise<never>((__resolve, reject) => {
   const stop = () => reject(Error('Current preparation canceled.'));
   signal.addEventListener('abort', stop, { once: true }); remove = () => signal.removeEventListener('abort', stop);
  });
  try { const value = await Promise.race([action(), interrupted]); signal.throwIfAborted(); return value; }
  finally { remove(); }
 };
 try {
  const ready = validateCurrentBootstrapReadiness(rawReady, now()), initial = ready.profile;
  guard(Buffer.isBuffer(options.key) && options.key.length === 32 && Number.isSafeInteger(options.releaseId) && options.releaseId > 0 &&
   options.account.id === c.agentId && options.account.userId === c.memberId && options.account.email === c.memberEmail &&
   options.session.userId === c.memberId && options.account.password.length >= 12 && options.account.password.length <= 512 &&
   options.stagingBypass.length >= 16 && options.stagingBypass.length <= 2048 && options.plan.runId === c.runId &&
   options.plan.runBudgetCents === c.runBudgetCents && options.plan.actorBudgetCents === c.actorBudgetCents && options.plan.steps.length === 3);
  const steps = options.plan.steps.filter(step => step.operationId === c.operationId); guard(steps.length === 1);
  const step = steps[0]!;
  guard(step.agentId === c.agentId && step.scenario === c.scenario && step.maximumAmountCents === 500 && step.expectedTier === 'neighbor' &&
   Object.keys(step.checkout).sort().join(',') === 'kind,recurring,tier' && step.checkout.kind === 'supporter' &&
   step.checkout.tier === 'supporter' && step.checkout.recurring === true &&
   options.preparation.state(c.operationId) === undefined);
  const root = resolve(options.root);
  for (let path = root;; path = dirname(path)) {
   guard(!lstatSync(path).isSymbolicLink() && realpathSync(path) === path); if (dirname(path) === path) break;
  }
  guard(lstatSync(root).isDirectory()); signal.throwIfAborted(); key = Buffer.from(options.key);
  const directory = join(root, `current-root-input-${c.operationId}-${initial.job.jobId}-${initial.job.jobNonce}`);
  mkdirSync(directory, { mode: 0o700 });
  const record = (name: string, value: unknown) => {
   const bytes = Buffer.from(JSON.stringify(value)); try { writeBootstrapOriginal(directory, name, bytes); } finally { bytes.fill(0); }
  };
  record('preparation-lease.json', { profileDigest: ready.profileDigest, connectionNonce: ready.connectionNonce,
   maximumPreparations: 1, maximumInputUploads: 1, paymentAccepted: false, retryAllowed: false });
  record('readiness.original.json', ready);
  const before = recheckCurrentCheckoutProfile(await bounded(() => options.observeCurrent('unused', signal)), initial, now());
  validateCurrentBootstrapReadiness(ready, now());
  record('normal-preparation.intent.json', { operationId: c.operationId, actorId: c.memberId, maximumAmountCents: 500,
   profileDigest: currentProfileDigest(before), paymentAccepted: false, retryAllowed: false });
  // Mutation remains awaited; timeout/ambiguity can never admit a retry.
  await options.preparation.prepare(options.session, c.memberId, step);
  signal.throwIfAborted(); guard(options.preparation.state(c.operationId) === 'prepared');
  record('normal-preparation.result.json', { operationId: c.operationId, state: 'prepared', paymentAccepted: false, retryAllowed: false });
  const profile = recheckCurrentCheckoutProfile(await bounded(() => options.observeCurrent('prepared', signal)), initial, now());
  const proof = validateCurrentCheckoutProof(await bounded(() => options.observeOpening(profile, signal)), profile, now());
  const input = validateCurrentCheckoutInput({ protocol: 1, purpose: 'current-cohort-private-member-input', profile,
   profileDigest: currentProfileDigest(profile), member: options.account, stagingBypass: options.stagingBypass,
   proof, retryAllowed: false, paymentAccepted: false }, initial, now());
  ciphertext = encryptCurrentCheckoutInput(input, key, initial, now());
  guard(currentProfileDigest(decryptCurrentCheckoutInput(ciphertext, key, initial, now()).profile) === input.profileDigest);
  const binding = { releaseId: options.releaseId, operationId: c.operationId,
   job: { id: initial.job.jobId, nonce: initial.job.jobNonce, headSha: initial.job.headSha } };
  const name = assetName(binding, 'input'), digest = hash(ciphertext);
  writeBootstrapOriginal(directory, name, ciphertext);
  recheckCurrentCheckoutProfile(await bounded(() => options.observeCurrent('prepared', signal)), profile, now());
  validateCurrentCheckoutProof(proof, profile, now());
  const unchanged = () => {
   const bytes = readBootstrapOriginal(join(directory, name)); try { guard(hash(bytes) === digest && hash(ciphertext!) === digest); } finally { bytes.fill(0); }
  };
  unchanged(); record('input-upload.intent.json', { ciphertextDigest: digest, maximumUploads: 1, paymentAccepted: false, retryAllowed: false });
  const retained = validateRetainedCurrentPhaseAsset(await bounded(() => options.draft.upload('input', ciphertext!, signal)), binding, 'input', ciphertext, now());
  unchanged(); validateCurrentCheckoutProof(proof, profile, now());
  record('input-upload.result.json', retained);
  return { input, initialProfile: initial, connectionNonce: ready.connectionNonce,
   privateInputRetained: true, independentReconciliationRequired: true, paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); }
 finally { key?.fill(0); ciphertext?.fill(0); }
}
