import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrivateDraft } from '../src/hosted-community-github.ts';
import { approved, inputPaths, observerInputName, observerInputPolicy, repository, sha256, type HostedManifest } from '../src/hosted-community-policy.ts';
import { seal } from '../src/hosted-community-bundle.ts';

const start = Date.parse('2026-10-03T23:00:00.000Z'), job = '123456789', token = 'SYNTHETIC_OFFLINE_TOKEN_ONLY';
function fixture() {
 const manifest: HostedManifest = { protocolVersion: 1, mode: 'full-hour', runId: approved.runId, headSha: 'a'.repeat(40), releaseId: 123,
  stateDirectory: approved.stateDirectory, population: 253, durationSeconds: 4500, sourceDigest: approved.sourceDigest, programDigest: approved.programDigest,
  actionJournalId: approved.actionJournalId, telemetryJournalId: approved.telemetryJournalId, runnerDigest: approved.runnerDigest, setupDigest: approved.setupDigest,
  seedDigest: approved.seedDigest, simulationLockDigest: 'b'.repeat(64), release: { observedAt: new Date(start).toISOString(),
   deploymentId: approved.deploymentId, authoredSourceDigest: approved.authoredSourceDigest, lockDigest: approved.lockDigest, canonical: true,
   protected: true, ready: true, independentReadinessPassed: true, noOtherControllers: true, noMemberTokens: true,
   cloudBrowserSmokePassed: true, authenticatedSmokePassed: true } };
 const encrypted = seal({ purpose: 'observer-input', synthetic: true }, randomBytes(32));
 const asset = { id: 77, name: observerInputName(manifest, job), size: encrypted.length, digest: `sha256:${sha256(encrypted)}`,
  state: 'uploaded', created_at: new Date(start).toISOString() };
 const release = { id: manifest.releaseId, draft: true, published_at: null, target_commitish: manifest.headSha,
  tag_name: `community-acceptance-${manifest.runId}`, body: JSON.stringify({ protocolVersion: 1, repository, runId: manifest.runId, headSha: manifest.headSha }),
  assets: [asset] as Array<Record<string, unknown>> };
 const calls: Array<{ url: string; authorization: boolean; method: string; signal: AbortSignal | null | undefined }> = [];
 let metadata = 0, downloads = 0, milestones = 0, clock = start;
 const controller = new AbortController();
 const settings: { publicDraft?: boolean; publicAsset?: boolean; cdn?: string; missing?: boolean; replaceAt?: number;
  cancelMetadataAt?: number; cancelDownload?: boolean; corrupt?: boolean; oversized?: boolean; lostDownload?: boolean } = {};
 const request = (async (raw: URL | string | Request, init?: RequestInit) => {
  const url = String(raw), headers = new Headers(init?.headers), authorization = headers.has('Authorization');
  calls.push({ url, authorization, method: init?.method ?? 'GET', signal: init?.signal });
  if (!authorization && url.startsWith('https://api.github.com/'))
   return new Response('', { status: url.includes('/assets/') ? settings.publicAsset ? 200 : 404 : settings.publicDraft ? 200 : 404 });
  if (url.startsWith('https://release-assets.githubusercontent.com/')) return new Response(new Uint8Array(encrypted));
  if (url.endsWith('/assets/77')) {
   downloads++; if (settings.cancelDownload) controller.abort();
   if (settings.lostDownload) throw Error('PRIVATE_TEST_ERROR_DO_NOT_LOG');
   if (settings.cdn) return new Response('', { status: 302, headers: { location: settings.cdn } });
   const bytes = settings.oversized ? Buffer.concat([encrypted, Buffer.from('extra')]) : settings.corrupt ? Buffer.from(encrypted) : encrypted;
   if (settings.corrupt) bytes[bytes.length - 1] ^= 1;
   return new Response(new Uint8Array(bytes));
  }
  metadata++;
  if (metadata === settings.cancelMetadataAt) controller.abort();
  if (metadata === settings.replaceAt) asset.id = 78;
  return Response.json({ ...release, assets: settings.missing ? [] : release.assets });
 }) as typeof fetch;
 const draft = new PrivateDraft(manifest, token, request);
 const run = () => draft.waitObserverInput(manifest, job, controller.signal, () => { milestones++; }, () => clock,
  async (milliseconds, signal) => { assert.equal(signal.aborted, false); clock += milliseconds; });
 return { manifest, encrypted, asset, release, settings, calls, controller, draft, run,
  metrics: () => ({ metadata, downloads, milestones, clock }), setClock: (at: number) => { clock = at; } };
}
test('late-input declaration requires exact full-hour and job nonce without changing member five paths', () => {
 const { manifest } = fixture(); assert.equal(inputPaths(manifest).length, 5);
 assert.equal(observerInputName(manifest, job), `community-observer-input-${approved.runId}-${job}-1.g2genc`);
 for (const nonce of ['', '0', '01', '1/../../escape', '9007199254740992']) assert.throws(() => observerInputName(manifest, nonce));
 for (const patch of [{ mode: 'authenticated-smoke' }, { runId: '11111111-1111-4111-8111-111111111111' }, { population: 5 },
  { programDigest: '0'.repeat(64) }, { stateDirectory: '.state/community-foreign' }, { release: { ...manifest.release, authenticatedSmokePassed: false } }])
  assert.throws(() => observerInputName({ ...manifest, ...patch } as HostedManifest, job));
});
test('fresh once-only late encrypted download is private, readonly and never forwards auth to CDN', async () => {
 const value = fixture(); value.settings.cdn = 'https://release-assets.githubusercontent.com/synthetic-private-fixture';
 assert.deepEqual(await value.run(), value.encrypted);
 assert.deepEqual(value.metrics(), { metadata: 3, downloads: 1, milestones: 1, clock: start });
 assert.ok(value.calls.every(call => call.method === 'GET' && call.signal instanceof AbortSignal));
 assert.ok(value.calls.filter(call => call.url.startsWith('https://release-assets.githubusercontent.com/')).every(call => !call.authorization));
 const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
});
test('concurrent repeated calls consume only one permission and invalid nonce/signal never sends GET', async () => {
 const value = fixture(), first = value.run(); await assert.rejects(value.run());
 assert.deepEqual(await first, value.encrypted); assert.equal(value.metrics().downloads, 1);
 for (const argument of ['nonce', 'signal']) {
  const invalid = fixture();
  await assert.rejects(invalid.draft.waitObserverInput(invalid.manifest, argument === 'nonce' ? '0' : job,
   argument === 'signal' ? undefined as unknown as AbortSignal : invalid.controller.signal));
  assert.equal(invalid.calls.length, 0);
 }
});
test('only missing metadata is polled for exactly five minutes; no download or retry allowance survives', async () => {
 const value = fixture(); value.settings.missing = true;
 await assert.rejects(value.run()); assert.equal(value.metrics().clock, start + observerInputPolicy.waitMilliseconds);
 assert.equal(value.metrics().downloads, 0); assert.equal(value.metrics().metadata, 60); assert.equal(value.metrics().milestones, 1);
 const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
});
test('foreign name/head/run, duplicate or stale/oversized/unuploaded assets fail without downloads', async () => {
 const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
  value => { value.asset.name = value.asset.name.replace(job, '987654321'); }, value => { value.release.target_commitish = 'b'.repeat(40); },
  value => { value.release.tag_name = 'community-acceptance-foreign'; }, value => { value.release.assets.push({ ...value.asset, id: 78 }); },
  value => { value.asset.created_at = new Date(start - 1).toISOString(); }, value => { value.setClock(start + 300001); },
  value => { value.asset.size = observerInputPolicy.maximumBytes + 1; }, value => { value.asset.state = 'new'; }];
 for (const mutate of mutations) {
  const value = fixture(); mutate(value); await assert.rejects(value.run()); assert.equal(value.metrics().downloads, 0);
  const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
 }
});
test('public draft/asset access and replacement before/after download remain final failures', async () => {
 for (const settings of [{ publicDraft: true }, { publicAsset: true }, { replaceAt: 2 }, { replaceAt: 3 }]) {
  const value = fixture(); Object.assign(value.settings, settings); await assert.rejects(value.run());
  assert.equal(value.metrics().downloads, settings.replaceAt === 3 ? 1 : 0);
  const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
 }
});
test('explicit pre/mid request cancellation and cancelled milestone prevent any further request', async () => {
 const pre = fixture(); pre.controller.abort(); await assert.rejects(pre.run()); assert.equal(pre.calls.length, 0);
 for (const settings of [{ cancelMetadataAt: 1 }, { cancelMetadataAt: 2 }, { cancelMetadataAt: 3 }, { cancelDownload: true }]) {
  const value = fixture(); Object.assign(value.settings, settings); await assert.rejects(value.run());
  const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
 }
 const milestone = fixture(); await assert.rejects(milestone.draft.waitObserverInput(milestone.manifest, job, milestone.controller.signal, () => milestone.controller.abort(), () => start));
 assert.equal(milestone.metrics().metadata, 0);
});
test('wrong digest, overlong stream, lost download and untrusted redirects never retry download', async () => {
 for (const settings of [{ corrupt: true }, { oversized: true }, { lostDownload: true },
  { cdn: 'https://evil.invalid/private' }, { cdn: 'https://user:password@release-assets.githubusercontent.com/private' }]) {
  const value = fixture(); Object.assign(value.settings, settings); await assert.rejects(value.run()); assert.equal(value.metrics().downloads, 1);
  const before = value.calls.length; await assert.rejects(value.run()); assert.equal(value.calls.length, before);
 }
});
test('missing or expired original launch proof is not silently replaced by a fresh observer manifest', async () => {
 const value = fixture(); value.manifest.release.observedAt = new Date(start - 3600000).toISOString();
 // Launch freshness was checked at launch; late INPUT freshness is independent and does not rewrite that proof.
 assert.deepEqual(await value.run(), value.encrypted); assert.equal(value.manifest.release.observedAt, new Date(start - 3600000).toISOString());
 const wrong = fixture(); await assert.rejects(wrong.draft.waitObserverInput({ ...wrong.manifest, releaseId: 456 }, job, wrong.controller.signal));
 assert.equal(wrong.calls.length, 0);
});
test('twentieth asset stays reserved for final recovery; late input cannot raise the cap', async () => {
 const value = fixture(); value.release.assets.push(...Array.from({ length: 19 }, (__unused, index) => ({ ...value.asset, id: index + 100,
  name: `community-recovery-${approved.runId}-${job}-1-checkpoint-${String(index).padStart(2, '0')}.g2genc` })));
 await assert.rejects(value.run()); assert.equal(value.metrics().downloads, 0);
 let posts = 0;
 const release = { ...value.release, assets: value.release.assets.slice(0, 19) };
 const finalName = `community-recovery-${approved.runId}-${job}-1-final.g2genc`;
 const finalAsset = { id: 999, name: finalName, size: value.encrypted.length, digest: `sha256:${sha256(value.encrypted)}` };
 const request = (async (__url: URL | string | Request, init?: RequestInit) => {
  if (init?.method === 'POST') { posts++; release.assets.push(finalAsset); return Response.json({ ...finalAsset, state: 'uploaded' }, { status: 201 }); }
  return new Headers(init?.headers).has('Authorization') ? Response.json(release) : new Response('', { status: 404 });
 }) as typeof fetch;
 const draft = new PrivateDraft(value.manifest, token, request);
 await assert.rejects(draft.upload(`community-recovery-${approved.runId}-${job}-1-checkpoint-19.g2genc`, value.encrypted)); assert.equal(posts, 0);
 await draft.upload(finalName, value.encrypted); assert.equal(posts, 1); assert.equal(release.assets.length, 20);
 await assert.rejects(draft.upload(`community-recovery-${approved.runId}-${job}-1-checkpoint-20.g2genc`, value.encrypted)); assert.equal(posts, 1);
});
