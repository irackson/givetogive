/** Actual Chromium DOM tests with intercepted, synthetic HTML only.
 * No provider contact, accounts, keys, Checkout creation or payment actions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { observeSurface, SurfaceReadUnavailable, validateNativeSurface, validateAcknowledgmentSurface, type Counters } from '../../src/hosted-checkout-worker.ts';
import { StripeCheckoutDriver, checkoutBrowserEnvironment } from '../../src/stripe-checkout-driver.ts';
import { allowedPassiveCheckoutWalletScript } from '../../src/sandbox-policy.ts';

const base = '<p>Test mode</p><input name="cardNumber"><input name="cardExpiry"><input name="cardCvc">';
const counters = (): Counters => ({ consoleErrors: 0, pageErrors: 0, httpErrors: 0, blockedRequests: 0, failedRequests: 0, unexpectedPages: 0 });

test('real secret-free Chromium can be acquired and closed before any Checkout or member mutation', async () => {
  const driver = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'resource-fixture@givetogive.invalid');
  try {
    await driver.prepareBrowser();
    const owned = (driver as unknown as { browser: import('playwright').Browser }).browser;
    assert.equal(owned.isConnected(), true);
    await driver.prepareBrowser();
    assert.equal((driver as unknown as { browser: unknown }).browser, owned);
    assert.equal(driver.blockedHosts.size, 0);
    assert.equal(driver.failedStatuses.length, 0);
    await driver.close();
    assert.equal(owned.isConnected(), false);
    assert.equal((driver as unknown as { browser?: unknown }).browser, undefined);
  } finally { await driver.close(); }
});
async function fixture(html: string, inspect: (page: import('playwright').Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    let requests = 0;
    await context.route('**/*', async route => {
      requests++;
      if (route.request().url() !== 'https://checkout.stripe.com/synthetic-offline-fixture') {
        await route.abort(); throw Error('Unexpected fixture request.');
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<html><head><link rel="icon" href="data:,"></head><body>${html}</body></html>` });
    });
    const page = await context.newPage();
    await page.goto('https://checkout.stripe.com/synthetic-offline-fixture');
    await inspect(page);
    assert.equal(requests, 1, 'Only the intercepted fixture navigation is allowed.');
  } finally { await browser.close(); }
}

test('actual Chromium reads a synthetic native surface without returning card values or DOM text', async () => {
  await fixture(base, async page => {
    const surface = await observeSurface(page, counters(), Date.now());
    assert.doesNotThrow(() => validateNativeSurface(surface, Date.now()));
    assert.equal(surface.visibleCard, true);
    assert.equal(surface.panelDigest, null);
    assert.equal('text' in surface, false);
    assert.equal('url' in surface, false);
  });
});

test('actual Chromium rejects ambiguous duplicate visible card controls', async () => {
  await fixture(base + '<input autocomplete="cc-number">', async page => {
    await assert.rejects(observeSurface(page, counters(), Date.now()));
  });
});

test('actual Chromium DOM failures expose only the fixed observation phase, never the private cause', async () => {
  await fixture(base + '<div class="AiAgentPaymentSteering">Synthetic notice</div>', async page => {
    await page.evaluate(() => {
      Object.defineProperty(crypto, 'subtle', { get() { throw Error('private-fixture-cause-sentinel'); } });
    });
    await assert.rejects(observeSurface(page, counters(), Date.now()), error => {
      assert.ok(error instanceof SurfaceReadUnavailable);
      assert.equal(error.phase, 'panel-dom');
      assert.equal(error.cause, undefined);
      assert.equal(String(error).includes('private-fixture-cause-sentinel'), false);
      return true;
    });
  });
});

test('actual Chromium observes an unknown notice before testing its disabled underlying card fields', async () => {
  const disabled = '<p>Test mode</p><input name="cardNumber" disabled><input name="cardExpiry" disabled><input name="cardCvc" disabled>';
  const panel = '<div class="AiAgentPaymentSteering">Unreviewed fixture notice<label><input type="checkbox">I am an AI agent and have followed the instructions above</label></div>';
  await fixture(disabled + panel, async page => {
    const surface = await observeSurface(page, counters(), Date.now());
    assert.equal(surface.panelCount, 1);
    assert.equal(surface.visibleCard, false);
    assert.throws(() => validateAcknowledgmentSurface(surface, Date.now()));
    assert.throws(() => validateNativeSurface(surface, Date.now()));
  });
});

test('actual Chromium still rejects disabled card fields when no notice is present', async () => {
  await fixture(base.replace('name="cardNumber"', 'name="cardNumber" disabled'), async page => {
    await assert.rejects(observeSurface(page, counters(), Date.now()));
  });
});

for (const [name, html] of [
  ['unknown agent notice', '<div class="AiAgentPaymentSteering">Unreviewed instructions<label><input type="checkbox">I am an AI agent and have followed the instructions above</label></div>'],
  ['unknown alert', '<div role="alert">Unreviewed provider condition</div>'],
  ['human verification', '<p>Verify that you are human</p>'],
  ['wallet requirement', '<p>Approve in your wallet</p>'],
]) test(`actual Chromium refuses ${name} without a native control action`, async () => {
  await fixture(base + html, async page => {
    const surface = await observeSurface(page, counters(), Date.now());
    assert.throws(() => validateNativeSurface(surface, Date.now()));
    assert.throws(() => validateAcknowledgmentSurface(surface, Date.now()));
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0);
  });
});

test('actual Chromium error counters prevent native admission on an otherwise valid fixture', async () => {
  await fixture(base, async page => {
    for (const field of ['consoleErrors', 'pageErrors', 'httpErrors', 'blockedRequests', 'failedRequests', 'unexpectedPages'] as const) {
      const observed = await observeSurface(page, { ...counters(), [field]: 1 }, Date.now());
      assert.throws(() => validateNativeSurface(observed, Date.now()));
    }
  });
});

test('actual Chromium admits only intercepted official wallet SDK script loads while card-only controls remain readable', async () => {
  const browser = await chromium.launch({ headless: true, env: checkoutBrowserEnvironment() });
  const main = 'https://checkout.stripe.com/synthetic-offline-wallet-fixture';
  const scripts = ['https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js', 'https://static-na.payments-amazon.com/checkout.js'];
  let requests = 0;
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      requests++; const request = route.request();
      if (request.url() === main) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<html><head><link rel="icon" href="data:,"></head><body>${base}${scripts.map(src => `<script src="${src}"></script>`).join('')}</body></html>` });
      } else {
        assert.ok(scripts.includes(request.url()));
        assert.equal(allowedPassiveCheckoutWalletScript(request.url(), request.isNavigationRequest(), request.resourceType(), request.method()), true);
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.fixtureWalletSdkLoads=(window.fixtureWalletSdkLoads||0)+1;' });
      }
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', () => { errors.push('page-error'); });
    await page.goto(main);
    assert.equal(await page.evaluate(() => (window as unknown as { fixtureWalletSdkLoads: number }).fixtureWalletSdkLoads), 2);
    assert.equal(requests, 3, 'Only intercepted fixture and SDK requests, never provider contact.');
    assert.equal(errors.length, 0);
    const surface = await observeSurface(page, counters(), Date.now());
    assert.doesNotThrow(() => validateNativeSurface(surface, Date.now()));
  } finally { await browser.close(); }
});
