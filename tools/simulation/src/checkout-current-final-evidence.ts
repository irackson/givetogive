/** Pure validation of decrypted authenticated originals. Does not authenticate
 * raw JSON, contact providers/jobs, mutate journals or prove financial outcome.
 * Caller must decrypt actual retained ciphertext and independently reconcile. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fileBytes } from './hosted-community-bundle.ts';
import { currentProfileDigest } from './checkout-current-phase.ts';
import type { CurrentCheckoutProfile } from './checkout-current-profile.ts';
import { checkMemory } from './hosted-checkout-policy.ts';
const sha = z.string().regex(/^[a-f0-9]{64}$/), hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (): never => { throw Error('Current final originals rejected; evidence retained; no financial acceptance.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const workerSchema = z.object({ protocol: z.literal(1), purpose: z.literal('current-member-receipt'),
 phase: z.literal('submitted-pending-independent-verification'), failed: z.literal(false),
 executionEvidence: z.literal('native-playwright-adapter'), memberSignIns: z.literal(1), noticeRequests: z.number().int().min(0).max(1),
 submitAttempts: z.literal(1), apiDisposed: z.literal(true), driverClosed: z.literal(true),
 independentJobOsProviderLedgerVerificationRequired: z.literal(true), privateDetailsWithheld: z.literal(true),
 paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict();
const parentSchema = z.object({ protocol: z.literal(1), purpose: z.literal('current-checkout-parent'), failed: z.literal(false),
 executionEvidence: z.literal('native-linux-parent'), worker: workerSchema, cleanup: z.object({ ownedGroupClosed: z.literal(true),
 exitObserved: z.literal(true), exitCode: z.literal(0), publicOutputBytes: z.literal(0), escapedDescendantObserved: z.literal(false),
 paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict(), independentRootProviderLedgerReviewRequired: z.literal(true),
 privateFinalRetentionStillRequired: z.literal(true), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict();
export function validateCurrentFinalEvidence(raw: unknown, expected: {
 profile: Readonly<CurrentCheckoutProfile>; connectionNonce: string; inputProfileDigest: string; inputCiphertextDigest: string; releaseId: number;
}) {
 const buffers = new Map<string, Buffer>();
 try {
  const p = expected.profile, initialDigest = currentProfileDigest(p);
  sha.parse(expected.inputProfileDigest); sha.parse(expected.inputCiphertextDigest);
  guard(/^[a-f0-9]{32}$/.test(expected.connectionNonce) && Number.isSafeInteger(expected.releaseId) && expected.releaseId > 0);
  const value = z.object({ protocol: z.literal(1), purpose: z.literal('current-checkout-native-originals'), profileDigest: z.literal(initialDigest),
   binding: z.object({ releaseId: z.literal(expected.releaseId), operationId: z.literal(p.operationId), job: z.object({
    id: z.literal(p.job.jobId), nonce: z.literal(p.job.jobNonce), headSha: z.literal(p.job.headSha) }).strict() }).strict(),
   files: z.array(z.object({ name: z.string().max(256), digest: sha, bytes: z.string().max(90000) }).strict()).min(1).max(64),
   excludedMemberRuntimeDirectories: z.literal(true), independentClosureAndSettlementRequired: z.literal(true),
   paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(raw);
  const parent = `current-checkout-${p.runId}-${p.operationId}/`, exchange = `current-checkout-exchange-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}/`;
  const base = ['bootstrap-lease.json', 'readiness-publication.intent.json', 'readiness-publication.result.json',
   'association-wait.intent.json', 'association-wait.result.json', 'input-download.intent.json', 'original-input.g2genc', 'bootstrap-result.json'];
  const parentNames = ['launch-lease.json', 'browser-readiness.json', 'input-transfer-intent.json', 'worker-receipt.json', 'parent-receipt.json'].map(name => parent + name);
  const phaseNames = (phase: string) => ['request.g2genc', 'response.g2genc', 'upload-intent.json', 'upload-result.json', 'accepted.json'].map(name => `${exchange}${phase}-${name}`);
  const required = [...base, ...parentNames, exchange + 'exchange-lease.json', ...['opening', 'fixture', 'submission'].flatMap(phaseNames)];
  const allowed = new Set([...required, ...phaseNames('notice')]); let total = 0;
  for (const file of value.files) {
   guard(allowed.has(file.name) && !buffers.has(file.name)); const bytes = fileBytes(file); buffers.set(file.name, bytes);
   total += bytes.length; guard(bytes.length <= 65536 && total <= 2097152);
   if (file.name.endsWith('.g2genc')) guard(bytes.length > 36);
  }
  guard(required.every(name => buffers.has(name)) && hash(buffers.get('original-input.g2genc')!) === expected.inputCiphertextDigest);
  const json = (name: string): unknown => JSON.parse(buffers.get(name)!.toString());
  const lease = z.object({ profile: z.unknown(), releaseId: z.literal(expected.releaseId), maximumMemberLaunches: z.literal(1),
   financialAdmission: z.literal(false), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json('bootstrap-lease.json'));
  guard(currentProfileDigest(lease.profile as CurrentCheckoutProfile) === initialDigest);
  const launch = z.object({ profileDigest: z.literal(initialDigest), head: z.literal(p.job.headSha), source: z.unknown(),
   maximumMemberLaunches: z.literal(1), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json(parent + 'launch-lease.json'));
  guard(JSON.stringify(launch.source) === JSON.stringify(p.source));
  const browser = z.object({ ready: z.object({ protocol: z.literal(1), purpose: z.literal('current-member-browser-ready'),
   connectionNonce: z.literal(expected.connectionNonce), profileDigest: z.literal(initialDigest), freeBytes: z.number().finite(),
   browserConnected: z.literal(true), memberSignIns: z.literal(0), paymentAccepted: z.literal(false), retryAllowed: z.literal(false),
   executionEvidence: z.literal('native-playwright-adapter') }).strict(), parentEvidence: z.literal('native-linux-parent'),
   browserExecutableObserved: z.literal(true), liveGitHubRootReviewStillRequired: z.literal(true), paymentAccepted: z.literal(false) }).strict()
   .parse(json(parent + 'browser-readiness.json'));
  checkMemory(browser.ready.freeBytes, false);
  const recordedParent = parentSchema.parse(json(parent + 'parent-receipt.json')), worker = workerSchema.parse(json(parent + 'worker-receipt.json'));
  guard(JSON.stringify(recordedParent.worker) === JSON.stringify(worker));
  const bootstrap = z.object({ protocol: z.literal(1), failed: z.literal(false), parent: parentSchema,
   independentClosureAndSettlementRequired: z.literal(true), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json('bootstrap-result.json'));
  guard(JSON.stringify(bootstrap.parent) === JSON.stringify(recordedParent));
  z.object({ profileDigest: z.literal(expected.inputProfileDigest), connectionNonce: z.literal(expected.connectionNonce),
   privateInputRetained: z.literal(false), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json(parent + 'input-transfer-intent.json'));
  z.object({ profileDigest: z.literal(expected.inputProfileDigest), connectionNonce: z.literal(expected.connectionNonce),
   paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json(exchange + 'exchange-lease.json'));
  const notices = phaseNames('notice').filter(name => buffers.has(name)); guard(notices.length === (worker.noticeRequests ? 5 : 0));
  for (const phase of ['opening', 'fixture', ...(worker.noticeRequests ? ['notice'] : []), 'submission']) {
   const accepted = z.object({ requestDigest: sha, responseDigest: sha, phase: z.literal(phase), financialAuthorityStillRequiresRootAdmission: z.literal(true),
    paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict().parse(json(`${exchange}${phase}-accepted.json`));
   guard(accepted.responseDigest === hash(buffers.get(`${exchange}${phase}-response.g2genc`)!));
  }
  return Object.freeze({ authenticatedOriginalBindingsValidated: true, recordedNativeClosureValidated: true, memberSignIns: 1, submitAttempts: 1,
   noticeRequests: worker.noticeRequests, filesValidated: buffers.size, independentJobProviderWebhookLedgerReviewRequired: true, paymentAccepted: false, retryAllowed: false });
 } catch { return fail(); }
 finally { for (const bytes of buffers.values()) bytes.fill(0); }
}
