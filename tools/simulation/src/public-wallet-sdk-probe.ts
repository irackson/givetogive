/** Public vendor SDK execution only. No private Checkout, member, provider key,
 * form entry, wallet call, merchant request, payment or entitlement authority. */
import { chromium } from 'playwright';
import { freemem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkoutBrowserEnvironment } from './stripe-checkout-driver.ts';
import { allowedPassiveCheckoutWalletScript } from './sandbox-policy.ts';
import { requestAllowed } from './hosted-checkout-policy.ts';

export const publicWalletScripts = [
  'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js',
  'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-button.js',
  'https://applepay.cdn-apple.com/jsapi/1.latest/apple-wallet-sdk.js',
  'https://static-na.payments-amazon.com/cPSPcheckout.js',
  'https://static-na.payments-amazon.com/checkout.js',
] as const;

export function assertPublicSdkRuntime(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform, head: string) {
  if (platform !== 'linux' || environment.GITHUB_ACTIONS !== 'true' ||
    environment.GITHUB_REPOSITORY !== 'irackson/givetogive' || environment.GITHUB_REF !== 'refs/heads/main' ||
    environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' || environment.GITHUB_ACTOR !== 'irackson' ||
    environment.GITHUB_TRIGGERING_ACTOR !== 'irackson' || environment.GITHUB_RUN_ATTEMPT !== '1' ||
    !/^[a-f0-9]{40}$/.test(head) || environment.GITHUB_SHA !== head || environment.PUBLIC_SDK_EXPECTED_SHA !== head)
    throw new Error('Public SDK probe runtime rejected.');
  if (Object.keys(environment).some(key => /^(?:STRIPE_|DATABASE_|NEXTAUTH_|CHECKOUT_|GOOGLE_|GMAIL_|RESEND_|ADMIN_|AUTH_|SIMULATION_|PWDEBUG$|DEBUG$|NODE_OPTIONS$|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)))
    throw new Error('Public SDK probe must not receive credentials or debug hooks.');
}

export async function probePublicWalletSdks() {
  if (freemem() < 2.5 * 1024 ** 3) throw new Error('Public SDK probe requires browser memory headroom.');
  const browser = await chromium.launch({ headless: true, env: checkoutBrowserEnvironment() });
  const observed = new Map<string, number>();
  let blockedRequests = 0, pageErrors = 0, consoleErrors = 0, assetFailures = 0, admittedRequests = 0;
  const main = 'https://checkout.stripe.com/synthetic-public-sdk-probe';
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url() === main && request.isNavigationRequest() && request.method() === 'GET') {
        await route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="icon" href="data:,"></head><body>' +
          `<script src="${publicWalletScripts[0]}"></script><script src="${publicWalletScripts[3]}"></script><script src="${publicWalletScripts[4]}"></script></body></html>` });
        return;
      }
      if (!publicWalletScripts.includes(request.url() as typeof publicWalletScripts[number]) ||
        !allowedPassiveCheckoutWalletScript(request.url(), request.isNavigationRequest(), request.resourceType(), request.method()) ||
        !requestAllowed(request.url(), request.method(), request.isNavigationRequest(), request.frame().url(), 'opening',
          undefined, undefined, undefined, request.postData(), request.resourceType()) || admittedRequests >= 20) {
        blockedRequests++; await route.abort(); return;
      }
      admittedRequests++;
      try {
        // Fetch static assets without browser cookies/referrers. Do not follow
        // redirects or let an SDK asset redirect extend destination authority.
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000, headers: { Accept: 'application/javascript' } });
        const body = await response.body();
        if (response.status() !== 200 || response.url() !== request.url() || body.length > 1024 * 1024 ||
          !/javascript/i.test(response.headers()['content-type'] ?? '')) {
          assetFailures++; await route.abort(); return;
        }
        observed.set(request.url(), (observed.get(request.url()) ?? 0) + 1);
        await route.fulfill({ status: 200, contentType: 'application/javascript',
          headers: { 'Access-Control-Allow-Origin': '*' }, body });
      } catch { assetFailures++; await route.abort(); }
    });
    const page = await context.newPage();
    page.on('pageerror', () => { pageErrors++; });
    page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
    context.on('page', other => { if (other !== page) { blockedRequests++; void other.close(); } });
    await page.goto(main, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => Boolean(customElements.get('apple-pay-button') && customElements.get('apple-wallet-button')), null, { timeout: 15000 }).catch(() => undefined);
    const registered = await page.evaluate(() => {
      const value = window as unknown as { ApplePaySDK?: unknown; PartnerExpressFactory?: unknown; amazon?: { Pay?: unknown } };
      return { appleSdk: Boolean(value.ApplePaySDK), appleButton: Boolean(customElements.get('apple-pay-button')),
        walletButton: Boolean(customElements.get('apple-wallet-button')), amazonSdk: Boolean(value.amazon?.Pay), amazonStripeFactory: Boolean(value.PartnerExpressFactory) };
    });
    const passed = publicWalletScripts.every(url => observed.has(url)) && !assetFailures && !pageErrors &&
      registered.appleSdk && registered.appleButton && registered.walletButton && registered.amazonSdk && registered.amazonStripeFactory;
    const result = { passed, publicSdkExecution: true, financialAuthority: false, financialActions: 0, paymentAccepted: false,
      assets: publicWalletScripts.map(url => ({ name: new URL(url).pathname.split('/').at(-1), loads: observed.get(url) ?? 0 })),
      registered, blockedRequests, pageErrors, consoleErrors, assetFailures };
    return result;
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--execute-public-readonly') throw new Error('Explicit public read-only execution required.');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assertPublicSdkRuntime(process.env, process.platform, head);
    const result = await probePublicWalletSdks();
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch { console.log(JSON.stringify({ publicSdkExecution: false, financialAuthority: false, financialActions: 0, paymentAccepted: false, privateDiagnosticsWithheld: true })); process.exitCode = 1; }
}
