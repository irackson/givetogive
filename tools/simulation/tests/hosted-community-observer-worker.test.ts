import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readObserverInput } from '../src/hosted-community-observer-worker.ts';
import { approved } from '../src/hosted-community-policy.ts';
import { fixtureIds } from '../src/provisioning.ts';

const controllerId = '12345678-1234-1234-1234-123456789abc';
function envelope() {
 const input = { protocolVersion: 1, runId: approved.runId, origin: approved.origin,
  databaseIdentity: approved.databaseIdentity, headSha: '2'.repeat(40),
  authoredSourceDigest: approved.authoredSourceDigest, gitAuthoredSourceDigest: approved.gitAuthoredSourceDigest,
  lockDigest: approved.lockDigest, runnerDigest: approved.runnerDigest, seedDigest: approved.seedDigest,
  simulationLockDigest: '4'.repeat(64), stateDirectory: approved.stateDirectory,
  programDigest: approved.programDigest, actionJournalId: approved.actionJournalId,
  telemetryJournalId: approved.telemetryJournalId,
  admin: { id: 'public-admin', userId: 'public-admin', email: 'observer@givetogive.invalid',
   password: 'public-offline-password-123' }, protectionBypass: 'public-offline-protection-123',
  cohort: Array.from({ length: 253 }, (__unused, index) => {
   const { id, userId } = fixtureIds(approved.runId, index); return { id, userId };
  }), rootProof: { observedAt: new Date().toISOString(), deploymentId: approved.deploymentId,
   controllerId, adminUserId: 'public-admin', verifiedSynthetic: true, active: true, emailVerified: true,
   existingAdmin: true, transferAuthorized: true, canonical: true, protected: true, ready: true,
   noProviderSecrets: true } };
 return { input, outputName: `.state/runs/${approved.runId}/observer-${controllerId}` };
}
const signal = () => new AbortController().signal;
const redacted = (error: unknown) => {
 assert.ok(error instanceof Error); assert.equal(error.message, 'Observer input unavailable');
 assert.equal(error.cause, undefined); return true;
};
const erased = (bytes: Buffer) => assert.ok(bytes.every((byte) => byte === 0));
function chunks(parts: Buffer[], finish?: () => void): AsyncIterable<Buffer> {
 return { async *[Symbol.asyncIterator]() { yield* parts; finish?.(); } };
}

test('valid split input returns the exact reviewed envelope and erases all owned chunks', async () => {
 const value = envelope(); const bytes = Buffer.from(JSON.stringify(value));
 const parts = [bytes.subarray(0, 11), bytes.subarray(11, 103), bytes.subarray(103)];
 assert.deepEqual(await readObserverInput(chunks(parts), signal()), value);
 erased(bytes);
});

test('pre-aborted parent refuses iterator acquisition and does not start runtime work', async () => {
 const cancellation = new AbortController(); cancellation.abort('public-offline-reason'); let acquired = false;
 await assert.rejects(readObserverInput({ [Symbol.asyncIterator]() { acquired = true; throw new Error('unused'); } },
  cancellation.signal), redacted);
 assert.equal(acquired, false);
});

test('parent cancellation closes only owned input and clears partial and late buffers', async () => {
 const cancellation = new AbortController(); const first = Buffer.from('public-offline-partial');
 const late = Buffer.from('public-offline-late'); let deliver: ((part: IteratorResult<Buffer>) => void) | undefined;
 let calls = 0; let destroys = 0; let returns = 0;
 const stream = { destroy() { destroys++; }, [Symbol.asyncIterator]() { return {
  next: () => ++calls === 1 ? Promise.resolve({ done: false as const, value: first }) :
   new Promise<IteratorResult<Buffer>>((finish) => { deliver = finish; }),
  return: async () => { returns++; return { done: true as const, value: undefined }; },
 }; } };
 const result = readObserverInput(stream, cancellation.signal);
 await new Promise<void>((finish) => setImmediate(finish)); cancellation.abort();
 await assert.rejects(result, redacted); erased(first); assert.equal(destroys, 1); assert.equal(returns, 1);
 assert.ok(deliver); deliver({ done: false, value: late });
 await new Promise<void>((finish) => setImmediate(finish)); erased(late);
});

