// Credential-free executable contract; no database/provider connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../../scripts/checkout-operator-inspect.mjs', import.meta.url));
const environment = { ...process.env, APP_ENV: 'production', DATABASE_URL: 'PRIVATE-FIXTURE-NOT-A-URL', STRIPE_SECRET_KEY: 'PRIVATE-FIXTURE-NOT-A-KEY' };
test('local operator command is inert even when inherited environment contains rejected credentials', () => {
 const value = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8', env: environment }));
 assert.deepEqual(value, { execute: false, externalRequests: 0, databaseWrites: 0, memberActions: 0, checkoutCreated: false, paymentAccepted: false });
});
test('unsupported commands and explicit invalid environment fail without private diagnostics or financial fallback', () => {
 for (const args of [['--prepare'], ['--inspect-readonly', '--retry'], ['--inspect-readonly']]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: environment });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-FIXTURE|postgres:|sk_live_|createCheckout/);
  assert.match(result.stderr, /prerequisites rejected; private details withheld/);
 }
});
test('importing the operator script does not execute its CLI or load the SDK/client', () => {
 const source = `await import(${JSON.stringify(new URL('../../../scripts/checkout-operator-inspect.mjs', import.meta.url).href)}); console.log('import-only');`;
 const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: environment });
 assert.equal(output.trim(), 'import-only');
});
