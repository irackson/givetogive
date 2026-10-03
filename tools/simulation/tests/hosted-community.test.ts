import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { approved, assertDraft, containedPath, inputPaths, repository, sha256, trustedExecution, validateManifest, type HostedManifest } from '../src/hosted-community-policy.ts';
import { encryptionKey, fileBytes, privateFile, seal, unseal, validateFiles } from '../src/hosted-community-bundle.ts';
import { gracefulShutdown, inspectJournals, requireAdmission, runtimeEnvironment, transportCredentials, validateInput } from '../src/hosted-community.ts';
import { makeCredentials } from '../src/provisioning.ts';
import { browserAccounts, validateCommunity } from '../src/community-config.ts';
import { PrivateDraft } from '../src/hosted-community-github.ts';
import { HostedAttention, HostedTelemetryAttention, linuxProcessIdentity } from '../src/hosted-community-attention.ts';

const runId = 'c7a35c2e-8c48-4acd-99c7-9abc3d9bb998', headSha = 'a'.repeat(40);
function fixture() {
 const { credentials } = validateCommunity(transportCredentials(makeCredentials({ id: runId, mode: 'scripted', agent_count: 5 }, approved.origin, approved.databaseIdentity)), {});
 // makeCredentials emits legacy tokenId fields only fixtureIds? credentials schema strips those.
 const source = credentials.agents.map((agent, index) => JSON.stringify({ id: `browse-${index}`, user: agent.id, action: 'browse', path: '/asks', everySeconds: 45 })).join('\n');
 const manifest: HostedManifest = { protocolVersion: 1, mode: 'authenticated-smoke', runId, headSha, releaseId: 123,
  stateDirectory: '.state/community-hosted-smoke-test', population: 5, durationSeconds: 300,
  sourceDigest: sha256(source), programDigest: sha256(JSON.stringify({ source, browserIds: browserAccounts(credentials, 3).map(agent => agent.id), origin: credentials.origin, databaseIdentity: credentials.databaseIdentity })),
  actionJournalId: '11111111-1111-4111-8111-111111111111', telemetryJournalId: '22222222-2222-4222-8222-222222222222',
  runnerDigest: approved.runnerDigest, setupDigest: approved.setupDigest, seedDigest: approved.seedDigest, simulationLockDigest: 'b'.repeat(64),
  release: { observedAt: new Date().toISOString(), deploymentId: approved.deploymentId, authoredSourceDigest: approved.authoredSourceDigest,
   lockDigest: approved.lockDigest, canonical: true, protected: true, ready: true, independentReadinessPassed: true, noOtherControllers: true,
   noMemberTokens: true,
   cloudBrowserSmokePassed: false, authenticatedSmokePassed: false } };
 const files = inputPaths(manifest).map(name => privateFile(name, Buffer.from(name.endsWith('credentials.json') ? JSON.stringify(credentials)
  : name.endsWith('activity.jsonl') ? source : name.endsWith('protection.json') ? JSON.stringify({ vercelProtectionBypass: 'SYNTHETIC_PRIVATE_TEST_BYPASS' }) : 'fixture-only-not-a-real-database')));
 return { manifest, credentials, source, files, bundle: { purpose: 'fresh-input', manifest, files } };
}
test('AES-256-GCM authenticates fresh nonces, tamper/header/tag/key and no plaintext envelope', () => {
 const key = randomBytes(32), sentinel = { password: 'PRIVATE_TEST_SENTINEL', journal: 'fixture' };
 const a = seal(sentinel, key), b = seal(sentinel, key);
 assert.ok(!a.equals(b)); assert.ok(!a.includes(Buffer.from('PRIVATE_TEST_SENTINEL')));
 assert.deepEqual(unseal(a, key), sentinel);
 for (const index of [0, 8, 20, a.length - 1]) { const damaged = Buffer.from(a); damaged[index] ^= 1; assert.throws(() => unseal(damaged, key)); }
 assert.throws(() => unseal(a, randomBytes(32)));
 assert.throws(() => encryptionKey('short')); assert.throws(() => encryptionKey('Z'.repeat(64)));
});
test('private payload permits only exact run-scoped input files, rejects traversal/extra/duplicates/digest corruption', () => {
 const { manifest, files } = fixture();
 assert.equal(validateFiles(files, inputPaths(manifest)).length, 5);
 for (const changed of [[...files, privateFile('.env.local', Buffer.from('secret'))], [files[0], ...files.slice(0, -1)],
  [{ ...files[0], name: '../escape' }, ...files.slice(1)], [{ ...files[0], digest: '0'.repeat(64) }, ...files.slice(1)]])
  assert.throws(() => validateFiles(changed, inputPaths(manifest)));
 assert.throws(() => fileBytes({ ...files[0]!, bytes: 'not-base64!' }));
 assert.throws(() => containedPath('/workspace', '../workspace-evil/key'));
});
test('fresh full-hour binding is exact; smoke cannot consume the prepared journal; stale operator evidence is rejected', () => {
 const { manifest } = fixture(); assert.equal(validateManifest(manifest).population, 5);
 for (const patch of [{ runId: approved.runId }, { population: 253 }, { durationSeconds: 4500 }, { stateDirectory: approved.stateDirectory },
  { runnerDigest: '0'.repeat(64) }, { release: { ...manifest.release, observedAt: '2020-01-01T00:00:00.000Z' } }])
  assert.throws(() => validateManifest({ ...manifest, ...patch }));
 const full = { ...manifest, ...approved, mode: 'full-hour', population: 253, durationSeconds: 4500 };
 // approved adds fields not accepted by strict schema; construct exact intentional manifest.
 const exact = { ...manifest, mode: 'full-hour', runId: approved.runId, stateDirectory: approved.stateDirectory, population: 253,
  durationSeconds: 4500, sourceDigest: approved.sourceDigest, programDigest: approved.programDigest,
  actionJournalId: approved.actionJournalId, telemetryJournalId: approved.telemetryJournalId,
  release: { ...manifest.release, cloudBrowserSmokePassed: true, authenticatedSmokePassed: true } };
 assert.equal(validateManifest(exact).runId, approved.runId);
 assert.throws(() => validateManifest(full));
 assert.throws(() => validateManifest({ ...exact, release: { ...exact.release, authenticatedSmokePassed: false } }));
});
test('trusted execution rejects fork/PR/branch/actor/mismatched SHA and every automatic rerun', () => {
 const env = { GITHUB_REPOSITORY: repository, GITHUB_ACTOR: 'irackson', GITHUB_TRIGGERING_ACTOR: 'irackson',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: headSha, COMMUNITY_EXPECTED_SHA: headSha,
  RUNNER_OS: 'Linux', GITHUB_RUN_ATTEMPT: '1' };
 assert.doesNotThrow(() => trustedExecution(env, 'browser-smoke'));
 for (const patch of [{ GITHUB_REPOSITORY: 'fork/repo' }, { GITHUB_ACTOR: 'other' }, { GITHUB_TRIGGERING_ACTOR: 'other' },
  { GITHUB_REF: 'refs/heads/other' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_SHA: 'b'.repeat(40) }, { RUNNER_OS: 'Windows' }])
  assert.throws(() => trustedExecution({ ...env, ...patch }, 'full-hour'));
});
test('cancellation or recovery failure BEFORE child spawn prevents admission; expiry is rechecked', () => {
 const { manifest } = fixture(); assert.doesNotThrow(() => requireAdmission(manifest, false, false));
 assert.throws(() => requireAdmission(manifest, true, false)); assert.throws(() => requireAdmission(manifest, false, true));
 assert.throws(() => requireAdmission(manifest, false, false, Date.now() + 301000));
});
test('repeated cancellation/upload failures request exactly one graceful child drain', () => {
 let signals = 0; const stop = gracefulShutdown(() => { signals++; });
 stop(); stop(); stop(); assert.equal(signals, 1);
});
test('member/supervisor child environment never receives GitHub, encryption, database, Stripe, admin or cache injection', () => {
 const { manifest } = fixture();
 const env = runtimeEnvironment(manifest, { PATH: '/usr/bin', COMMUNITY_RECOVERY_TOKEN: 'PRIVATE_TEST_SENTINEL', COMMUNITY_BUNDLE_KEY: 'PRIVATE_TEST_SENTINEL',
  DATABASE_URL: 'PRIVATE_TEST_SENTINEL', STRIPE_SECRET_KEY: 'PRIVATE_TEST_SENTINEL', NODE_OPTIONS: '--inspect', PLAYWRIGHT_BROWSERS_PATH: '/custom', ADMIN_STORAGE: 'PRIVATE_TEST_SENTINEL' });
 assert.ok(!JSON.stringify(env).includes('PRIVATE_TEST_SENTINEL')); assert.equal(env.SIM_DURATION_SECONDS, '300');
 for (const name of ['NODE_OPTIONS', 'PLAYWRIGHT_BROWSERS_PATH', 'COMMUNITY_BUNDLE_KEY', 'COMMUNITY_RECOVERY_TOKEN', 'ADMIN_STORAGE']) assert.ok(!(name in env));
});
test('input validates normal synthetic identities/program and denies provider extras/recovery-only payloads', () => {
 const { bundle, manifest, credentials, files } = fixture(); assert.equal(validateInput(bundle).credentials.agents.length, 5);
 const replaceCredentials = (value: unknown) => ({ ...bundle, files: [privateFile(`.state/runs/${manifest.runId}/credentials.json`, Buffer.from(JSON.stringify(value))), ...files.slice(1)] });
 assert.throws(() => validateInput(replaceCredentials({ ...credentials, STRIPE_SECRET_KEY: 'PRIVATE_TEST_SENTINEL' })));
 assert.throws(() => validateInput(replaceCredentials({ ...credentials, origin: 'https://givetogive.vercel.app' })));
 assert.throws(() => validateInput(replaceCredentials({ ...credentials, databaseIdentity: approved.databaseName })));
 assert.throws(() => validateInput(replaceCredentials({ ...credentials, agents: credentials.agents.map((agent, index) => index ? agent : { ...agent, userId: 'real-user' }) })));
 assert.throws(() => validateInput(replaceCredentials({ ...credentials, agents: credentials.agents.map(agent => ({ ...agent, token: 'LEGACY_UNUSED_TEST_PLACEHOLDER' })) })));
 assert.throws(() => validateInput({ ...bundle, purpose: 'recovery-only' }));
});
test('transport strips unused legacy placeholders without changing original credentials or member/control identity', () => {
 const original = makeCredentials({ id: runId, mode: 'scripted', agent_count: 5 }, approved.origin, approved.databaseIdentity), before = JSON.stringify(original);
 const copy = transportCredentials(original);
 assert.equal(JSON.stringify(original), before); assert.equal(copy.runnerToken, original.runnerToken);
 assert.ok(copy.agents.every((agent, index) => !('token' in agent) && agent.userId === original.agents[index]!.userId && agent.password === original.agents[index]!.password));
});
function releaseFixture(manifest: HostedManifest, assets: unknown[] = []) {
 return { id: manifest.releaseId, draft: true, published_at: null, target_commitish: manifest.headSha,
  tag_name: `community-acceptance-${manifest.runId}`, body: JSON.stringify({ protocolVersion: 1, repository, runId: manifest.runId, headSha: manifest.headSha }), assets };
}
test('draft retention rejects published, foreign head/run, wrong release, public anonymous access and existing ciphertext', async () => {
 const { manifest } = fixture(), release = releaseFixture(manifest);
 assert.equal(assertDraft(release, manifest).draft, true);
 for (const patch of [{ draft: false }, { target_commitish: 'main' }, { id: 456 }, { tag_name: 'public-release' }, { body: '{}' }])
  assert.throws(() => assertDraft({ ...release, ...patch }, manifest));
 const encrypted = seal({ fixture: true }, randomBytes(32)); let posts = 0;
 const request = (async (_url, init) => {
  if (init?.method === 'POST') posts++;
  return new Response(JSON.stringify(release), { status: 200 }); // Anonymous visibility deliberately unsafe.
 }) as typeof fetch;
 const draft = new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', request);
 await assert.rejects(draft.upload(`community-recovery-${manifest.runId}-123-1-final.g2genc`, encrypted)); assert.equal(posts, 0);
});
test('draft download checks digest/id continuity and never forwards authorization to CDN', async () => {
 const { manifest } = fixture(), encrypted = seal({ fixture: true }, randomBytes(32)); let cdnAuth = false;
 const asset = { id: 77, name: `community-input-${manifest.runId}.g2genc`, size: encrypted.length, digest: `sha256:${sha256(encrypted)}` };
 const release = releaseFixture(manifest, [asset]);
 const request = (async (raw, init) => {
  const url = String(raw), headers = init?.headers as Record<string, string> | undefined;
  if (!headers?.Authorization && url.startsWith('https://api.github.com/')) return new Response('', { status: 404 });
  if (url.startsWith('https://release-assets.githubusercontent.com/')) { cdnAuth = !!headers?.Authorization; return new Response(new Uint8Array(encrypted)); }
  if (url.endsWith('/assets/77')) return new Response('', { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/private-fixture' } });
  return Response.json(release);
 }) as typeof fetch;
 assert.deepEqual(await new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', request).input(), encrypted); assert.equal(cdnAuth, false);
 asset.digest = `sha256:${'0'.repeat(64)}`;
 await assert.rejects(new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', request).input());
});
test('private upload is exclusive and verifies exact resulting ID/digest; ambiguous writes are not retried', async () => {
 const { manifest } = fixture(), encrypted = seal({ fixture: true }, randomBytes(32));
 const name = `community-recovery-${manifest.runId}-123-1-final.g2genc`;
 const asset = { id: 88, name, size: encrypted.length, digest: `sha256:${sha256(encrypted)}` };
 const release = releaseFixture(manifest); let posts = 0;
 const request = (async (_url, init) => {
  const headers = init?.headers as Record<string, string>;
  if (!headers?.Authorization) return new Response('', { status: 404 });
  if (init?.method === 'POST') { posts++; release.assets = [asset]; return Response.json({ ...asset, state: 'uploaded' }, { status: 201 }); }
  return Response.json(release);
 }) as typeof fetch;
 const draft = new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', request);
 await draft.upload(name, encrypted); assert.equal(posts, 1);
 await assert.rejects(draft.upload(name, encrypted)); assert.equal(posts, 1);
 release.assets = [];
 const lostWrite = (async (_url, init) => {
  const headers = init?.headers as Record<string, string>;
  if (!headers?.Authorization) return new Response('', { status: 404 });
  if (init?.method === 'POST') { posts++; throw new Error('PRIVATE_TEST_SENTINEL_RESPONSE_LOSS'); }
  return Response.json(release);
 }) as typeof fetch;
 await assert.rejects(new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', lostWrite).upload(name, encrypted));
 assert.equal(posts, 2); // Exactly one POST attempt; no automatic retry after uncertain response.
});
test('read-only fresh journal inspection rejects pending intents, activity, ownership and foreign journal identity without rewriting', () => {
 const { manifest } = fixture(), directory = mkdtempSync(join(tmpdir(), 'g2g-hosted-unit-'));
 try {
  const action = new DatabaseSync(join(directory, 'activity.sqlite')), telemetry = new DatabaseSync(join(directory, 'community-telemetry.sqlite'));
  action.exec('CREATE TABLE programs(run_id,digest);CREATE TABLE journal_identity(run_id,id);CREATE TABLE steps(state);CREATE TABLE refs(x);CREATE TABLE account_control(x)');
  action.prepare('INSERT INTO programs VALUES (?,?)').run(manifest.runId, manifest.programDigest);
  action.prepare('INSERT INTO journal_identity VALUES (?,?)').run(manifest.runId, manifest.actionJournalId);
  telemetry.exec('CREATE TABLE metadata(run_id,key,value);CREATE TABLE events(delivered);CREATE TABLE controls(x);CREATE TABLE checkpoints(x)');
  telemetry.prepare('INSERT INTO metadata VALUES (?,?,?)').run(manifest.runId, 'journalId', manifest.telemetryJournalId);
  assert.equal(inspectJournals(directory, manifest, true).pending, 0);
  action.prepare('INSERT INTO steps VALUES (?)').run('pending');
  assert.throws(() => inspectJournals(directory, manifest, true));
  assert.equal(action.prepare('SELECT state FROM steps').get()!.state, 'pending');
  assert.equal(inspectJournals(directory, manifest, false).pending, 1);
  action.close(); telemetry.close();
 } finally { rmSync(directory, { recursive: true }); } // Only exact exclusively created unit temp directory.
});
test('private-input wait is bounded/read-only; no upload, input replacement, decrypt or admission during wait', async () => {
 const { manifest } = fixture(), release = releaseFixture(manifest); let clock = 0, milestones = 0, requests = 0;
 const request = (async (_url, init) => {
  requests++; assert.ok(!init?.method || init.method === 'GET');
  const headers = init?.headers as Record<string, string>;
  return headers.Authorization ? Response.json(release) : new Response('', { status: 404 });
 }) as typeof fetch;
 await assert.rejects(new PrivateDraft(manifest, 'TEST_TOKEN_NOT_REAL_12345', request).waitInput(() => milestones++, () => clock,
  async milliseconds => { clock += milliseconds; }));
 assert.equal(clock, 600000); assert.equal(milestones, 1); assert.equal(requests, 121);
});
test('bounded attention observer drains exactly once for owned halted actor and preserves all retry boundaries', () => {
 const categories: string[] = [], started: number[] = [];
 const observer = new HostedAttention(new Set(['owned']), new Set(['action']), category => categories.push(category), pid => started.push(pid));
 observer.feed(Buffer.from(JSON.stringify({ started: true, ownedProcessId: 123 }) + '\n'));
 observer.feed(Buffer.from(JSON.stringify({ user: 'other', line: 'action', outcome: 'paused' }) + '\n'));
 observer.feed(Buffer.from(JSON.stringify({ user: 'owned', line: 'action', outcome: 'observation_backoff' }) + '\n'));
 assert.deepEqual(categories, []); assert.deepEqual(started, [123]);
 const halted = Buffer.from(JSON.stringify({ user: 'owned', line: 'action', outcome: 'paused', password: 'PRIVATE_TEST_SENTINEL' }) + '\n');
 observer.feed(halted.subarray(0, 10)); observer.feed(halted.subarray(10)); observer.feed(halted);
 observer.exited(1, 1000, 4500);
 assert.deepEqual(categories, ['member_halted']); assert.ok(!JSON.stringify(categories).includes('PRIVATE_TEST_SENTINEL'));
});
test('unexpected supervisor exit and oversized/malformed streams fail incomplete without launching or replaying anything', () => {
 const categories: string[] = [];
 const observer = new HostedAttention(new Set(), new Set(), category => categories.push(category));
 observer.exited(0, 300000, 300); assert.deepEqual(categories, []);
 observer.exited(0, 299999, 300); observer.exited(1, 300000, 300);
 assert.deepEqual(categories, ['supervisor_exited']);
 const oversized: string[] = []; new HostedAttention(new Set(), new Set(), category => oversized.push(category)).feed(Buffer.alloc(65537));
 assert.deepEqual(oversized, ['invalid_supervision_record']);
 const malformed: string[] = []; new HostedAttention(new Set(), new Set(), category => malformed.push(category)).feed(Buffer.from('not-json\n'));
 assert.deepEqual(malformed, ['invalid_supervision_record']);
});
test('kernel PID identity binds exact parent/start ticks and rejects PID reuse/malformed process data', () => {
 const fields = ['S', '456', ...Array(17).fill('0'), '789', '0'];
 const identity = linuxProcessIdentity(`123 (node) ${fields.join(' ')}`, 123);
 assert.deepEqual(identity, { pid: 123, parentPid: 456, startTicks: '789', state: 'S' });
 assert.throws(() => linuxProcessIdentity(`124 (node) ${fields.join(' ')}`, 123));
 assert.throws(() => linuxProcessIdentity('PRIVATE_TEST_SENTINEL', 123));
});
test('stdout pending-intent state paused halts exact actor/line even without an outcome field', () => {
 const categories: string[] = [], observer = new HostedAttention(new Set(['owned']), new Set(['action']), category => categories.push(category));
 observer.feed(Buffer.from(JSON.stringify({ user: 'owned', line: 'action', state: 'paused' }) + '\n'));
 observer.feed(Buffer.from(JSON.stringify({ user: 'owned', line: 'action', state: 'paused' }) + '\n'));
 assert.deepEqual(categories, ['member_halted']);
});
test('actual paused telemetry catches halted auth rejections but not normal400/409 conflicts or observation backoff', () => {
 const categories: string[] = [], observer = new HostedTelemetryAttention(new Set(['owned']), category => categories.push(category));
 const row = (sequence: number, event: unknown) => ({ sequence, body: JSON.stringify(event) });
 observer.feed([row(1, { agentId: 'owned', kind: 'action_result', state: 'backing_off', data: { outcome: 'rejected', httpStatus: 400 } }),
  row(2, { agentId: 'owned', kind: 'action_result', state: 'backing_off', data: { outcome: 'rejected', httpStatus: 409 } }),
  row(3, { agentId: 'owned', kind: 'action_result', state: 'backing_off', data: { outcome: 'observation_backoff' } }),
  row(4, { agentId: 'other', kind: 'action_result', state: 'paused', data: { outcome: 'rejected', httpStatus: 401 } })]);
 assert.deepEqual(categories, []);
 observer.feed([row(5, { agentId: 'owned', kind: 'action_result', state: 'paused', data: { outcome: 'rejected', httpStatus: 403 }, summary: 'PRIVATE_TEST_SENTINEL' })]);
 observer.feed([row(6, { agentId: 'owned', kind: 'action_result', state: 'paused' })]);
 assert.deepEqual(categories, ['member_halted']); assert.ok(!JSON.stringify(categories).includes('PRIVATE_TEST_SENTINEL'));
});
test('telemetry attention bounds row/body/sequence inputs and its SQLite poll is SELECT-only', () => {
 const directory = mkdtempSync(join(tmpdir(), 'g2g-attention-unit-')), path = join(directory, 'telemetry.sqlite');
 try {
  const db = new DatabaseSync(path); db.exec('CREATE TABLE events(sequence INTEGER,run_id TEXT,body TEXT)');
  db.prepare('INSERT INTO events VALUES (?,?,?)').run(1, runId, JSON.stringify({ agentId: 'owned', kind: 'action_result', state: 'paused' }));
  const categories: string[] = [], observer = new HostedTelemetryAttention(new Set(['owned']), category => categories.push(category));
  observer.poll(path, runId); observer.poll(path, runId);
  assert.deepEqual(categories, ['member_halted']); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n, 1); db.close();
  for (const rows of [[{ sequence: 0, body: '{}' }], [{ sequence: 1, body: 'x'.repeat(65537) }], Array(101).fill({ sequence: 1, body: '{}' })]) {
   const invalid: string[] = []; new HostedTelemetryAttention(new Set(), category => invalid.push(category)).feed(rows);
   assert.deepEqual(invalid, ['invalid_telemetry_record']);
  }
 } finally { rmSync(directory, { recursive: true }); }
});
test('terminal incomplete JSONL tail cannot pass normal-duration supervisor exit', () => {
 const categories: string[] = [], observer = new HostedAttention(new Set(), new Set(), category => categories.push(category));
 observer.feed(Buffer.from('{"unfinished":')); observer.exited(0, 300000, 300);
 assert.deepEqual(categories, ['invalid_supervision_record']);
});