test('missing EOF reaches bounded input deadline and calls iterator return once', async () => {
 let returned = 0; const start = Date.now();
 const stream = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Buffer>>(() => {}),
  return: async () => { returned++; return { done: true as const, value: undefined }; } }; } };
 await assert.rejects(readObserverInput(stream, signal(), 15), redacted);
 assert.equal(returned, 1); assert.ok(Date.now() - start < 1500);
});

test('unresponsive iterator return cannot turn cancellation into an indefinite wait', async () => {
 const cancellation = new AbortController(); let returned = 0;
 const stream = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Buffer>>(() => {}),
  return: () => { returned++; return new Promise<IteratorResult<Buffer>>(() => {}); } }; } };
 const start = Date.now(); const result = readObserverInput(stream, cancellation.signal);
 cancellation.abort(); await assert.rejects(result, redacted);
 assert.equal(returned, 1); assert.ok(Date.now() - start < 2000);
});

test('oversize input erases previous and rejected chunks before failure', async () => {
 const first = Buffer.from('public-offline-prefix'); const oversized = Buffer.alloc(1024 * 1024 + 1, 65);
 await assert.rejects(readObserverInput(chunks([first, oversized]), signal()), redacted);
 erased(first); erased(oversized);
});

test('stream errors are redacted and clear accumulated buffers', async () => {
 const bytes = Buffer.from('public-offline-partial');
 const stream = { async *[Symbol.asyncIterator]() { yield bytes; throw new Error('public-offline-error-payload'); } };
 await assert.rejects(readObserverInput(stream, signal()), redacted); erased(bytes);
});

test('malformed JSON, extra envelope fields and invalid input all fail without payload errors', async () => {
 for (const payload of ['public-offline-malformed', JSON.stringify({ ...envelope(), unexpected: 'public-offline' }),
  JSON.stringify({ input: { invalid: 'public-offline' }, outputName: 'public-offline' })]) {
  const bytes = Buffer.from(payload);
  await assert.rejects(readObserverInput(chunks([bytes]), signal()), redacted); erased(bytes);
 }
});

test('abort at EOF is checked before validation or returning authenticated input', async () => {
 const cancellation = new AbortController(); const bytes = Buffer.from(JSON.stringify(envelope()));
 await assert.rejects(readObserverInput(chunks([bytes], () => cancellation.abort()), cancellation.signal), redacted);
 erased(bytes);
});

test('resolved-chunk cancellation microtask erases the in-flight buffer', async () => {
 const cancellation = new AbortController(); const bytes = Buffer.from('public-offline-inflight');
 const stream = { [Symbol.asyncIterator]() { return { next() {
  const part = Promise.resolve({ done: false as const, value: bytes });
  queueMicrotask(() => cancellation.abort()); return part;
 } }; } };
 await assert.rejects(readObserverInput(stream, cancellation.signal), redacted); erased(bytes);
});

test('test deadlines can only shorten the fixed thirty-second production bound', async () => {
 for (const timeout of [0, -1, 30001, NaN, Infinity, 1.5])
  await assert.rejects(readObserverInput(chunks([]), signal(), timeout));
});

test('native import is inert with no browser, network, stdin read or provider environment access', () => {
 const moduleUrl = new URL('../src/hosted-community-observer-worker.ts', import.meta.url).href;
 const code = `globalThis.fetch = () => { throw new Error('unexpected offline network'); };
 const {default:process}=await import('node:process');
 process.stdin[Symbol.asyncIterator]=()=>{throw new Error('unexpected stdin');};
 for(const name of ['COMMUNITY_RECOVERY_TOKEN','COMMUNITY_BUNDLE_KEY','DATABASE_URL','STRIPE_SECRET_KEY','SIM_CREDENTIALS'])
  Object.defineProperty(process.env,name,{value:'public-offline-denied',writable:true,enumerable:true,configurable:true});
 await import(${JSON.stringify(moduleUrl)});`;
 const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env: { PATH: process.env.PATH ?? '' },
  encoding: 'utf8', timeout: 10000,
 });
 assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
