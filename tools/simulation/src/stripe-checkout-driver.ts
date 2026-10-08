import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { allowedCheckoutRequest, sandboxOrigin, stripeOwnedOrigin, type CheckoutScenario, type VerifiedCheckout } from './sandbox-policy.ts';
import { protectionHeaders } from './protection.ts';
import { freemem } from 'node:os';
import { observeSurface, validateAcknowledgmentSurface, validateNativeSurface, OneNativeClick, type Counters } from './hosted-checkout-worker.ts';
import { approved } from './hosted-checkout-policy.ts';

export interface CheckoutDriver {
  open(checkout: VerifiedCheckout): Promise<void>;
  fillFixture(scenario: Exclude<CheckoutScenario, 'cancel'>): Promise<void>;
  submit(): Promise<void>;
  challenge(success: boolean): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

// Official public Stripe test fixtures. Never configurable by personas, model output, or CLI PAN input.
const fixtureCards = { success: '4242424242424242', decline: '4000000000000002', three_ds_success: '4000000000003220', three_ds_failure: '4000000000003220' } as const;

/** Chromium must never inherit the root observer's provider/database/auth secrets. */
export function checkoutBrowserEnvironment(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const names = new Set(['path', 'home', 'tmpdir', 'lang', 'lc_all', 'tz', 'display', 'xdg_runtime_dir']);
  if (platform === 'win32') for (const name of ['systemroot', 'windir', 'systemdrive', 'temp', 'tmp', 'localappdata', 'appdata', 'userprofile', 'programdata']) names.add(name);
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => names.has(entry[0].toLowerCase()) && typeof entry[1] === 'string'));
}

