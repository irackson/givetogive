// Actual default/import subprocesses only. Never invoke the financial flag here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../../../scripts/checkout-current-native-operator.mjs', import.meta.url));
test('native current command is actually inert by default even with malformed financial environment', () => {
 const bytes = execFileSync(process.execPath, [entry], { windowsHide: true,
  env: { ...process.env, STRIPE_SECRET_KEY: 'public-fixture-do-not-print', APP_ENV: 'production' } });
 assert.deepEqual(JSON.parse(bytes.toString()), { execute: false, externalRequests: 0, checkoutCreated: false, paymentAccepted: false });
});
test('import does not execute native current operator or discover credentials', () => {
 const url = new URL('../../../scripts/checkout-current-native-operator.mjs', import.meta.url).href;
 const bytes = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); process.stdout.write('inert');`], { windowsHide: true });
 assert.equal(bytes.toString(), 'inert');
});
test('unknown flags reject without entering the native operator', () => {
 const result = spawnSync(process.execPath, [entry, '--execute-reviewed'], { windowsHide: true, encoding: 'utf8' });
 assert.equal(result.status, 1); assert.equal(result.stdout, '');
 assert.match(result.stderr, /private details withheld/); assert.doesNotMatch(result.stderr, /STRIPE_SECRET|public-fixture/);
});
