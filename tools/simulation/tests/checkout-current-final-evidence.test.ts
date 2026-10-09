// Public fabricated receipts + real hash/codec validation. Not native closure,
// job/provider/webhook or payment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCurrentFinalEvidence } from '../src/checkout-current-final-evidence.ts';
import { privateFile, seal, unseal } from '../src/hosted-community-bundle.ts';
import { currentInput } from './fixtures/current-checkout.ts';
function fixture(notice = false) {
 const input = currentInput(), p = input.profile, connection = 'd'.repeat(32);
 const parent = `current-checkout-${p.runId}-${p.operationId}/`, exchange = `current-checkout-exchange-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}/`;
 const worker = { protocol: 1, purpose: 'current-member-receipt', phase: 'submitted-pending-independent-verification', failed: false,
  executionEvidence: 'native-playwright-adapter', memberSignIns: 1, noticeRequests: notice ? 1 : 0, submitAttempts: 1, apiDisposed: true, driverClosed: true,
  independentJobOsProviderLedgerVerificationRequired: true, privateDetailsWithheld: true, paymentAccepted: false, retryAllowed: false };
 const receipt = { protocol: 1, purpose: 'current-checkout-parent', failed: false, executionEvidence: 'native-linux-parent', worker,
  cleanup: { ownedGroupClosed: true, exitObserved: true, exitCode: 0, publicOutputBytes: 0, escapedDescendantObserved: false, paymentAccepted: false, retryAllowed: false },
  independentRootProviderLedgerReviewRequired: true, privateFinalRetentionStillRequired: true, paymentAccepted: false, retryAllowed: false };
 const files: ReturnType<typeof privateFile>[] = [];
 const add = (name: string, raw: unknown) => files.push(privateFile(name, Buffer.from(JSON.stringify(raw))));
 add('bootstrap-lease.json', { profile: p, releaseId: 42, maximumMemberLaunches: 1, financialAdmission: false, paymentAccepted: false, retryAllowed: false });
 for (const name of ['readiness-publication.intent.json', 'readiness-publication.result.json', 'association-wait.intent.json',
  'association-wait.result.json', 'input-download.intent.json']) add(name, { publicFixture: true });
 const original = privateFile('original-input.g2genc', Buffer.alloc(48, 3)); files.push(original);
 add('bootstrap-result.json', { protocol: 1, failed: false, parent: receipt, independentClosureAndSettlementRequired: true, paymentAccepted: false, retryAllowed: false });
 add(parent + 'worker-receipt.json', worker); add(parent + 'parent-receipt.json', receipt);
 add(parent + 'launch-lease.json', { profileDigest: input.profileDigest, head: p.job.headSha, source: p.source,
  maximumMemberLaunches: 1, paymentAccepted: false, retryAllowed: false });
 add(parent + 'browser-readiness.json', { ready: { protocol: 1, purpose: 'current-member-browser-ready', connectionNonce: connection,
  profileDigest: input.profileDigest, freeBytes: 4 * 1024 ** 3, browserConnected: true, memberSignIns: 0,
  paymentAccepted: false, retryAllowed: false, executionEvidence: 'native-playwright-adapter' }, parentEvidence: 'native-linux-parent',
  browserExecutableObserved: true, liveGitHubRootReviewStillRequired: true, paymentAccepted: false });
 add(parent + 'input-transfer-intent.json', { profileDigest: input.profileDigest, connectionNonce: connection,
  privateInputRetained: false, paymentAccepted: false, retryAllowed: false });
 add(exchange + 'exchange-lease.json', { profileDigest: input.profileDigest, connectionNonce: connection, paymentAccepted: false, retryAllowed: false });
 for (const phase of ['opening', 'fixture', ...(notice ? ['notice'] : []), 'submission']) {
  const response = privateFile(`${exchange}${phase}-response.g2genc`, Buffer.alloc(48, 4)); files.push(response);
  files.push(privateFile(`${exchange}${phase}-request.g2genc`, Buffer.alloc(48, 5)));
  add(`${exchange}${phase}-upload-intent.json`, { publicFixture: true }); add(`${exchange}${phase}-upload-result.json`, { publicFixture: true });
  add(`${exchange}${phase}-accepted.json`, { requestDigest: 'a'.repeat(64), responseDigest: response.digest, phase,
   financialAuthorityStillRequiresRootAdmission: true, paymentAccepted: false, retryAllowed: false });
 }
 const raw = { protocol: 1, purpose: 'current-checkout-native-originals', profileDigest: input.profileDigest,
  binding: { releaseId: 42, operationId: p.operationId, job: { id: p.job.jobId, nonce: p.job.jobNonce, headSha: p.job.headSha } }, files,
  excludedMemberRuntimeDirectories: true, independentClosureAndSettlementRequired: true, paymentAccepted: false, retryAllowed: false };
 const expected = { profile: p, connectionNonce: connection, inputProfileDigest: input.profileDigest, inputCiphertextDigest: original.digest, releaseId: 42 };
 const change = (name: string, mutate: (raw: Record<string, unknown>) => void) => {
  const index = files.findIndex(file => file.name === name), decoded = JSON.parse(Buffer.from(files[index]!.bytes, 'base64').toString());
  mutate(decoded); files[index] = privateFile(name, Buffer.from(JSON.stringify(decoded)));
 };
 return { raw, expected, parent, exchange, change };
}
for (const notice of [false, true]) test(`valid bound original inventory, optional notice ${notice}, still not payment acceptance`, () => {
 const f = fixture(notice), key = Buffer.alloc(32, 7), bytes = seal(f.raw, key);
 const result = validateCurrentFinalEvidence(unseal(bytes, key), f.expected);
 assert.equal(result.recordedNativeClosureValidated, true); assert.equal(result.paymentAccepted, false);
 assert.equal(result.independentJobProviderWebhookLedgerReviewRequired, true); assert.equal(result.noticeRequests, notice ? 1 : 0);
 bytes.fill(0); key.fill(0);
});
test('unknown, duplicate, missing and altered original files reject', () => {
 for (const mode of ['unknown', 'duplicate', 'missing', 'digest', 'input']) {
  const f = fixture();
  if (mode === 'unknown') f.raw.files.push(privateFile('../private-member-home', Buffer.from('fixture')));
  if (mode === 'duplicate') f.raw.files.push({ ...f.raw.files[0]! });
  if (mode === 'missing') f.raw.files.splice(1, 1);
  if (mode === 'digest') f.raw.files[0]!.digest = '0'.repeat(64);
  if (mode === 'input') f.expected.inputCiphertextDigest = '0'.repeat(64);
  assert.throws(() => validateCurrentFinalEvidence(f.raw, f.expected));
 }
});
test('foreign bindings, failed/injected receipts and unfinished native cleanup reject', () => {
 for (const mode of ['nonce', 'profile', 'failed', 'injected', 'output', 'escaped', 'exit']) {
  const f = fixture();
  if (mode === 'nonce') f.raw.binding.job.nonce = 'e'.repeat(32);
  if (mode === 'profile') f.raw.profileDigest = 'e'.repeat(64);
  if (mode === 'failed') f.change(f.parent + 'worker-receipt.json', raw => { raw.failed = true; });
  if (mode === 'injected') f.change(f.parent + 'worker-receipt.json', raw => { raw.executionEvidence = 'injected-offline'; });
  if (['output', 'escaped', 'exit'].includes(mode)) f.change(f.parent + 'parent-receipt.json', raw => {
   const cleanup = raw.cleanup as Record<string, unknown>; cleanup[mode === 'output' ? 'publicOutputBytes' : mode === 'escaped' ? 'escapedDescendantObserved' : 'exitObserved'] = mode === 'output' ? 1 : mode === 'escaped';
  });
  assert.throws(() => validateCurrentFinalEvidence(f.raw, f.expected));
 }
});
test('partial notice and altered accepted-response digest reject', () => {
 const f = fixture(true); f.raw.files = f.raw.files.filter(file => file.name !== f.exchange + 'notice-request.g2genc');
 assert.throws(() => validateCurrentFinalEvidence(f.raw, f.expected));
 const g = fixture(); g.change(g.exchange + 'submission-accepted.json', raw => { raw.responseDigest = 'e'.repeat(64); });
 assert.throws(() => validateCurrentFinalEvidence(g.raw, g.expected));
});
