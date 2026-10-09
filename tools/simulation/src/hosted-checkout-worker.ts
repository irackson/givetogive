/** Inert member-only adapter. Calling runHostedCheckoutMember is an explicit runtime operation.
 * No provider SDK, filesystem, environment, key, privileged token or executable entrypoint.
 * Broker receipts are external evidence, NEVER proof of writes performed by this module. */
import { randomBytes } from 'node:crypto';
import { freemem } from 'node:os';
import superjson from 'superjson';
import type { APIRequestContext, Browser, BrowserContext, BrowserType, Frame, Locator, Page, Request, Route } from 'playwright';
import { approved, limits, requirePolicy, validateInput, validateIdentity, validateProof, checkMemory,
	memberCallAllowed, requestAllowed, normalAuthBodyAllowed, bypassDestinationAllowed, NormalAuthAdmission,
	type Identity, type Proof } from './hosted-checkout-policy.ts';
import { CheckoutProtocol } from './hosted-checkout-protocol.ts';

export interface CheckoutMemberBroker {
	/** Must exclusively fsync ORIGINAL bytes before replying; the parent must verify its implementation. */
	writeIntent(intent: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown>;
	/** Must retain encrypted original submit intent in the private draft BEFORE replying. No keys enter this worker. */
	retainSubmitIntent(intent: Readonly<Record<string, unknown>>, durable: unknown, signal: AbortSignal):
		Promise<{ acknowledgment: unknown; ciphertextDigest: string }>;
	/** A fresh locally obtained provider/account/clock proof, not a provider call from this worker. */
	preSubmitProof(signal: AbortSignal): Promise<unknown>;
}
export interface CheckoutWorkerRuntime {
	/** Injection is OFFLINE test evidence only, never actual Chromium/host execution proof. */
	loadBrowserType(): Promise<BrowserType>;
	now(): number;
	freeBytes(): number;
}
type Phase = 'sign-in' | 'opening' | 'acknowledgment' | 'fixture' | 'submission' | 'observation' | 'cleanup';
export interface CheckoutSurface {
	observedAt: string; testModeLabel: boolean; visibleCard: boolean; panelCount: number;
	panelDigest: string | null; controlName: string; controlCount: number; visible: boolean;
	enabled: boolean; unchecked: boolean; optionalLinkDeferred: true;
	requiresCaptchaOrWalletOrAttestation: boolean; unknownInstructions: boolean;
	cardChoiceCount?: number; cardChoiceVisible?: boolean; cardChoiceEnabled?: boolean;
	consoleErrors: number; pageErrors: number; httpErrors: number;
}
export type Counters = { consoleErrors: number; pageErrors: number; httpErrors: number; blockedRequests: number; failedRequests: number; unexpectedPages: number };
const cardFields = {
	number: 'input[name="cardNumber"],input[autocomplete="cc-number"]',
	expiry: 'input[name="cardExpiry"],input[autocomplete="cc-exp"]',
	cvc: 'input[name="cardCvc"],input[autocomplete="cc-csc"]',
};
const fixedError = () => new Error('Hosted Checkout member adapter stopped; private details withheld.');
function object(raw: unknown): Record<string, unknown> {
	requirePolicy(!!raw && typeof raw === 'object' && !Array.isArray(raw)); return raw as Record<string, unknown>;
}
function sessionVersion(raw: unknown, now: number) {
	const session = object(raw), user = object(session.user);
	requirePolicy(session.access === 'active' && user.id === approved.actorId && user.role === 'member'
		&& user.email === approved.memberEmail && Number.isSafeInteger(user.sessionVersion) && Number(user.sessionVersion) >= 0
		&& typeof session.expires === 'string' && Date.parse(session.expires) > now + limits.expiryHeadroomMs
		&& Number.isFinite(user.authenticatedAt) && Number(user.authenticatedAt) <= now + limits.futureSkewMs);
	return Number(user.sessionVersion);
}
/** Derives identity from actual normal session and successful billing-management GET results.
 * Those endpoints revalidate current email verification, freeze and session version in the app.
 * This pure helper itself performs NO authentication and cannot prove its inputs were fetched. */
export function deriveMemberIdentity(before: unknown, after: unknown, availability: unknown,
	overview: unknown, subscriptions: unknown, payment: unknown, proof: Proof, now: number, nonce: string): Identity {
	const first = sessionVersion(before, now), last = sessionVersion(after, now);
	const gates = object(availability), account = object(overview), owned = object(payment);
	requirePolicy(first === last && gates.environment === 'staging' && gates.livemode === false
		&& gates.subscriptions === true && gates.askPayments === false && gates.funds === false
		&& account.tier === 'neighbor' && Array.isArray(account.subscriptions) && account.subscriptions.length === 0
		&& Array.isArray(subscriptions) && subscriptions.length === 0
		&& owned.id === approved.operationId && owned.kind === 'supporter' && owned.status === 'checkout_open'
		&& owned.grossAmount === 1500 && owned.currency === 'usd' && owned.tier === 'sustainer'
		&& owned.recurring === true && owned.livemode === false && owned.paidAt === null
		&& owned.refundedAmount === 0 && owned.disputedAmount === 0
		&& (typeof owned.expiresAt === 'string' || owned.expiresAt instanceof Date)
		&& Math.floor(new Date(owned.expiresAt as string | Date).getTime() / 1000) === proof.expiresAt);
	return validateIdentity({ userId: approved.actorId, verified: true, frozen: false, role: 'member', tier: 'neighbor',
		subscriptions: 0, environment: 'staging', livemode: false, supporterEnabled: true,
		askPaymentsEnabled: false, fundsEnabled: false, observedAt: new Date(now).toISOString(),
		sessionVersion: last, verificationNonce: nonce, independentNormalSession: true }, now);
}
export function queryAddress(procedure: string, input?: unknown): string {
	requirePolicy(memberCallAllowed('GET', procedure, input));
	return `${approved.origin}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;
}
/** Header transport, not authorization. Never allow the staging bypass to reach Stripe or redirects. */
export function scopedHeaders(rawUrl: string, original: Record<string, string>, bypass: string): Record<string, string> {
	const headers = Object.fromEntries(Object.entries(original).filter(([key]) => key.toLowerCase() !== 'x-vercel-protection-bypass'));
	if (bypassDestinationAllowed(rawUrl)) headers['x-vercel-protection-bypass'] = bypass;
	return headers;
}
/** Consume permission before awaiting the native control. An error/abort NEVER permits a second click. */
export class OneNativeClick {
	private consumed = false;
	async perform(admitted: boolean, signal: AbortSignal, nativeClick: () => Promise<void>): Promise<void> {
		requirePolicy(admitted && !this.consumed && !signal.aborted); this.consumed = true;
		await nativeClick(); requirePolicy(!signal.aborted);
	}
	get attempts() { return Number(this.consumed); }
}
/** Immediately-before-click check; unknown/stale/changed surface is never grandfathered in. */
export function validateNativeSurface(raw: unknown, now: number): void {
	const value = object(raw), time = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
	requirePolicy(Number.isFinite(now) && Number.isFinite(time) && now - time >= -limits.futureSkewMs && now - time <= limits.surfaceAgeMs
		&& value.testModeLabel === true && value.visibleCard === true && value.panelCount === 0 && value.panelDigest === null
		&& value.controlCount === 0 && value.controlName === '' && value.visible === false && value.enabled === false && value.unchecked === false
		&& value.optionalLinkDeferred === true && value.requiresCaptchaOrWalletOrAttestation === false && value.unknownInstructions === false
		&& value.consoleErrors === 0 && value.pageErrors === 0 && value.httpErrors === 0);
}
export function validateAcknowledgmentSurface(raw: unknown, now: number): void {
	const value = object(raw), time = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
	requirePolicy(Number.isFinite(now) && Number.isFinite(time) && now - time >= -limits.futureSkewMs && now - time <= limits.surfaceAgeMs
		&& value.panelCount === 1 && value.panelDigest === approved.panelDigest && value.controlCount === 1
		&& value.controlName === approved.controlName && value.visible === true && value.enabled === true && value.unchecked === true
		&& value.optionalLinkDeferred === true && value.requiresCaptchaOrWalletOrAttestation === false && value.unknownInstructions === false
		&& value.consoleErrors === 0 && value.pageErrors === 0 && value.httpErrors === 0);
}
/** Selecting the visible Card option reveals fields, not a payment submission.
 * This separate guard must never manufacture visibleCard for native admission. */
export function validateCardSelectionSurface(raw: unknown, now: number): void {
	const value = object(raw), time = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
	requirePolicy(Number.isFinite(now) && Number.isFinite(time) && now - time >= -limits.futureSkewMs && now - time <= limits.surfaceAgeMs
		&& value.testModeLabel === true && value.visibleCard === false && value.panelCount === 0 && value.panelDigest === null
		&& value.controlCount === 0 && value.controlName === '' && value.visible === false && value.enabled === false && value.unchecked === false
		&& value.optionalLinkDeferred === true && value.requiresCaptchaOrWalletOrAttestation === false && value.unknownInstructions === false
		&& value.consoleErrors === 0 && value.pageErrors === 0 && value.httpErrors === 0
		&& value.cardChoiceCount === 1 && value.cardChoiceVisible === true && value.cardChoiceEnabled === true);
}
function ownedProvider(raw: string): boolean {
	try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password
		&& (!url.port || url.port === '443') && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')
			|| url.hostname === 'stripecdn.com' || url.hostname.endsWith('.stripecdn.com')); } catch { return false; }
}
async function visibleFrames(page: Page): Promise<Frame[]> {
	const frames = page.frames(); requirePolicy(frames.length <= 32);
	const result: Frame[] = [];
	for (const frame of frames) {
		if (!ownedProvider(frame.url())) continue;
		if (frame.parentFrame()) {
			const element = await frame.frameElement();
			try { if (!await element.isVisible()) continue; } finally { await element.dispose(); }
		}
		result.push(frame);
	}
	requirePolicy(result.length > 0); return result;
}
async function uniqueVisible(frames: Frame[], selector: string, optional = false): Promise<Locator | undefined> {
	let found: Locator | undefined;
	for (const frame of frames) {
		const candidates = frame.locator(selector); const count = await candidates.count(); requirePolicy(count <= 16);
		for (let index = 0; index < count; index++) {
			const candidate = candidates.nth(index);
			if (!await candidate.isVisible()) continue;
			requirePolicy(!found && await candidate.isEnabled() && await candidate.isEditable()); found = candidate;
		}
	}
	requirePolicy(optional || !!found); return found;
}
/** DOM read only: compute redacted panel digest in the provider frame; return no DOM text/URLs. */
export async function observeSurface(page: Page, counters: Counters, now: number, options: { cardChoice?: boolean } = {}): Promise<CheckoutSurface> {
	const observation: { phase: SurfaceReadPhase } = { phase: 'frame-discovery' };
	try { return await observeSurfaceBody(page, counters, now, observation, options); }
	catch (error) {
		if (error instanceof Error && error.message === 'Hosted Checkout policy rejected; private details withheld.') throw error;
		// Never retain the Playwright cause: it can contain private URLs or DOM values.
		throw new SurfaceReadUnavailable(observation.phase);
	}
}
export type SurfaceReadPhase = 'frame-discovery' | 'panel-dom' | 'card-controls';
export class SurfaceReadUnavailable extends Error {
	readonly phase: SurfaceReadPhase;
	constructor(phase: SurfaceReadPhase) {
		super('Checkout DOM read unavailable; private details withheld.');
		this.phase = phase;
	}
}
async function observeSurfaceBody(page: Page, counters: Counters, now: number, observation: { phase: SurfaceReadPhase }, options: { cardChoice?: boolean }): Promise<CheckoutSurface> {
	const frames = await visibleFrames(page);
	let panelCount = 0, controlCount = 0, panelDigest: string | null = null;
	let testModeLabel = false, unknownInstructions = false, challenge = false, visible = false, enabled = false, unchecked = false, controlName = '';
	for (const frame of frames) {
		observation.phase = 'panel-dom';
		const read = await frame.evaluate(async () => {
			// An object method remains self-contained under tsx's keep-names transform.
			// A named arrow here injects an external __name helper into browser code.
			const visibility = { isVisible(element: Element) {
				const box = element.getBoundingClientRect(), style = getComputedStyle(element);
				return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
			} };
			const panels = [...document.querySelectorAll<HTMLElement>('.AiAgentPaymentSteering')].filter(visibility.isVisible);
			let hash: string | null = null, label = '', controls = 0, enabledControl = false, uncheckedControl = false;
			if (panels.length === 1) {
				const text = panels[0]!.innerText.replace(/https?:\/\/\S+/g, '[url]')
					.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[email]')
					.replace(/(?:acct_|cs_|pk_|sk_|rk_)[A-Za-z0-9_]+/g, '[provider-id]')
					.replace(/\b(?:\d[ -]?){12,19}\b/g, '[number]').replace(/\s+/g, ' ').trim();
				if (text.length <= 4000) {
					const bytes = new TextEncoder().encode(text);
					hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
				}
				const inputs = [...panels[0]!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(visibility.isVisible);
				controls = inputs.length;
				if (controls === 1) {
					const input = inputs[0]!, labels = [...(input.labels ?? [])];
					label = labels.length === 1 ? labels[0]!.innerText.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
					enabledControl = !input.disabled; uncheckedControl = !input.checked;
				}
			}
			const body = document.body?.innerText ?? '';
			if (body.length > 1024 * 1024) throw new Error('Surface bound exceeded.');
			const remaining = body.replace(panels[0]?.innerText ?? '\u0000', '');
			const unknown = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alert"]')]
				.some(element => visibility.isVisible(element) && !element.closest('.AiAgentPaymentSteering'))
				|| /(?:instructions for (?:ai|automated) agents|agent instructions|confirm your attestation)/i.test(remaining);
			const needsChallenge = /(?:verify (?:that )?you(?:'re| are) human|enter (?:the )?(?:one.time|verification) code|approve (?:in|with) your wallet)/i.test(remaining)
				|| [...document.querySelectorAll('[data-hcaptcha-response],iframe[src*="hcaptcha"],iframe[src*="recaptcha"]')].some(visibility.isVisible);
			return { panels: panels.length, hash, controls, label, enabledControl, uncheckedControl,
				testMode: /test[\s-]*mode/i.test(body), unknown, needsChallenge };
		});
		panelCount += read.panels; controlCount += read.controls; testModeLabel ||= read.testMode;
		unknownInstructions ||= read.unknown; challenge ||= read.needsChallenge;
		if (read.panels === 1) { panelDigest = read.hash; controlName = read.label; visible = read.controls === 1; enabled = read.enabledControl; unchecked = read.uncheckedControl; }
	}
	// A notice can visibly disable the underlying card fields. Observe its own
	// controls first; editable/unique card controls become mandatory only after
	// that notice is absent. Unknown or duplicate notices still fail validation.
	observation.phase = 'card-controls';
	const cards = panelCount ? undefined : await uniqueVisible(frames, cardFields.number, true);
	const expiry = panelCount ? undefined : await uniqueVisible(frames, cardFields.expiry, true);
	const cvc = panelCount ? undefined : await uniqueVisible(frames, cardFields.cvc, true);
	let cardChoiceCount = 0, cardChoiceEnabled = false;
	for (const frame of options.cardChoice ? frames : []) {
		const choices = frame.getByRole('button', { name: 'Card', exact: true });
		const count = await choices.count(); requirePolicy(count <= 16);
		for (let index = 0; index < count; index++) {
			const choice = choices.nth(index);
			if (await choice.isVisible()) { cardChoiceCount++; cardChoiceEnabled = await choice.isEnabled(); }
		}
	}
	return { observedAt: new Date(now).toISOString(), testModeLabel, visibleCard: !!cards && !!expiry && !!cvc,
		...(options.cardChoice ? { cardChoiceCount, cardChoiceVisible: cardChoiceCount > 0, cardChoiceEnabled } : {}),
		panelCount, panelDigest, controlName, controlCount, visible, enabled, unchecked, optionalLinkDeferred: true,
		requiresCaptchaOrWalletOrAttestation: challenge, unknownInstructions,
		consoleErrors: counters.consoleErrors, pageErrors: counters.pageErrors,
		httpErrors: counters.httpErrors + counters.blockedRequests + counters.failedRequests + counters.unexpectedPages };
}

/** Every operation and late-created resource is fenced by the same abort/deadline. */
class BoundedRun {
	readonly controller = new AbortController();
	private timer: ReturnType<typeof setTimeout>;
	private parent?: AbortSignal;
	private abort = () => this.controller.abort();
	constructor(parent?: AbortSignal) {
		this.parent = parent; parent?.addEventListener('abort', this.abort, { once: true });
		if (parent?.aborted) this.abort(); this.timer = setTimeout(this.abort, 180000);
	}
	check() { requirePolicy(!this.controller.signal.aborted); }
	async wait<T>(pending: Promise<T>): Promise<T> {
		this.check(); const signal = this.controller.signal;
		let stop: () => void = () => {};
		try { return await Promise.race([pending, new Promise<never>((__resolve, rejectPromise) => {
			stop = () => rejectPromise(fixedError()); signal.addEventListener('abort', stop, { once: true });
			if (signal.aborted) stop();
		})]); } finally { signal.removeEventListener('abort', stop); }
	}
	async perform<T>(operation: () => Promise<T>): Promise<T> { this.check(); return this.wait(operation()); }
	finish() { clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.abort); }
}
async function boundedClose(action: () => Promise<void>): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try { await Promise.race([action(), new Promise<never>((__resolve, rejectPromise) => {
		timer = setTimeout(() => rejectPromise(fixedError()), 10000);
	})]); return true; } catch { return false; } finally { clearTimeout(timer); }
}

export async function runHostedCheckoutMember(raw: unknown, expectedHead: string,
	options: { broker: CheckoutMemberBroker; signal?: AbortSignal; runtime?: CheckoutWorkerRuntime }) {
	const injected = !!options.runtime;
	const runtime: CheckoutWorkerRuntime = options.runtime ?? {
		loadBrowserType: async () => (await import('playwright')).chromium, now: Date.now, freeBytes: freemem,
	};
	const run = new BoundedRun(options.signal), signal = run.controller.signal;
	let protocol: CheckoutProtocol | undefined, browser: Browser | undefined, context: BrowserContext | undefined;
	let api: APIRequestContext | undefined, page: Page | undefined, phase: Phase = 'sign-in';
	let launchPending = false, contextPending = false, failed = false, browserClosed = false, contextClosed = false, apiDisposed = false;
	const counters: Counters = { consoleErrors: 0, pageErrors: 0, httpErrors: 0, blockedRequests: 0, failedRequests: 0, unexpectedPages: 0 };
	const ackClick = new OneNativeClick(), submitClick = new OneNativeClick(), listeners: (() => void | Promise<void>)[] = [];
	let browserClosing: Promise<boolean> | undefined, contextClosing: Promise<boolean> | undefined, apiClosing: Promise<boolean> | undefined;
	const closeApi = (owned: APIRequestContext) => apiClosing ??= boundedClose(() => owned.dispose());
	const closeContext = (owned: BrowserContext) => contextClosing ??= boundedClose(() => owned.close());
	const closeBrowser = (owned: Browser) => browserClosing ??= boundedClose(() => owned.close()).then(closed => closed && !owned.isConnected()).catch(() => false);
	let authPosts = 0, memberGets = 0, sessionGets = 0;
	try {
		run.check(); requirePolicy(injected || (process.platform === 'linux' && process.versions.node.split('.')[0] === '24'));
		const input = validateInput(raw, expectedHead, runtime.now()); checkMemory(runtime.freeBytes(), true);
		protocol = new CheckoutProtocol(input.manifest, expectedHead, runtime.now());
		const browserType = await run.wait(runtime.loadBrowserType()); run.check();
		launchPending = true;
		const launching = browserType.launch({ headless: true, timeout: 30000 });
		void launching.then(async owned => { browser = owned; launchPending = false;
			if (signal.aborted) browserClosed = await closeBrowser(owned);
		}, () => { launchPending = false; });
		browser = await run.wait(launching); run.check();
		contextPending = true;
		const creating = browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', acceptDownloads: false });
		void creating.then(async owned => { context = owned; api = owned.request; contextPending = false;
			if (signal.aborted) { apiDisposed = await closeApi(owned.request); contextClosed = await closeContext(owned); }
		}, () => { contextPending = false; });
		context = await run.wait(creating); api = context.request; run.check();
		const requestJson = async (url: string, method = 'GET', data?: string): Promise<unknown> => {
			run.check(); checkMemory(runtime.freeBytes(), false);
			requirePolicy(new URL(url).origin === approved.origin && requestAllowed(url, method, false, approved.origin, phase,
				undefined, undefined, input.proof.sessionId, data));
			const response = await run.wait(api!.fetch(url, { method, data, maxRedirects: 0, maxRetries: 0, timeout: 15000,
				headers: scopedHeaders(url, { accept: 'application/json', ...(method === 'POST' ? {
					'content-type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1',
				} : {}) }, input.stagingBypass) }));
			let bytes: Buffer | undefined;
			try {
				requirePolicy(response.status() === 200 && new URL(response.url()).origin === approved.origin);
				const length = response.headers()['content-length']; if (length) requirePolicy(/^\d+$/.test(length) && Number(length) <= limits.inputBytes);
				bytes = await run.wait(response.body()); requirePolicy(bytes.length <= limits.inputBytes); run.check();
				return JSON.parse(bytes.toString('utf8')) as unknown;
			} finally { bytes?.fill(0); requirePolicy(await boundedClose(() => response.dispose())); }
		};
		const csrf = object(await requestJson(`${approved.origin}/api/auth/csrf`));
		requirePolicy(typeof csrf.csrfToken === 'string' && csrf.csrfToken.length > 0 && csrf.csrfToken.length <= 256);
		const form = new URLSearchParams({ csrfToken: csrf.csrfToken, email: input.member.email, password: input.member.password,
			callbackUrl: `${approved.origin}/asks` }).toString();
		requirePolicy(normalAuthBodyAllowed('POST', '/api/auth/callback/credentials', phase, form));
		new NormalAuthAdmission().admit('POST', '/api/auth/callback/credentials', phase); authPosts++;
		await requestJson(`${approved.origin}/api/auth/callback/credentials`, 'POST', form); phase = 'opening';
		const readSession = async () => { sessionGets++; return await requestJson(`${approved.origin}/api/auth/session`); };
		const readQuery = async (name: string, value?: unknown) => {
			memberGets++; const result = object(await requestJson(queryAddress(name, value)));
			requirePolicy(!result.error); const wrapped = object(result.result), data = object(wrapped.data);
			requirePolicy(Object.hasOwn(data, 'json')); return superjson.deserialize(data as unknown as Parameters<typeof superjson.deserialize>[0]);
		};
		const readIdentity = async (proof: Proof): Promise<Identity> => {
			const began = runtime.now(), before = await readSession();
			const availability = await readQuery('billing.availability'), overview = await readQuery('billing.myOverview');
			const subscriptions = await readQuery('billing.mySubscriptions'), payment = await readQuery('billing.payment', { id: approved.operationId });
			const after = await readSession(), now = runtime.now(); requirePolicy(now - began >= 0 && now - began <= limits.proofAgeMs);
			return deriveMemberIdentity(before, after, availability, overview, subscriptions, payment, proof, now, randomBytes(16).toString('hex'));
		};
		const openingIdentity = await readIdentity(input.proof);
		protocol.attestOpen(input.proof, openingIdentity, runtime.freeBytes(), runtime.now());
		const routeHandler = async (route: Route, request: Request) => {
			try {
				const frame = request.frame(), top = request.isNavigationRequest() && frame === page?.mainFrame();
				const body = request.postData() ?? undefined;
				if (signal.aborted || !requestAllowed(request.url(), request.method(), top, frame.url(), phase,
					undefined, undefined, input.proof.sessionId, body, request.resourceType())) { counters.blockedRequests++; await route.abort(); return; }
				await route.continue({ headers: scopedHeaders(request.url(), request.headers(), input.stagingBypass) });
			} catch { counters.blockedRequests++; await route.abort().catch(() => {}); }
		};
		await run.wait(context.route('**/*', routeHandler)); listeners.push(async () => { await context?.unroute('**/*', routeHandler); });
		await run.wait(context.routeWebSocket('**/*', socket => { counters.blockedRequests++; void socket.close().catch(() => {}); }));
		page = await run.wait(context.newPage());
		const onPage = (opened: Page) => { if (opened !== page) { counters.unexpectedPages++; void opened.close().catch(() => {}); } };
		const onConsole = (message: { type(): string }) => { if (message.type() === 'error') counters.consoleErrors++; };
		const onError = () => { counters.pageErrors++; };
		const onResponse = (response: { status(): number }) => { if (response.status() >= 400) counters.httpErrors++; };
		const onFailedRequest = () => { counters.failedRequests++; };
		context.on('page', onPage); context.on('console', onConsole); context.on('weberror', onError); context.on('response', onResponse); context.on('requestfailed', onFailedRequest);
		listeners.push(() => { context?.off('page', onPage); context?.off('console', onConsole); context?.off('weberror', onError); context?.off('response', onResponse); context?.off('requestfailed', onFailedRequest); });
		await run.wait(page.goto(input.proof.url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
		const surface = await run.wait(observeSurface(page, counters, runtime.now())); protocol.observeSurface(surface, runtime.now());
		if (protocol.state === 'ack-required') {
			phase = 'acknowledgment'; const intent = protocol.acknowledgmentIntent();
			const durable = await run.perform(() => options.broker.writeIntent(Object.freeze(structuredClone(intent)), signal)); run.check();
			protocol.admitAcknowledgment(durable);
			const frames = await run.wait(visibleFrames(page)); let checkbox: Locator | undefined;
			for (const frame of frames) {
				const found = frame.getByRole('checkbox', { name: approved.controlName, exact: true });
				for (let index = 0, count = await found.count(); index < count; index++) if (await found.nth(index).isVisible()) {
					requirePolicy(!checkbox && await found.nth(index).isEnabled() && !await found.nth(index).isChecked()); checkbox = found.nth(index);
				}
			}
			requirePolicy(checkbox);
			validateProof(input.proof, protocol.manifest, 'open', runtime.now());
			validateAcknowledgmentSurface(await run.wait(observeSurface(page, counters, runtime.now())), runtime.now());
			await run.wait(ackClick.perform(String(protocol.state) === 'ack-intent-written', signal, () => checkbox!.click({ timeout: 10000 })));
			const until = runtime.now() + 15000; let post: CheckoutSurface | undefined;
			while (runtime.now() < until) {
				post = await run.wait(observeSurface(page, counters, runtime.now()));
				if (post.panelCount === 0 && post.visibleCard && post.testModeLabel) break;
				await run.wait(page.waitForTimeout(250));
			}
			protocol.recordAcknowledgment('transition-observed', post, runtime.now());
		}
		phase = 'fixture'; const frames = await run.wait(visibleFrames(page));
		const number = await run.wait(uniqueVisible(frames, cardFields.number)), expiry = await run.wait(uniqueVisible(frames, cardFields.expiry)), cvc = await run.wait(uniqueVisible(frames, cardFields.cvc));
		await run.wait(number!.fill('4242424242424242', { timeout: 10000 }));
		await run.wait(expiry!.fill(`12${String(new Date(runtime.now()).getUTCFullYear() + 2).slice(-2)}`, { timeout: 10000 }));
		await run.wait(cvc!.fill('123', { timeout: 10000 }));
		for (const [selector, value] of [['input[name="email"],input[autocomplete="email"]', approved.memberEmail],
			['input[name="billingName"],input[autocomplete="cc-name"]', 'GiveToGive Synthetic Test Member'],
			['input[name="billingPostalCode"],input[autocomplete="postal-code"]', '10001']] as const) {
			const field = await run.wait(uniqueVisible(frames, selector, true)); if (field) await run.wait(field.fill(value, { timeout: 10000 }));
		}
		const filledSurface = await run.wait(observeSurface(page, counters, runtime.now()));
		protocol.recordFixture({ scenario: 'success', publicFixtureOnly: true, visibleDocumentedControls: true,
			noProviderInstructionsRemain: !filledSurface.unknownInstructions && filledSurface.panelCount === 0,
			noFinancialSubmit: submitClick.attempts === 0 }, runtime.freeBytes(), filledSurface, runtime.now());
		phase = 'submission'; const freshIdentity = await readIdentity(input.proof);
		const selectedProof = validateProof(await run.perform(() => options.broker.preSubmitProof(signal)), protocol.manifest, 'pre-submit', runtime.now(), input.proof);
		const intent = protocol.prepareSubmitIntent(selectedProof, freshIdentity, runtime.freeBytes(), runtime.now());
		const durable = await run.perform(() => options.broker.writeIntent(Object.freeze(structuredClone(intent)), signal)); run.check(); protocol.admitSubmitIntent(durable);
		const retained = await run.perform(() => options.broker.retainSubmitIntent(Object.freeze(structuredClone(intent)), durable, signal)); run.check();
		const finalIdentity = await readIdentity(selectedProof), finalSurface = await run.wait(observeSurface(page, counters, runtime.now()));
		protocol.acknowledgeCheckpoint(retained.acknowledgment, retained.ciphertextDigest, runtime.now(), runtime.freeBytes(), finalIdentity, finalSurface);
		const submits: Locator[] = [];
		for (const frame of await run.wait(visibleFrames(page))) {
			const candidates = frame.getByRole('button', { name: 'Subscribe', exact: true });
			const count = await run.wait(candidates.count()); requirePolicy(count <= 8);
			for (let index = 0; index < count; index++) { const button = candidates.nth(index);
				if (await run.wait(button.isVisible())) { requirePolicy(await run.wait(button.isEnabled()) && await run.wait(button.getAttribute('type')) === 'submit'); submits.push(button); }
			}
		}
		requirePolicy(submits.length === 1); run.check(); checkMemory(runtime.freeBytes(), false);
		// Revalidate the same selected proof immediately before admission. Never renew/exchange it.
		validateProof(selectedProof, protocol.manifest, 'pre-submit', runtime.now(), input.proof);
		validateIdentity(finalIdentity, runtime.now(), freshIdentity);
		validateNativeSurface(await run.wait(observeSurface(page, counters, runtime.now())), runtime.now());
		await run.wait(submitClick.perform(protocol.state === 'submit-admitted', signal, () => submits[0]!.click({ timeout: 10000 })));
		protocol.recordSubmitOutcome('clicked'); phase = 'observation';
		// No return-page text, provider status or adapter boolean confers paid acceptance.
		await run.wait(page.waitForTimeout(1000));
		requirePolicy(Object.values(counters).every(count => count === 0));
	} catch { failed = true; protocol?.cancel(); run.controller.abort(); }
	finally {
		phase = 'cleanup'; for (const detach of listeners) { if (!await boundedClose(async () => { await detach(); })) failed = true; }
		if (api) apiDisposed = await closeApi(api);
		else apiDisposed = !contextPending;
		if (context) contextClosed = await closeContext(context); else contextClosed = !contextPending;
		if (browser) browserClosed = await closeBrowser(browser); else browserClosed = !launchPending;
		run.finish();
	}
	const unresolved = launchPending || contextPending || !apiDisposed || !contextClosed || !browserClosed;
	// This module cannot independently inspect the hosted parent's OS child/PID ownership.
	const receipt = protocol?.cleanup({ browserProcessClosed: false, browserContextClosed: contextClosed,
		apiDisposed, ownedLiveProcesses: unresolved ? 1 : 0, noUnresolvedClosure: !unresolved });
	return { protocol: 1 as const, purpose: 'member-checkout-worker' as const, state: receipt?.state ?? 'blocked',
		failed, paymentAccepted: false as const, retryAllowed: false as const,
		executionEvidence: injected ? 'injected-offline-runtime' as const : 'native-playwright-adapter' as const,
		durabilityEvidence: 'external-broker-not-worker-filesystem-proof' as const,
		independentBrokerAndOsProcessVerificationRequired: true as const,
		protocolCleanupConfirmed: receipt?.cleanupConfirmed ?? false,
		apiDisposed, browserContextClosed: contextClosed, browserDisconnected: browserClosed, unresolvedResourceCreation: launchPending || contextPending,
		authPosts, memberGets, sessionGets, acknowledgmentClickAttempts: ackClick.attempts, submitClickAttempts: submitClick.attempts,
		consoleErrors: counters.consoleErrors, pageErrors: counters.pageErrors, httpErrors: counters.httpErrors,
		blockedRequests: counters.blockedRequests, failedRequests: counters.failedRequests, unexpectedPages: counters.unexpectedPages,
		signedWebhookCoverageLedgerReviewRequired: true as const, privateDetailsWithheld: true as const };
}
