import { assertDraft, repository, requireHosted, sha256, type HostedManifest } from './hosted-community-policy.ts';
import { setTimeout as sleep } from 'node:timers/promises';

/** Only GET draft metadata/input and POST exclusive encrypted assets. No release/tag mutation API. */
export class PrivateDraft {
 readonly binding: Pick<HostedManifest, 'runId' | 'headSha' | 'releaseId'>;
 private token: string;
 private request: typeof fetch;
 constructor(binding: Pick<HostedManifest, 'runId' | 'headSha' | 'releaseId'>, token: string, request: typeof fetch = fetch) {
  requireHosted(token.length >= 20); this.binding = binding; this.token = token; this.request = request;
 }
 private headers() { return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }; }
 async inspect() {
  const response = await this.request(`https://api.github.com/repos/${repository}/releases/${this.binding.releaseId}`,
   { headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(30000) });
  requireHosted(response.status === 200);
  return assertDraft(await response.json(), this.binding);
 }
 private async provePrivate(path: string) {
  const response = await this.request(`https://api.github.com/repos/${repository}/${path}`,
   { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json' } });
  requireHosted(response.status === 404);
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
 async upload(name: string, encrypted: Buffer) {
  requireHosted(new RegExp(`^community-recovery-${this.binding.runId}-[0-9]+-1-(?:checkpoint-[0-9]{2}|final)\\.g2genc$`).test(name));
  requireHosted(encrypted.subarray(0, 8).toString() === 'G2GHOST1' && encrypted.length <= 128 * 1024 * 1024);
  const release = await this.inspect();
  requireHosted(release.assets.length < 20 && !release.assets.some(asset => asset.name === name));
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
