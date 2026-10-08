import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const url = new URL('../../../scripts/checkout-release-inspect.mjs', import.meta.url), script = fileURLToPath(url);
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
