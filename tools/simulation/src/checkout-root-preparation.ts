/** Explicit local orchestration; import is inert. No env, SDK or credential loading.
 * Only the existing ordinary UI preparation can create a Checkout. The operator
 * must provide real current release/DB/budget observations and an owned SDK reader.
 * This handoff is not settlement or paid acceptance. */
import { mkdirSync, lstatSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { approved, digest, assetName, validateManifest, validateInput, validateProof, type Manifest, type Proof } from './hosted-checkout-policy.ts';
import { validateCheckoutReadiness, type CheckoutReadiness } from './checkout-readiness.ts';
import { encryptInput, decryptInput } from './hosted-checkout-protocol.ts';
import { writeBootstrapOriginal, readBootstrapOriginal } from './checkout-bootstrap-retention.ts';
import { validateRetainedCheckoutAsset, type CheckoutPrivateDraft } from './hosted-checkout-github.ts';
import type { UiAccount, UiApi } from './ui-session.ts';
import type { SandboxPlan } from './sandbox-plan.ts';
import type { UiCheckoutPreparation } from './ui-checkout-preparation.ts';
import type { LocalCheckoutProofReader } from './checkout-provider-proof.ts';
const fail = (): never => { throw Error('Local Checkout preparation unresolved; originals retained; no automatic retry.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function bounded<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
 signal.throwIfAborted(); let remove = () => {};
 const interrupted = new Promise<never>((__resolve, reject) => {
  const stop = () => reject(Error('cancelled'));
  signal.addEventListener('abort', stop, { once: true }); remove = () => signal.removeEventListener('abort', stop);
 });
 try { return await Promise.race([action(), interrupted]); } finally { remove(); }
}

export async function prepareHostedCheckoutInput(rawManifest: unknown, head: string, options: {
 root: string; key: Buffer; readiness: CheckoutReadiness; account: UiAccount; stagingBypass: string;
 session: UiApi; plan: SandboxPlan; preparation: Pick<UiCheckoutPreparation, 'state' | 'prepare'>;
 verifyCurrent: () => Promise<void>;
 createOwnedReader: (manifest: Manifest) => Promise<Pick<LocalCheckoutProofReader, 'read' | 'close'>>;
 draft: Pick<CheckoutPrivateDraft, 'upload'>; signal: AbortSignal; now?: () => number;
}) {
 let key: Buffer | undefined, input: Buffer | undefined, reader: Pick<LocalCheckoutProofReader, 'read' | 'close'> | undefined;
 const now = options.now ?? Date.now, signal = AbortSignal.any([options.signal, AbortSignal.timeout(180000)]);
 try {
  const manifest = validateManifest(rawManifest, head, now());
  const ready = validateCheckoutReadiness(options.readiness, head, now());
  guard(ready.jobId === manifest.job.id && ready.jobNonce === manifest.job.nonce &&
   ready.canonicalSourceDigest === manifest.canonicalSourceDigest && ready.rootLockDigest === manifest.rootLockDigest &&
   ready.runnerDigest === manifest.runnerDigest);
  guard(Buffer.isBuffer(options.key) && options.key.length === 32 && options.account.id === approved.memberId &&
   options.account.userId === manifest.actorId && options.account.email === approved.memberEmail &&
   options.session.userId === options.account.userId && options.plan.runId === manifest.runId &&
   options.plan.runBudgetCents === manifest.budget.runBudgetCents && options.plan.actorBudgetCents === manifest.budget.actorBudgetCents &&
   typeof options.account.password === 'string' && options.account.password.length >= 12 && options.account.password.length <= 512 &&
   typeof options.stagingBypass === 'string' && options.stagingBypass.length >= 16 && options.stagingBypass.length <= 2048);
  const candidates = options.plan.steps.filter(step => step.operationId === manifest.operationId);
  guard(candidates.length === 1);
  const step = candidates[0]!;
  guard(step.agentId === options.account.id && step.scenario === manifest.scenario && step.maximumAmountCents === manifest.maximumAmountCents &&
   step.expectedTier === manifest.expectedTier && step.checkout.kind === 'supporter' && step.checkout.tier === manifest.expectedTier &&
   !step.checkout.recurring && !step.checkout.askId && !step.checkout.fundId && !step.checkout.grossAmount && !step.checkout.quoteVersion &&
   options.preparation.state(manifest.operationId) === undefined);
  signal.throwIfAborted(); key = Buffer.from(options.key);
  const root = resolve(options.root);
  for (let cursor = root;; cursor = dirname(cursor)) {
   guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
   if (dirname(cursor) === cursor) break;
  }
  guard(lstatSync(root).isDirectory());
  const directory = join(root, `checkout-root-input-${manifest.operationId}-${manifest.job.id}-${manifest.job.nonce}`);
  mkdirSync(directory, { mode: 0o700 });
  if (process.platform === 'linux') { const fd = openSync(root, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  const original = (name: string, value: unknown) => {
   const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
   try { writeBootstrapOriginal(directory, name, bytes); } finally { if (!Buffer.isBuffer(value)) bytes.fill(0); }
  };
  original('preparation-lease.json', { protocol: 1, manifestDigest: digest(manifest), maximumPreparations: 1, maximumInputUploads: 1,
   paymentAccepted: false, retryAllowed: false });
  original('manifest.original.json', manifest); original('readiness.original.json', ready);
  await bounded(options.verifyCurrent, signal); signal.throwIfAborted();
  validateCheckoutReadiness(ready, head, now()); validateManifest(manifest, head, now());
  original('normal-preparation.intent.json', { protocol: 1, operationId: manifest.operationId, actorId: manifest.actorId,
   manifestDigest: digest(manifest), maximumAmountCents: 1500, paymentAccepted: false, retryAllowed: false });
  // UiCheckoutPreparation durably consumes the original SQLite budget before POST.
  // Do not race this mutation against an artificial timeout and then repeat it.
  await options.preparation.prepare(options.session, manifest.actorId, step);
  signal.throwIfAborted(); guard(options.preparation.state(manifest.operationId) === 'prepared');
  original('normal-preparation.result.json', { protocol: 1, operationId: manifest.operationId, state: 'prepared', paymentAccepted: false, retryAllowed: false });
  await bounded(options.verifyCurrent, signal); signal.throwIfAborted();
  // If an interrupted factory resolves later, close its reader instead of leaking authority.
  reader = await bounded(async () => { const value = await options.createOwnedReader(manifest);
   if (signal.aborted) { value.close(); signal.throwIfAborted(); } return value; }, signal);
  const opening: Proof = await bounded(() => reader!.read('open', signal), signal);
  validateProof(opening, manifest, 'open', now());
  const raw = { manifest, member: { id: options.account.id, userId: options.account.userId,
   email: options.account.email, password: options.account.password }, stagingBypass: options.stagingBypass, proof: opening };
  validateInput(raw, head, now()); input = encryptInput(raw, key, head, now());
  guard(digest(decryptInput(input, key, head, now())) === digest(validateInput(raw, head, now())));
  const name = assetName(manifest, 'input'), ciphertextDigest = hash(input);
  original(name, input);
  await bounded(options.verifyCurrent, signal); signal.throwIfAborted(); validateProof(opening, manifest, 'open', now());
  const unchanged = () => { const saved = readBootstrapOriginal(join(directory, name));
   try { guard(hash(saved) === ciphertextDigest && hash(input!) === ciphertextDigest); } finally { saved.fill(0); } };
  unchanged(); original('input-upload.intent.json', { protocol: 1, manifestDigest: digest(manifest), ciphertextDigest,
   maximumUploads: 1, paymentAccepted: false, retryAllowed: false });
  const retained = validateRetainedCheckoutAsset(await bounded(() => options.draft.upload('input', input!, signal), signal));
  unchanged(); validateProof(opening, manifest, 'open', now());
  guard(retained.phase === 'input' && retained.name === name && retained.ciphertextDigest === ciphertextDigest && retained.size === input.length &&
   retained.releaseId === manifest.releaseId && retained.jobId === manifest.job.id && retained.jobNonce === manifest.job.nonce &&
   retained.headSha === head && now() - Date.parse(retained.observedAt) >= -5000 && now() - Date.parse(retained.observedAt) <= 30000);
  original('input-upload.result.json', retained);
  const activeReader = reader; reader = undefined;
  return { manifest, opening, reader: activeReader, privateInputRetained: true, independentAcceptanceRequired: true,
   paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); }
 finally { key?.fill(0); input?.fill(0); reader?.close(); }
}