/** Dedicated browser: no tracing, screenshots, video, HAR, downloads, or request/console payload logging. */
export class StripeCheckoutDriver implements CheckoutDriver {
  private browser?: Browser; private context?: BrowserContext; private page?: Page; private checkout?: VerifiedCheckout;
  private bypass: string; private syntheticEmail: string;
  readonly blockedHosts = new Set<string>();
  readonly failedStatuses: number[] = [];
  pageErrors = 0;
  private readonly counters: Counters = { consoleErrors: 0, pageErrors: 0, httpErrors: 0, blockedRequests: 0, failedRequests: 0, unexpectedPages: 0 };
  private readonly noticeClick = new OneNativeClick();
  private readonly admitNotice?: () => Promise<void>;
  constructor(bypass: string, syntheticEmail: string, admitNotice?: () => Promise<void>) {
    if (!syntheticEmail.endsWith('@givetogive.invalid')) throw new Error('Only a synthetic fixture email is allowed.');
    if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable Playwright/debug tracing before sandbox payment execution.');
    this.bypass = bypass; this.syntheticEmail = syntheticEmail; this.admitNotice = admitNotice;
  }
  async open(checkout: VerifiedCheckout) {
    if (freemem() < 2.5 * 1024 ** 3) throw new Error('Insufficient memory for sandbox Checkout browser startup.');
    this.checkout = checkout;
    this.browser = await chromium.launch({ headless: true, env: checkoutBrowserEnvironment() });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', locale: 'en-US', viewport: { width: 1280, height: 900 } });
    this.context.on('response', response => { if (response.status() >= 400) { this.failedStatuses.push(response.status()); this.counters.httpErrors++; } });
    this.context.on('requestfailed', () => { this.counters.failedRequests++; });
    await this.context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const top = request.isNavigationRequest() && request.frame().parentFrame() === null;
      if (!allowedCheckoutRequest(request.url(), top, checkout) || (url.origin === sandboxOrigin && !['GET', 'HEAD'].includes(request.method()))) { this.blockedHosts.add(url.hostname); this.counters.blockedRequests++; await route.abort(); return; }
      // The deployment bypass never travels to Stripe or any other external host.
      await route.continue({ headers: { ...request.headers(), ...(url.origin === sandboxOrigin ? protectionHeaders(this.bypass) : {}) } });
    });
    this.context.on('page', page => { if (this.page && page !== this.page) { this.counters.unexpectedPages++; void page.close(); } });
    this.page = await this.context.newPage();
    this.page.on('pageerror', () => { this.pageErrors++; this.counters.pageErrors++; });
    this.page.on('console', message => { if (message.type() === 'error') this.counters.consoleErrors++; });
    await this.page.goto(checkout.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (new URL(this.page.url()).origin !== 'https://checkout.stripe.com') throw new Error('Unexpected Checkout origin.');
  }
  private frames(): Frame[] {
    return (this.page?.frames() ?? []).filter(frame => { try { return stripeOwnedOrigin(new URL(frame.url())); } catch { return false; } });
  }
  private async find(selector: string, timeout = 15000): Promise<Locator> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      for (const frame of this.frames()) {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) return locator;
      }
      await sleep(200);
    }
    // Do not leak provider DOM or the sensitive values a failed Playwright action may include.
    throw new Error('Expected sandbox Checkout control was not available.');
  }
  private async optionalFill(selector: string, value: string) {
    for (const frame of this.frames()) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible().catch(() => false) && await locator.isEditable().catch(() => false)) { await locator.fill(value); return; }
    }
  }
  async fillFixture(scenario: Exclude<CheckoutScenario, 'cancel'>) {
    await this.prepareReviewedSurface();
    // Selecting the visible card option changes UI only; provider configuration remains dynamic.
    if (this.page) {
      const card = this.page.getByRole('button', { name: 'Card', exact: true });
      if (await card.isVisible().catch(() => false)) await card.click();
    }
    await (await this.find('input[name="cardNumber"], input[autocomplete="cc-number"]')).fill(fixtureCards[scenario]);
    const year = String((new Date().getUTCFullYear() + 2) % 100).padStart(2, '0');
    await (await this.find('input[name="cardExpiry"], input[autocomplete="cc-exp"]')).fill(`12${year}`);
    await (await this.find('input[name="cardCvc"], input[autocomplete="cc-csc"]')).fill('123');
    await this.optionalFill('input[name="email"], input[autocomplete="email"]', this.syntheticEmail);
    await this.optionalFill('input[name="billingName"], input[autocomplete="cc-name"]', 'GiveToGive Sandbox Fixture');
    await this.optionalFill('input[name="billingPostalCode"], input[autocomplete="postal-code"]', '10001');
  }
  async submit() {
    this.memoryFloor();
    if (!this.page) throw new Error('Checkout is not open.');
    validateNativeSurface(await observeSurface(this.page, this.counters, Date.now()), Date.now());
    const submit = await this.find('button[type="submit"]');
    const label = (await submit.innerText()).trim();
    if (!/^(pay|subscribe|donate|start subscription|confirm payment)\b/i.test(label)) throw new Error('Unrecognized Checkout submit control.');
    this.memoryFloor();
    validateNativeSurface(await observeSurface(this.page, this.counters, Date.now()), Date.now());
    await submit.click();
  }
  private memoryFloor() {
    if (freemem() < 1.5 * 1024 ** 3) throw new Error('Sandbox Checkout memory floor reached.');
  }
  private async prepareReviewedSurface() {
    this.memoryFloor();
    if (!this.page) throw new Error('Checkout is not open.');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      this.memoryFloor();
      const surface = await observeSurface(this.page, this.counters, Date.now());
      if (surface.panelCount) {
        validateAcknowledgmentSurface(surface, Date.now());
        if (!this.admitNotice) throw new Error('Agent notice requires durable member-owned permission.');
        await this.admitNotice();
        validateAcknowledgmentSurface(await observeSurface(this.page, this.counters, Date.now()), Date.now());
        const control = this.page.getByRole('checkbox', { name: approved.controlName, exact: true });
        if (await control.count() !== 1 || !await control.isVisible() || !await control.isEnabled() || await control.isChecked()) throw new Error('Agent notice control changed.');
        await this.noticeClick.perform(true, new AbortController().signal, async () => { await control.click({ timeout: 5000 }); });
        await control.waitFor({ state: 'hidden', timeout: 5000 });
      } else if (surface.visibleCard) {
        validateNativeSurface(surface, Date.now()); return;
      } else if (surface.requiresCaptchaOrWalletOrAttestation || surface.unknownInstructions || surface.consoleErrors || surface.pageErrors || surface.httpErrors) {
        throw new Error('Unreviewed or unhealthy Checkout surface.');
      }
      await sleep(200);
    }
    throw new Error('Reviewed Checkout surface did not become available.');
  }
  async challenge(success: boolean) {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      for (const frame of this.frames()) {
        if (!['https://hooks.stripe.com', 'https://js.stripe.com'].includes(new URL(frame.url()).origin)) continue;
        const button = frame.getByRole('button', { name: success ? /complete authentication|authorize/i : /fail authentication|fail test/i }).first();
        if (await button.isVisible().catch(() => false)) { await button.click(); return; }
      }
      await sleep(250);
    }
    throw new Error('Stripe test authentication challenge was not available.');
  }
  async cancel() {
    if (!this.page || !this.checkout) throw new Error('Checkout is not open.');
    const links = this.page.locator('a[href]');
    for (let i = 0; i < await links.count(); i++) {
      const link = links.nth(i); const href = await link.getAttribute('href');
      if (!href) continue;
      const target = new URL(href, this.page.url());
      if (target.origin === sandboxOrigin && target.pathname === `/giving/${this.checkout.operationId}` && target.searchParams.get('checkout') === 'canceled') { await link.click(); return; }
    }
    // Closing an unpaid browser is a valid abandoned Checkout; it must NOT expire/refund a provider session implicitly.
    await this.page.close();
  }
  async close() { await this.context?.close().catch(() => undefined); await this.browser?.close().catch(() => undefined); }
}
