import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { allowedCheckoutRequest, allowedPassiveCheckoutWalletScript, sandboxOrigin, stripeOwnedOrigin, type CheckoutScenario, type VerifiedCheckout } from './sandbox-policy.ts';
import { protectionHeaders } from './protection.ts';
import { freemem } from 'node:os';
import { observeSurface, SurfaceReadUnavailable, validateAcknowledgmentSurface, validateCardSelectionSurface, validateNativeSurface, OneNativeClick, type Counters, type CheckoutSurface, type SurfaceReadPhase } from './hosted-checkout-worker.ts';
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

/** Pure DOM-wait accounting. This never refreshes a surface or provider proof. */
export function noticeObservationDeadline(deadline: number, started: number, finished: number) {
  const wait = finished - started;
  if (![deadline, started, finished, deadline + wait].every(Number.isFinite) || wait < 0 || wait > 60000)
    throw new Error('Agent notice authorization deadline exceeded.');
  return deadline + wait;
}

/** Diagnostic classification only; never grants request admission or retains URL bytes. */
export function checkoutRequestCategory(rawUrl: string, resourceType: string, topNavigation: boolean) {
  let destination: 'stripe-owned' | 'stripe-network' | 'stripe-public-checkout-cdn' | 'klarna-script' | 'hcaptcha' | 'staging' | 'google-fonts' | 'google-maps' | 'paypal' | 'link' | 'google-script' | 'cloudflare-challenge' | 'other-https' | 'unsafe-or-non-https' = 'unsafe-or-non-https';
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')) {
      if (stripeOwnedOrigin(url)) destination = 'stripe-owned';
      // Exact literal from Stripe's anonymously readable Checkout bootstrap.
      // This is observation only; it does not permit any CloudFront request.
      else if (url.hostname === 'd37ugbyn3rpeym.cloudfront.net') destination = 'stripe-public-checkout-cdn';
      else if (['js.klarna.com', 'js.playground.klarna.com'].includes(url.hostname)) destination = 'klarna-script';
      else if (url.hostname === 'stripe.network' || url.hostname.endsWith('.stripe.network')) destination = 'stripe-network';
      else if (url.hostname === 'hcaptcha.com' || url.hostname.endsWith('.hcaptcha.com')) destination = 'hcaptcha';
      else if (url.origin === sandboxOrigin) destination = 'staging';
      else if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) destination = 'google-fonts';
      else if (['maps.googleapis.com', 'maps.gstatic.com'].includes(url.hostname)) destination = 'google-maps';
      else if (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com') || url.hostname === 'paypalobjects.com' || url.hostname.endsWith('.paypalobjects.com')) destination = 'paypal';
      else if (url.hostname === 'link.com' || url.hostname.endsWith('.link.com')) destination = 'link';
      else if (['www.google.com', 'www.gstatic.com'].includes(url.hostname)) destination = 'google-script';
      else if (url.hostname === 'challenges.cloudflare.com') destination = 'cloudflare-challenge';
      else destination = 'other-https';
    }
  } catch { /* Only the fixed invalid category survives. */ }
  const resource = ['document', 'script', 'stylesheet', 'image', 'font', 'xhr', 'fetch', 'websocket'].includes(resourceType) ? resourceType : 'other';
  return { destination, resource, topNavigation };
}
export function checkoutFailureCategory(errorText: string | undefined) {
  if (errorText === 'net::ERR_ABORTED') return 'aborted';
  if (errorText === 'net::ERR_BLOCKED_BY_CLIENT') return 'blocked';
  if (errorText === 'net::ERR_TIMED_OUT') return 'timeout';
  if (['net::ERR_CONNECTION_RESET', 'net::ERR_CONNECTION_CLOSED', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_NAME_NOT_RESOLVED'].includes(errorText ?? '')) return 'connection';
  return 'other';
}

/** Genuine hosted Checkout cancels an invisible hCaptcha background GET while
 * its ordinary card selector renders. A canceled GET has no response/token to
 * use. Never exempt a POST, document, blocked/failed/timeout, wallet/provider
 * payment request, or visible challenge; surface challenge guards still apply. */
export function checkoutNonBlockingAbort(rawUrl: string, resourceType: string, method: string, topNavigation: boolean, errorText: string | undefined) {
  if (topNavigation || method !== 'GET' || !['fetch', 'xhr'].includes(resourceType) || errorText !== 'net::ERR_ABORTED') return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (url.hostname === 'hcaptcha.com' || url.hostname.endsWith('.hcaptcha.com'));
  } catch { return false; }
}
/** Only a short alphabetic DNS suffix, never a subdomain, URL or identifier.
 * Not a public-suffix/ownership assertion and never a request-admission rule. */
export function checkoutDependencySuffix(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return 'withheld';
    const suffix = url.hostname.split('.').slice(-2).join('.');
    return /^[a-z](?:[a-z-]{0,30}[a-z])?\.[a-z]{2,12}$/.test(suffix) ? suffix : 'withheld';
  } catch { return 'withheld'; }
}
/** Fixed public SDK endpoint families only. Never retain merchant IDs, full
 * paths, query values or request bodies, and never grant network admission. */
