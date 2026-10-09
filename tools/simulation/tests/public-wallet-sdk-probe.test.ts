import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPublicSdkRuntime, publicWalletScripts } from '../src/public-wallet-sdk-probe.ts';
import { allowedPassiveCheckoutWalletScript } from '../src/sandbox-policy.ts';

const head = 'a'.repeat(40);
const environment = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'irackson/givetogive', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'irackson', GITHUB_TRIGGERING_ACTOR: 'irackson', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: head, PUBLIC_SDK_EXPECTED_SHA: head };
test('public SDK execution is owner-dispatched, exact-main-head and secret-free', () => {
  assert.doesNotThrow(() => assertPublicSdkRuntime(environment, 'linux', head));
  for (const update of [{ GITHUB_ACTOR: 'other' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_EVENT_NAME: 'push' },
    { PUBLIC_SDK_EXPECTED_SHA: 'b'.repeat(40) }, { GITHUB_REF: 'refs/heads/other' },
    { STRIPE_SECRET_KEY: 'forbidden-public-fixture' }, { DATABASE_URL: 'forbidden-public-fixture' },
    { GITHUB_TOKEN: 'forbidden-public-fixture' }, { AUTH_EMAIL_TEST_MODE: 'true' }, { DEBUG: '1' }])
    assert.throws(() => assertPublicSdkRuntime({ ...environment, ...update }, 'linux', head));
  assert.throws(() => assertPublicSdkRuntime(environment, 'win32', head));
});
test('public SDK probe limits requests to five static assets and cannot become a financial test', () => {
  assert.equal(publicWalletScripts.length, 5);
  for (const url of publicWalletScripts) assert.equal(allowedPassiveCheckoutWalletScript(url, false, 'script', 'GET'), true);
  const source = readFileSync(new URL('../src/public-wallet-sdk-probe.ts', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../../.github/workflows/checkout-public-sdk.yml', import.meta.url), 'utf8');
  assert.match(source, /maxRedirects: 0, maxRetries: 0/);
  assert.doesNotMatch(source, /\.(?:click|fill|submit|createCheckout|canMakePayments|applePayCapabilities)\(/);
  assert.doesNotMatch(workflow, /secrets\.|upload-artifact|save-cache|STRIPE_|DATABASE_|GITHUB_TOKEN/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
});
