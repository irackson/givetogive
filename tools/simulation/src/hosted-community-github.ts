import { assertDraft, observerInputName, observerInputPolicy, repository, requireHosted, sha256, type HostedManifest } from './hosted-community-policy.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

/** Only GET draft metadata/input and POST exclusive encrypted assets. No release/tag mutation API. */
export class PrivateDraft {
 readonly binding: Pick<HostedManifest, 'runId' | 'headSha' | 'releaseId'>;
 private token: string;
 private request: typeof fetch;
 private observerInputConsumed = false;
 constructor(binding: Pick<HostedManifest, 'runId' | 'headSha' | 'releaseId'>, token: string, request: typeof fetch = fetch) {
  requireHosted(token.length >= 20); this.binding = binding; this.token = token; this.request = request;
 }
 private headers() { return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }; }
 async inspect(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await this.request(`https://api.github.com/repos/${repository}/releases/${this.binding.releaseId}`,
   { headers: this.headers(), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  signal?.throwIfAborted();
  requireHosted(response.status === 200);
  const release = assertDraft(await response.json(), this.binding); signal?.throwIfAborted(); return release;
 }
 private async provePrivate(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await this.request(`https://api.github.com/repos/${repository}/${path}`,
   { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json' } });
  try { signal?.throwIfAborted(); requireHosted(response.status === 404); } finally { await response.body?.cancel(); }
 }
 async waitInput(milestone: () => void, now = () => Date.now(), pause: (milliseconds: number) => Promise<unknown> = sleep) {
  const deadline = now() + 600000, name = `community-input-${this.binding.runId}.g2genc`;
  await this.provePrivate(`releases/${this.binding.releaseId}`);
  milestone(); // Fixed safe milestone only, no provider filenames/tokens/URLs.
  while (now() < deadline) {
   const release = await this.inspect(), matches = release.assets.filter(asset => asset.name === name);
   requireHosted(matches.length <= 1);
   if (matches.length === 1) return this.input(); // One outcome; crypto/staleness errors never cause replay/renewal.
   await pause(Math.min(5000, Math.max(0, deadline - now())));
  }
  requireHosted(false);
 }
 async input() {
  const release = await this.inspect(), name = `community-input-${this.binding.runId}.g2genc`;
  const files = release.assets.filter(asset => asset.name === name);
  requireHosted(files.length === 1 && files[0]!.size > 36 && files[0]!.size <= 8 * 1024 * 1024);
  await this.provePrivate(`releases/${this.binding.releaseId}`);
  await this.provePrivate(`releases/assets/${files[0]!.id}`);
  let response = await this.request(`https://api.github.com/repos/${repository}/releases/assets/${files[0]!.id}`,
   { headers: { ...this.headers(), Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if ([302, 307].includes(response.status)) {
   const url = new URL(response.headers.get('location') ?? '');
   requireHosted(url.protocol === 'https:' && url.hostname === 'release-assets.githubusercontent.com' && !url.username && !url.password);
   // Never forward GitHub authorization to the signed asset CDN URL.
   response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  }
  requireHosted(response.status === 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  requireHosted(bytes.length === files[0]!.size && files[0]!.digest === `sha256:${sha256(bytes)}`);
  const after = await this.inspect(), retained = after.assets.filter(asset => asset.name === name);
  requireHosted(retained.length === 1 && retained[0]!.id === files[0]!.id && retained[0]!.digest === files[0]!.digest && retained[0]!.size === bytes.length);
  return bytes;
 }
 /** One permission per job-owned instance, consumed BEFORE the first GET, including failure/cancellation.
  * Only a missing asset may be polled; a selected asset is never downloaded again or replaced.
  * The wrapper owns durable consumed-state/no-restart proof and validates the encrypted root attestation.
  */
 async waitObserverInput(manifest: HostedManifest, githubRunId: string, signal: AbortSignal, milestone: () => void = () => {}, now = () => Date.now(),
  pause: (milliseconds: number, signal: AbortSignal) => Promise<unknown> = (milliseconds, cancel) => sleep(milliseconds, undefined, { signal: cancel })) {
  requireHosted(!this.observerInputConsumed); this.observerInputConsumed = true;
  const name = observerInputName(manifest, githubRunId);
  requireHosted(this.binding.runId === manifest.runId && this.binding.headSha === manifest.headSha && this.binding.releaseId === manifest.releaseId);
  requireHosted(signal instanceof AbortSignal && !signal.aborted && Number.isFinite(now()));
  const deadline = now() + observerInputPolicy.waitMilliseconds;
  const cancel = AbortSignal.any([signal, AbortSignal.timeout(observerInputPolicy.waitMilliseconds)]);
  const active = () => { cancel.throwIfAborted(); requireHosted(Number.isFinite(now()) && now() < deadline); };
  const select = (release: Awaited<ReturnType<PrivateDraft['inspect']>>) => {
   requireHosted(release.assets.length < observerInputPolicy.maximumAssets
    && new Set(release.assets.map(asset => asset.id)).size === release.assets.length
    && new Set(release.assets.map(asset => asset.name)).size === release.assets.length);
   const observer = release.assets.filter(asset => asset.name.startsWith('community-observer-input-'));
   requireHosted(observer.length <= 1 && observer.every(asset => asset.name === name));
   const asset = observer[0]; if (!asset) return undefined;
   const createdAt = z.iso.datetime().parse(asset.created_at);
   const age = now() - Date.parse(createdAt);
   requireHosted(asset.state === 'uploaded' && asset.size > 36 && asset.size <= observerInputPolicy.maximumBytes
    && age >= 0 && age <= observerInputPolicy.maximumAgeMilliseconds && Date.parse(createdAt) >= Date.parse(manifest.release.observedAt));
   return { id: asset.id, name: asset.name, size: asset.size, digest: asset.digest, createdAt };
  };
  active(); await this.provePrivate(`releases/${this.binding.releaseId}`, cancel); active(); milestone(); active();
  let file: ReturnType<typeof select>;
  while (!file) {
   active(); file = select(await this.inspect(cancel)); active();
   if (!file) { await pause(Math.min(5000, Math.max(0, deadline - now())), cancel); active(); }
  }
  await this.provePrivate(`releases/assets/${file.id}`, cancel); active();
  // Reinspect immediately BEFORE downloading; an already-selected asset may not disappear or change.
  const before = select(await this.inspect(cancel));
  requireHosted(before && JSON.stringify(before) === JSON.stringify(file)); active();
  let response = await this.request(`https://api.github.com/repos/${repository}/releases/assets/${file.id}`,
   { headers: { ...this.headers(), Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.any([cancel, AbortSignal.timeout(30000)]) });
  active();
  if ([302, 307].includes(response.status)) {
   const url = new URL(response.headers.get('location') ?? '');
   requireHosted(url.protocol === 'https:' && url.hostname === 'release-assets.githubusercontent.com' && !url.username && !url.password);
   await response.body?.cancel(); active();
   response = await this.request(url, { redirect: 'error', signal: AbortSignal.any([cancel, AbortSignal.timeout(30000)]) });
   active(); // No GitHub authorization reaches the signed CDN URL.
  }
  requireHosted(response.status === 200 && response.body);
  const reader = response.body.getReader(), chunks: Buffer[] = []; let length = 0;
  try {
   for (;;) {
    active(); const part = await reader.read(); active(); if (part.done) break;
    length += part.value.byteLength; requireHosted(length <= file.size && length <= observerInputPolicy.maximumBytes);
    chunks.push(Buffer.from(part.value));
   }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks); chunks.forEach(chunk => chunk.fill(0));
  try {
   requireHosted(bytes.length === file.size && bytes.subarray(0, 8).toString() === 'G2GHOST1' && file.digest === `sha256:${sha256(bytes)}`);
   active(); const after = select(await this.inspect(cancel)); requireHosted(after && JSON.stringify(after) === JSON.stringify(file));
   await this.provePrivate(`releases/${this.binding.releaseId}`, cancel);
   await this.provePrivate(`releases/assets/${file.id}`, cancel); active(); return bytes;
  } catch { bytes.fill(0); throw new Error('Late observer input rejected; private details withheld. Never automatically retry.'); }
 }
 async upload(name: string, encrypted: Buffer) {
  requireHosted(new RegExp(`^community-recovery-${this.binding.runId}-[0-9]+-1-(?:checkpoint-[0-9]{2}|final)\\.g2genc$`).test(name));
  requireHosted(encrypted.subarray(0, 8).toString() === 'G2GHOST1' && encrypted.length <= 128 * 1024 * 1024);
  const release = await this.inspect();
  // Keep one slot for the final recovery receipt; the additional late observer input does not raise the cap.
  const isFinal = name.endsWith('-final.g2genc');
  requireHosted(release.assets.length < (isFinal ? observerInputPolicy.maximumAssets : observerInputPolicy.maximumAssets - 1)
   && !release.assets.some(asset => asset.name === name));
  await this.provePrivate(`releases/${this.binding.releaseId}`);
  const response = await this.request(`https://uploads.github.com/repos/${repository}/releases/${this.binding.releaseId}/assets?name=${encodeURIComponent(name)}`,
   { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(encrypted), redirect: 'error', signal: AbortSignal.timeout(120000) });
  requireHosted(response.status === 201);
  const uploaded = await response.json() as Record<string, unknown>;
  requireHosted(uploaded.name === name && uploaded.size === encrypted.length && uploaded.state === 'uploaded' && Number.isSafeInteger(uploaded.id));
  const after = await this.inspect(), retained = after.assets.filter(asset => asset.name === name);
  requireHosted(retained.length === 1 && retained[0]!.id === uploaded.id && retained[0]!.size === encrypted.length && retained[0]!.digest === `sha256:${sha256(encrypted)}`);
  await this.provePrivate(`releases/assets/${uploaded.id}`); // Failure is retained, never overwritten/retried.
 }
}