export function checkoutWalletDependency(rawUrl: string, method: string) {
  let endpoint: 'apple-static-module' | 'amazon-static-sdk' | 'apple-merchant-status' | 'unclassified' = 'unclassified';
  let hasQuery = false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')) {
      hasQuery = Boolean(url.search);
      if (url.hostname === 'applepay.cdn-apple.com' && /^\/jsapi\/(?:v?1(?:\.\d+\.\d+)?|1\.latest)\/(?:apple-pay-sdk|apple-pay-button|apple-wallet-sdk)\.js$/.test(url.pathname)) endpoint = 'apple-static-module';
      else if (['static-na.payments-amazon.com', 'static-eu.payments-amazon.com', 'static-fe.payments-amazon.com'].includes(url.hostname) && ['/checkout.js', '/cPSPcheckout.js'].includes(url.pathname)) endpoint = 'amazon-static-sdk';
      else if (url.hostname === 'smp-paymentservices.apple.com' && url.pathname.startsWith('/paymentservices/v3/checkStatus/merchant/')) endpoint = 'apple-merchant-status';
    }
  } catch { /* Unknown URLs never become diagnostic strings. */ }
  return { endpoint, method: ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(method) ? method : 'other', hasQuery };
}

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
  private readonly cardSelectionClick = new OneNativeClick();
  private lastSurface?: CheckoutSurface;
  private observedFreeBytes?: number;
  private surfaceReadFailure?: 'policy_rejected' | 'dom_read_unavailable';
  private surfaceReadPhase?: SurfaceReadPhase;
  private readonly blockedRequestCategories = new Map<string, { category: ReturnType<typeof checkoutRequestCategory>; reason: 'destination-policy' | 'staging-write'; domainSuffix: string; walletDependency: ReturnType<typeof checkoutWalletDependency>; count: number }>();
  private readonly failedRequestCategories = new Map<string, { category: ReturnType<typeof checkoutRequestCategory>; failure: ReturnType<typeof checkoutFailureCategory>; count: number }>();
  private readonly admitNotice?: () => Promise<void>;
  constructor(bypass: string, syntheticEmail: string, admitNotice?: () => Promise<void>) {
    if (!syntheticEmail.endsWith('@givetogive.invalid')) throw new Error('Only a synthetic fixture email is allowed.');
    if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable Playwright/debug tracing before sandbox payment execution.');
    this.bypass = bypass; this.syntheticEmail = syntheticEmail; this.admitNotice = admitNotice;
  }
  /** Acquire the real, secret-free browser before a caller admits a financial UI mutation. */
  async prepareBrowser() {
    if (this.browser) { this.memoryFloor(); return; }
    this.observedFreeBytes = freemem();
    if (this.observedFreeBytes < 2.5 * 1024 ** 3) throw new Error('Insufficient memory for sandbox Checkout browser startup.');
    this.browser = await chromium.launch({ headless: true, env: checkoutBrowserEnvironment() });
    this.memoryFloor();
  }
  /** Waiting member starts with no staging credential. Bind access once, only
   * after its real browser exists and before any Checkout context/navigation. */
  bindPreparedStagingAccess(bypass:string) {
    if (this.bypass || !this.browser?.isConnected() || this.context || this.checkout ||
        typeof bypass!=='string' || bypass.length<16 || bypass.length>2048)
      throw new Error('Prepared Checkout access binding rejected.');
    this.bypass=bypass;
  }
  preparedBrowserObservation() {
    this.memoryFloor();
    return { browserConnected:!!this.browser?.isConnected(),contextAbsent:!this.context,checkoutAbsent:!this.checkout,
      freeBytes:this.observedFreeBytes!,paymentAccepted:false as const };
  }
  async open(checkout: VerifiedCheckout) {
    await this.prepareBrowser();
    if (!this.browser || this.context || this.checkout) throw new Error('Checkout browser is unavailable or already bound.');
    this.checkout = checkout;
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', locale: 'en-US', viewport: { width: 1280, height: 900 } });
    this.context.on('response', response => { if (response.status() >= 400) { this.failedStatuses.push(response.status()); this.counters.httpErrors++; } });
    this.context.on('requestfailed', request => {
      this.counters.failedRequests++;
      if (checkoutNonBlockingAbort(request.url(), request.resourceType(), request.method(), request.isNavigationRequest(), request.failure()?.errorText))
        this.counters.nonBlockingRequestAborts = (this.counters.nonBlockingRequestAborts ?? 0) + 1;
      const category = checkoutRequestCategory(request.url(), request.resourceType(), request.isNavigationRequest() && request.frame().parentFrame() === null);
      const failure = checkoutFailureCategory(request.failure()?.errorText), key = JSON.stringify({ category, failure });
      const previous = this.failedRequestCategories.get(key);
      this.failedRequestCategories.set(key, { category, failure, count: (previous?.count ?? 0) + 1 });
    });
    await this.context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const top = request.isNavigationRequest() && request.frame().parentFrame() === null;
      const destinationRejected = !allowedCheckoutRequest(request.url(), top, checkout) &&
        !allowedPassiveCheckoutWalletScript(request.url(), top, request.resourceType(), request.method());
      if (destinationRejected || (url.origin === sandboxOrigin && !['GET', 'HEAD'].includes(request.method()))) {
        this.blockedHosts.add(url.hostname); this.counters.blockedRequests++;
        const category = checkoutRequestCategory(request.url(), request.resourceType(), top);
        // Keep dynamic suffix storage bounded even on a hostile provider page.
        const domainSuffix = this.blockedRequestCategories.size < 32 ? checkoutDependencySuffix(request.url()) : 'withheld';
        const walletDependency = checkoutWalletDependency(request.url(), request.method());
        const reason = destinationRejected ? 'destination-policy' : 'staging-write', key = JSON.stringify({ category, reason, domainSuffix, walletDependency });
        const previous = this.blockedRequestCategories.get(key);
        this.blockedRequestCategories.set(key, { category, reason, domainSuffix, walletDependency, count: (previous?.count ?? 0) + 1 });
        await route.abort(); return;
      }
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
    this.observedFreeBytes = freemem();
    if (this.observedFreeBytes < 1.5 * 1024 ** 3) throw new Error('Sandbox Checkout memory floor reached.');
  }
  private async readSurface() {
    this.memoryFloor();
    if (!this.page) throw new Error('Checkout is not open.');
    try {
      this.lastSurface = await observeSurface(this.page, this.counters, Date.now(), { cardChoice: true });
      this.surfaceReadFailure = undefined;
      this.surfaceReadPhase = undefined;
    } catch (error) {
      this.surfaceReadFailure = error instanceof Error && error.message === 'Hosted Checkout policy rejected; private details withheld.' ? 'policy_rejected' : 'dom_read_unavailable';
      this.surfaceReadPhase = error instanceof SurfaceReadUnavailable ? error.phase : undefined;
      if (error instanceof SurfaceReadUnavailable) throw error;
      throw new Error('Checkout surface observation failed; private details withheld.');
    }
    return this.lastSurface;
  }
  /** Fixed booleans/counters only. No DOM text, control label, URL, PAN or response body. */
  diagnostics() {
    const surface = this.lastSurface;
    return { ...this.counters, noticeClickAttempts: this.noticeClick.attempts, cardSelectionClickAttempts: this.cardSelectionClick.attempts,
      blockedRequestCategories: [...this.blockedRequestCategories.values()], failedRequestCategories: [...this.failedRequestCategories.values()],
      ...(this.observedFreeBytes === undefined ? {} : { observedFreeMiB: Math.floor(this.observedFreeBytes / 1024 ** 2), runtimeMemoryFloorSatisfied: this.observedFreeBytes >= 1.5 * 1024 ** 3 }),
      ...(this.surfaceReadFailure ? { surfaceReadFailure: this.surfaceReadFailure } : {}),
      ...(this.surfaceReadPhase ? { surfaceReadPhase: this.surfaceReadPhase } : {}),
      surfaceObserved: !!surface, ...(surface ? {
        testModeLabel: surface.testModeLabel, visibleCard: surface.visibleCard,
        cardChoiceCount: surface.cardChoiceCount, cardChoiceVisible: surface.cardChoiceVisible, cardChoiceEnabled: surface.cardChoiceEnabled,
        panelCount: surface.panelCount, reviewedPanelMatches: surface.panelDigest === approved.panelDigest,
        reviewedControlMatches: surface.controlName === approved.controlName,
        controlCount: surface.controlCount, visible: surface.visible, enabled: surface.enabled, unchecked: surface.unchecked,
        requiresCaptchaOrWalletOrAttestation: surface.requiresCaptchaOrWalletOrAttestation,
        unknownInstructions: surface.unknownInstructions,
      } : {}) };
  }
  /** Read-only inspection of an existing owned session; never fills or clicks a control. */
  async inspectSurface(timeoutMs = 15000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid bounded surface observation.');
    const deadline = Date.now() + timeoutMs;
    let frameReadUnavailable = false;
    while (Date.now() < deadline) {
      let surface: CheckoutSurface;
      try { surface = await this.readSurface(); frameReadUnavailable = false; }
      catch (error) {
        // Read-only mode can reread a changing frame tree. Financial/notice
        // action paths still stop on the first failure; no guard is weakened.
        if (!(error instanceof SurfaceReadUnavailable) || error.phase !== 'frame-discovery') throw error;
        frameReadUnavailable = true; await sleep(200); continue;
      }
      if (surface.panelCount || surface.visibleCard || surface.cardChoiceCount || surface.unknownInstructions || surface.requiresCaptchaOrWalletOrAttestation) break;
      await sleep(200);
    }
    if (frameReadUnavailable) throw new SurfaceReadUnavailable('frame-discovery');
    return this.diagnostics();
  }
  private async prepareReviewedSurface() {
    this.memoryFloor();
    if (!this.page) throw new Error('Checkout is not open.');
    let deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      this.memoryFloor();
      const surface = await this.readSurface();
      if (surface.panelCount) {
        validateAcknowledgmentSurface(surface, Date.now());
        if (!this.admitNotice) throw new Error('Agent notice requires durable member-owned permission.');
        const authorizationStarted = Date.now();
        await this.admitNotice();
        // The root authorization has its own deadline and fresh proof. It is
        // not DOM settling time; reobserve the real surface before one click.
        deadline = noticeObservationDeadline(deadline, authorizationStarted, Date.now());
        validateAcknowledgmentSurface(await this.readSurface(), Date.now());
        const control = this.page.getByRole('checkbox', { name: approved.controlName, exact: true });
        if (await control.count() !== 1 || !await control.isVisible() || !await control.isEnabled() || await control.isChecked()) throw new Error('Agent notice control changed.');
        await this.noticeClick.perform(true, new AbortController().signal, async () => { await control.click({ timeout: 5000 }); });
        await control.waitFor({ state: 'hidden', timeout: 5000 });
      } else if (surface.visibleCard) {
        validateNativeSurface(surface, Date.now()); return;
      } else if (surface.cardChoiceCount && this.cardSelectionClick.attempts === 0) {
        validateCardSelectionSurface(surface, Date.now());
        let choice: Locator | undefined;
        for (const frame of this.frames()) {
          const choices = frame.getByRole(surface.cardChoiceKind ?? 'button', { name: 'Card', exact: true });
          const count = await choices.count();
          if (count > 16) throw new Error('Card choice bound exceeded.');
          for (let index = 0; index < count; index++) {
            const candidate = choices.nth(index);
            if (await candidate.isVisible()) {
              if (choice || !await candidate.isEnabled() || (surface.cardChoiceKind === 'radio' && await candidate.isChecked())) throw new Error('Card choice changed.');
              choice = candidate;
            }
          }
        }
        if (!choice) throw new Error('Card choice disappeared.');
        const beforeClick = await this.readSurface(); validateCardSelectionSurface(beforeClick, Date.now());
        if (beforeClick.cardChoiceKind !== surface.cardChoiceKind) throw new Error('Card choice changed.');
        await this.cardSelectionClick.perform(true, new AbortController().signal, async () => { await choice!.click({ timeout: 5000 }); });
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
  /** Protocol closure evidence only. Parent must independently prove OS closure.
   * Failed closes retain their handles and never become a positive receipt. */
  async closeConfirmed() {
    let contextClosed=!this.context,browserClosed=!this.browser;
    try {if(this.context){await this.context.close();contextClosed=true;this.context=undefined;}}catch{/* No private error text. */}
    try {if(this.browser){await this.browser.close();browserClosed=true;this.browser=undefined;}}catch{/* OS verification remains required. */}
    if(contextClosed&&browserClosed)this.page=undefined;
    return {contextClosed,browserClosed,independentOsClosureRequired:true as const,paymentAccepted:false as const};
  }
  async close() {
    const result=await this.closeConfirmed();
    if(!result.contextClosed||!result.browserClosed)
      throw new Error('Checkout protocol closure is unconfirmed; independent cleanup required.');
  }
}
