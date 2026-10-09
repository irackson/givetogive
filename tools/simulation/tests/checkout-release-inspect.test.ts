import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelReleaseMetadataReads } from '../../../scripts/checkout-release-inspect.mjs';

test('three current explicit metadata GETs start together; a failure rejects rather than becoming cached proof', async () => {
 const starts: string[] = [], releases: Array<(value: unknown) => void> = [];
 const pending = parallelReleaseMetadataReads(path => { starts.push(path); return new Promise(resolve => releases.push(resolve)); });
 assert.equal(starts.length, 3); assert.equal(releases.length, 3);
 assert.ok(starts[0]!.startsWith('/v9/projects/')); assert.ok(starts[1]!.startsWith('/v13/deployments/'));
 assert.equal(starts[2], '/v4/aliases/givetogive-staging.vercel.app');
 releases.forEach((resolve, index) => resolve(index)); assert.deepEqual(await pending, [0,1,2]);
 await assert.rejects(() => parallelReleaseMetadataReads(async () => { throw Error('offline unavailable'); }));
});
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const url = new URL('../../../scripts/checkout-release-inspect.mjs', import.meta.url), script = fileURLToPath(url);

test('reviewed staging metadata requires the complete new source/lock/upload tuple', async () => {
 const { checkoutReleaseBinding: binding, matchesReviewedCheckoutUpload } = await import('../../../scripts/checkout-release-inspect.mjs');
 const valid = { githubCommitSha: binding.appSha, githubOrg: 'irackson', githubRepo: 'givetogive',
  verificationAuthoredSourceDigest: binding.sourceDigest, verificationLockDigest: binding.lockDigest,
  verificationSourceDigest: binding.uploadDigest };
 assert.equal(matchesReviewedCheckoutUpload(valid), true);
 for (const key of Object.keys(valid)) {
  assert.equal(matchesReviewedCheckoutUpload({ ...valid, [key]: undefined }), false);
  assert.equal(matchesReviewedCheckoutUpload({ ...valid, [key]: 'unreviewed' }), false);
 }
 assert.equal(matchesReviewedCheckoutUpload(undefined), false);
 assert.equal(matchesReviewedCheckoutUpload({ ...valid, githubCommitSha: '8888877182d76c18de40a747fd573b3d04643006' }), false);
 assert.equal(matchesReviewedCheckoutUpload({ ...valid, githubCommitSha: 'f7301db9bf188374fbd0cff3e374e16ab11292c7' }), false);
});
test('CLI 59.5 curl excludes the broken global flag; other commands stay explicitly non-interactive', async () => {
 const { releaseCliArguments } = await import('../../../scripts/checkout-release-inspect.mjs');
 const args = releaseCliArguments(['curl', '/api/health', '--', '--silent']);
 assert.equal(args.includes('--non-interactive'), false);
 assert.deepEqual(args.slice(args.indexOf('--') + 1), ['--silent']);
 assert.deepEqual(releaseCliArguments(['api', '/v2/user']).slice(1), ['--non-interactive', 'api', '/v2/user']);
});
test('release CLI and import are inert without Vercel authentication or project configuration', () => {
 const output = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
 assert.deepEqual(output, { execute: false, externalRequests: 0, financialAdmission: false });
 const imported = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url.href)}); console.log('import-only');`], { encoding: 'utf8' });
 assert.equal(imported.trim(), 'import-only');
});
test('unsupported mutation/retry arguments fail with fixed diagnostics before external access', () => {
 for (const args of [['--deploy'], ['--inspect-readonly', '--retry']]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /release unconfirmed; private details withheld/);
 }
});
test('fast release checks reject invented or deserialized snapshots before any native access', async () => {
 const { recheckLocalCheckoutRelease } = await import('../../../scripts/checkout-release-inspect.mjs');
 for (const snapshot of [undefined, {}, { ready: true, headSha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) }])
  await assert.rejects(recheckLocalCheckoutRelease(snapshot as never), /release unconfirmed/);
});
