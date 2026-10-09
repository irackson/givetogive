/** Actual Chromium DOM tests with intercepted, synthetic HTML only.
 * No provider contact, accounts, keys, Checkout creation or payment actions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { observeSurface, waitForHostedCheckoutSurface, prepareHostedCheckoutSurface, OneNativeClick, SurfaceReadUnavailable, validateNativeSurface, validateAcknowledgmentSurface, validateCardSelectionSurface, type Counters } from '../../src/hosted-checkout-worker.ts';
import { StripeCheckoutDriver, checkoutBrowserEnvironment } from '../../src/stripe-checkout-driver.ts';
import { allowedPassiveCheckoutWalletScript } from '../../src/sandbox-policy.ts';
import { requestAllowed } from '../../src/hosted-checkout-policy.ts';

const base = '<p>Test mode</p><input name="cardNumber"><input name="cardExpiry"><input name="cardCvc">';
const counters = (): Counters => ({ consoleErrors: 0, pageErrors: 0, httpErrors: 0, blockedRequests: 0, failedRequests: 0, unexpectedPages: 0 });

test('actual Chromium waits for asynchronous clean test-card rendering without filling or clicking', async () => {
  await fixture('<p>Loading payment form</p><div id="fields"></div><script>setTimeout(()=>{document.querySelector("#fields").innerHTML=' + JSON.stringify(base) + ';},600)</script>', async page => {
    assert.equal((await observeSurface(page, counters(), Date.now())).visibleCard, false);
    const surface = await waitForHostedCheckoutSurface(() => observeSurface(page, counters(), Date.now()),
      { signal: new AbortController().signal, now: Date.now, timeoutMs: 3000 });
    assert.doesNotThrow(() => validateNativeSurface(surface, Date.now()));
    assert.equal(await page.locator('input[name="cardNumber"]').inputValue(), '');
  });
});

test('actual Chromium renderer wait stops at an unknown alert before a later healthy-looking state', async () => {
  await fixture('<p>Loading payment form</p><div role="alert">Unreviewed condition</div><script>setTimeout(()=>{document.body.innerHTML=' + JSON.stringify(base) + ';},1500)</script>', async page => {
    await assert.rejects(waitForHostedCheckoutSurface(() => observeSurface(page, counters(), Date.now()),
      { signal: new AbortController().signal, now: Date.now, timeoutMs: 3000 }));
    assert.equal(await page.locator('[role="alert"]').count(), 1);
  });
});

test('real secret-free Chromium can be acquired and closed before any Checkout or member mutation', async () => {
  const driver = new StripeCheckoutDriver('public-fixture-bypass'.repeat(2), 'resource-fixture@givetogive.invalid');
  try {
    await driver.prepareBrowser();
    const owned = (driver as unknown as { browser: Browser }).browser;
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
async function fixture(html: string, inspect: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true, env: checkoutBrowserEnvironment() });
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
  const scripts = ['https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js',
    'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-button.js',
    'https://applepay.cdn-apple.com/jsapi/1.latest/apple-wallet-sdk.js',
    'https://static-na.payments-amazon.com/checkout.js', 'https://static-na.payments-amazon.com/cPSPcheckout.js'];
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
        assert.equal(requestAllowed(request.url(), request.method(), request.isNavigationRequest(), request.frame().url(), 'opening',
          undefined, undefined, undefined, request.postData(), request.resourceType()), true);
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.fixtureWalletSdkLoads=(window.fixtureWalletSdkLoads||0)+1;' });
      }
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', () => { errors.push('page-error'); });
    await page.goto(main);
    assert.equal(await page.evaluate(() => (window as unknown as { fixtureWalletSdkLoads: number }).fixtureWalletSdkLoads), scripts.length);
    assert.equal(requests, scripts.length + 1, 'Only intercepted fixture and SDK requests, never provider contact.');
    assert.equal(errors.length, 0);
    const surface = await observeSurface(page, counters(), Date.now());
    assert.doesNotThrow(() => validateNativeSurface(surface, Date.now()));
  } finally { await browser.close(); }
});

test('actual hosted adapter reveals Card once without filling/submitting and preserves strict native protocol shape', async () => {
  const html = '<p>Test mode</p><button type="button" onclick="window.cardSelections=(window.cardSelections||0)+1;document.querySelector(\'#fields\').hidden=false">Card</button>' +
    '<div id="fields" hidden><input name="cardNumber"><input name="cardExpiry"><input name="cardCvc"></div>';
  await fixture(html, async page => {
    const selection = new OneNativeClick(); let proofs = 0;
    const options = { signal: new AbortController().signal, now: Date.now, selection, beforeSelection: () => { proofs++; } };
    const surface = await prepareHostedCheckoutSurface(page, counters(), options);
    assert.doesNotThrow(() => validateNativeSurface(surface, Date.now()));
    assert.equal('cardChoiceCount' in surface, false);
    assert.equal(await page.locator('input[name="cardNumber"]').inputValue(), '');
    assert.equal(selection.attempts, 1); assert.equal(proofs, 3);
    await prepareHostedCheckoutSurface(page, counters(), options);
    assert.equal(selection.attempts, 1);
    assert.equal(await page.evaluate(() => (window as unknown as { cardSelections: number }).cardSelections), 1);
  });
});

test('actual hosted adapter rejects a changed original approval before selecting Card', async () => {
  await fixture('<p>Test mode</p><button>Card</button>', async page => {
    const selection = new OneNativeClick();
    await assert.rejects(prepareHostedCheckoutSurface(page, counters(), { signal: new AbortController().signal, now: Date.now,
      selection, beforeSelection: () => { throw Error('offline-original-proof-rejected'); } }));
    assert.equal(selection.attempts, 0);
  });
});

test('actual driver reveals a collapsed Card section once before fixture entry, never submits or collapses it again', async () => {
  const html = '<p>Test mode</p><button type="button" onclick="window.cardSelections=(window.cardSelections||0)+1;document.querySelector(\'#fields\').hidden=false">Card</button>' +
    '<div id="fields" hidden><input name="cardNumber"><input name="cardExpiry"><input name="cardCvc"></div>';
  await fixture(html, async page => {
    const before = await observeSurface(page, counters(), Date.now(), { cardChoice: true });
    assert.equal(before.visibleCard, false);
    assert.equal(before.cardChoiceCount, 1);
    assert.doesNotThrow(() => validateCardSelectionSurface(before, Date.now()));
    assert.throws(() => validateNativeSurface(before, Date.now()));
    const driver = new StripeCheckoutDriver('', 'collapsed-card-fixture@givetogive.invalid');
    Object.assign(driver, { page });
    await driver.fillFixture('success');
    assert.equal(await page.evaluate(() => (window as unknown as { cardSelections: number }).cardSelections), 1);
    assert.equal(driver.diagnostics().cardSelectionClickAttempts, 1);
    assert.equal(driver.diagnostics().noticeClickAttempts, 0);
    assert.equal((await page.locator('input[name="cardNumber"]').inputValue()).length, 16);
    const after = await observeSurface(page, counters(), Date.now());
    assert.doesNotThrow(() => validateNativeSurface(after, Date.now()));
  });
});

for (const [name, html] of [
  ['duplicate Card options', '<p>Test mode</p><button>Card</button><button>Card</button>'],
  ['disabled Card option', '<p>Test mode</p><button disabled>Card</button>'],
  ['non-test page', '<p>Payment</p><button>Card</button>'],
  ['unknown alert', '<p>Test mode</p><button>Card</button><div role="alert">Unreviewed condition</div>'],
]) test(`actual driver refuses card selection on ${name}`, async () => {
  await fixture(html, async page => {
    const driver = new StripeCheckoutDriver('', 'refused-card-fixture@givetogive.invalid');
    Object.assign(driver, { page });
    await assert.rejects(driver.fillFixture('success'));
    assert.equal(driver.diagnostics().cardSelectionClickAttempts, 0);
    assert.equal(driver.diagnostics().noticeClickAttempts, 0);
    const selection = new OneNativeClick();
    await assert.rejects(prepareHostedCheckoutSurface(page, counters(), { signal: new AbortController().signal,
      now: Date.now, selection, beforeSelection: () => {} }));
    assert.equal(selection.attempts, 0);
  });
});
