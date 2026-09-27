import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { allowedCheckoutRequest, sandboxOrigin, stripeOwnedOrigin, type CheckoutScenario, type VerifiedCheckout } from './sandbox-policy.ts';
import { protectionHeaders } from './protection.ts';

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

/** Dedicated browser: no tracing, screenshots, video, HAR, downloads, or request/console payload logging. */
export class StripeCheckoutDriver implements CheckoutDriver {
  private browser?: Browser; private context?: BrowserContext; private page?: Page; private checkout?: VerifiedCheckout;
  private bypass: string; private syntheticEmail: string;
  constructor(bypass: string, syntheticEmail: string) {
    if (!syntheticEmail.endsWith('@givetogive.invalid')) throw new Error('Only a synthetic fixture email is allowed.');
    if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable Playwright/debug tracing before sandbox payment execution.');
    this.bypass = bypass; this.syntheticEmail = syntheticEmail;
  }
  async open(checkout: VerifiedCheckout) {
    this.checkout = checkout;
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', locale: 'en-US', viewport: { width: 1280, height: 900 } });
    await this.context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const top = request.isNavigationRequest() && request.frame().parentFrame() === null;
      if (!allowedCheckoutRequest(request.url(), top, checkout) || (url.origin === sandboxOrigin && !['GET', 'HEAD'].includes(request.method()))) { await route.abort(); return; }
      // The deployment bypass never travels to Stripe or any other external host.
      await route.continue({ headers: { ...request.headers(), ...(url.origin === sandboxOrigin ? protectionHeaders(this.bypass) : {}) } });
    });
    this.context.on('page', page => { if (this.page && page !== this.page) void page.close(); });
    this.page = await this.context.newPage();
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
    const submit = await this.find('button[type="submit"]');
    const label = (await submit.innerText()).trim();
    if (!/^(pay|subscribe|donate|start subscription|confirm payment)\b/i.test(label)) throw new Error('Unrecognized Checkout submit control.');
    await submit.click();
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
