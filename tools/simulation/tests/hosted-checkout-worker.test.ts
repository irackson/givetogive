import test from 'node:test';
import assert from 'node:assert/strict';
import superjson from 'superjson';
import type { BrowserType } from 'playwright';
import { approved, limits, digest, assetName, memberQueryRequestAllowed, type Manifest, type Proof } from '../src/hosted-checkout-policy.ts';
import { deriveMemberIdentity, queryAddress, scopedHeaders, OneNativeClick, validateNativeSurface, validateAcknowledgmentSurface, validateCardSelectionSurface,
	runHostedCheckoutMember, type CheckoutMemberBroker, type CheckoutWorkerRuntime } from '../src/hosted-checkout-worker.ts';

// Pure public synthetic fixtures. Every browser, auth, response and broker below is an in-memory fake.
// No environment/private files, actual sign-ins, sockets, browsers, payments or provider SDK calls.
const NOW = Date.parse('2026-10-03T12:00:00.000Z'), HEAD = 'b'.repeat(40);
function manifest(): Manifest {
	return { protocol: 1, purpose: 'one-member-test-checkout-policy',
		job: { repository: approved.repository, actor: approved.actor, triggeringActor: approved.actor,
			event: 'workflow_dispatch', ref: 'refs/heads/main', attempt: 1, id: '123456789', headSha: HEAD, nonce: 'c'.repeat(32),
			publicRepository: true, runner: 'ubuntu-24.04', platform: 'linux', nodeMajor: 24 },
		releaseId: 123, createdAt: new Date(NOW).toISOString(), runId: approved.runId, actorId: approved.actorId,
		operationId: approved.operationId, origin: approved.origin, databaseIdentity: approved.databaseIdentity,
		sourceDigest: approved.sourceDigest, canonicalSourceDigest: approved.canonicalSourceDigest,
		rootLockDigest: approved.rootLockDigest, runnerDigest: approved.runnerDigest,
		currency: 'usd', maximumAmountCents: 1500, expectedTier: 'sustainer', scenario: 'success',
		budget: { runBudgetCents: 2500, actorBudgetCents: 1500, priorExpiredReservedCents: 1000, candidateReservedCents: 1500,
			originalAdmissionDigest: '1'.repeat(64), expiredHistoryDigests: ['2'.repeat(64), '3'.repeat(64)], noReset: true },
		rootProof: { observedAt: new Date(NOW).toISOString(), localIsolationVerified: true, normalMemberOnly: true,
			noMemberTokens: true, noCheckoutSubmitAdmission: true, canonicalCustomerClockVerified: true,
			releaseVerified: true, supportsTestSubscriptionsOnly: true } };
}
function proof(m = manifest(), phase: 'open' | 'pre-submit' = 'open'): Proof {
	return { protocol: 1, kind: 'local-operator-provider-read', phase, proofNonce: (phase === 'open' ? 'd' : 'e').repeat(32),
		manifestDigest: digest(m), jobId: m.job.id, jobNonce: m.job.nonce, headSha: HEAD,
		runId: approved.runId, actorId: approved.actorId, operationId: approved.operationId,
		verifiedAt: new Date(NOW).toISOString(), platformAccountId: approved.platformAccountId, databaseIdentity: approved.databaseIdentity,
		customerAccountId: 'acct_OFFLINEFIXTURE', sessionId: 'cs_test_OFFLINEFIXTURE',
		url: 'https://checkout.stripe.com/c/pay/cs_test_OFFLINEFIXTURE#OFFLINE', livemode: false, currency: 'usd', amountTotal: 1500,
		mode: 'subscription', status: 'open', paymentStatus: 'unpaid', expiresAt: Math.floor(NOW / 1000) + 600,
		successUrl: `${approved.origin}/giving/${approved.operationId}?checkout=returned`,
		cancelUrl: `${approved.origin}/giving/${approved.operationId}?checkout=canceled`, providerIdentityVerified: true,
		canonicalCustomerClockVerified: true, providerInvoiceAbsent: true, providerSubscriptionAbsent: true };
}
function input() { const m = manifest(); return { manifest: m, member: { id: approved.memberId, userId: approved.actorId,
	email: approved.memberEmail, password: 'OFFLINE-SYNTHETIC-NOT-A-CREDENTIAL' }, stagingBypass: 'OFFLINE-NOT-A-STAGING-BYPASS', proof: proof(m) }; }
const session = { access: 'active', expires: new Date(NOW + 3600000).toISOString(),
	user: { id: approved.actorId, email: approved.memberEmail, role: 'member', sessionVersion: 0, authenticatedAt: NOW } };
const availability = { environment: 'staging', livemode: false, subscriptions: true, askPayments: false, funds: false };
const overview = { tier: 'neighbor', subscriptions: [] };
const payment = { id: approved.operationId, kind: 'supporter', status: 'checkout_open', grossAmount: 1500, currency: 'usd',
	tier: 'sustainer', recurring: true, livemode: false, paidAt: null, refundedAmount: 0, disputedAmount: 0,
	expiresAt: new Date(proof().expiresAt * 1000) };
const cardSurface = { observedAt: new Date(NOW).toISOString(), testModeLabel: true, visibleCard: true, panelCount: 0,
	panelDigest: null, controlName: '', controlCount: 0, visible: false, enabled: false, unchecked: false,
	optionalLinkDeferred: true, requiresCaptchaOrWalletOrAttestation: false, unknownInstructions: false, consoleErrors: 0, pageErrors: 0, httpErrors: 0 };

test('revealing a Card choice requires fresh healthy test-mode evidence and never satisfies native submit admission', () => {
	const selection = { ...cardSurface, visibleCard: false, cardChoiceCount: 1, cardChoiceVisible: true, cardChoiceEnabled: true };
	assert.doesNotThrow(() => validateCardSelectionSurface(selection, NOW));
	assert.throws(() => validateNativeSurface(selection, NOW));
	for (const change of [{ testModeLabel: false }, { visibleCard: true }, { panelCount: 1 }, { panelDigest: 'private-fixture' },
		{ cardChoiceCount: 0 }, { cardChoiceCount: 2 }, { cardChoiceVisible: false }, { cardChoiceEnabled: false },
		{ controlCount: 1 }, { requiresCaptchaOrWalletOrAttestation: true }, { unknownInstructions: true },
		{ consoleErrors: 1 }, { pageErrors: 1 }, { httpErrors: 1 }, { observedAt: new Date(NOW - 5001).toISOString() }])
		assert.throws(() => validateCardSelectionSurface({ ...selection, ...change }, NOW));
});

test('actual session and billing-management response shape derives exact neighbor identity, including SuperJSON Date', () => {
	const identity = deriveMemberIdentity(session, session, availability, overview, [], payment, proof(), NOW, '8'.repeat(32));
	assert.equal(identity.userId, approved.actorId); assert.equal(identity.verified, true); assert.equal(identity.frozen, false);
	assert.equal(identity.independentNormalSession, true); assert.equal(identity.sessionVersion, 0);
	assert.equal(deriveMemberIdentity(session, session, availability, overview, [], { ...payment, expiresAt: payment.expiresAt.toISOString() }, proof(), NOW, '7'.repeat(32)).tier, 'neighbor');
});
test('admin/foreign/frozen-only/expired/revoked sessions and paid/foreign operation never become member evidence', () => {
	for (const patch of [{ role: 'admin' }, { id: 'foreign' }, { email: 'foreign' }, { sessionVersion: -1 }, { authenticatedAt: Infinity }])
		assert.throws(() => deriveMemberIdentity({ ...session, user: { ...session.user, ...patch } }, session, availability, overview, [], payment, proof(), NOW, '8'.repeat(32)));
	for (const after of [{ ...session, access: 'billing_only' }, { ...session, expires: new Date(NOW).toISOString() },
		{ ...session, user: { ...session.user, sessionVersion: 1 } }])
		assert.throws(() => deriveMemberIdentity(session, after, availability, overview, [], payment, proof(), NOW, '8'.repeat(32)));
	for (const patch of [{ id: 'foreign' }, { kind: 'ask' }, { grossAmount: 500 }, { status: 'paid' }, { tier: 'supporter' },
		{ livemode: true }, { paidAt: new Date(NOW) }, { refundedAmount: 1 }, { disputedAmount: 1 }, { expiresAt: new Date(NOW) }])
		assert.throws(() => deriveMemberIdentity(session, session, availability, overview, [], { ...payment, ...patch }, proof(), NOW, '8'.repeat(32)));
});
test('unsafe gates, tiers and existing subscriptions fail closed', () => {
	for (const patch of [{ environment: 'production' }, { livemode: true }, { subscriptions: false }, { askPayments: true }, { funds: true }])
		assert.throws(() => deriveMemberIdentity(session, session, { ...availability, ...patch }, overview, [], payment, proof(), NOW, '8'.repeat(32)));
	for (const changed of [{ tier: 'sustainer', subscriptions: [] }, { tier: 'neighbor', subscriptions: [{}] }])
		assert.throws(() => deriveMemberIdentity(session, session, availability, changed, [], payment, proof(), NOW, '8'.repeat(32)));
	assert.throws(() => deriveMemberIdentity(session, session, availability, overview, [{}], payment, proof(), NOW, '8'.repeat(32)));
});
test('generated URLs contain only four exact GET envelope types and host-only bypass transport', () => {
	for (const name of ['billing.availability', 'billing.myOverview', 'billing.mySubscriptions'])
		assert.equal(memberQueryRequestAllowed(queryAddress(name), 'GET', 'opening'), true);
	assert.equal(memberQueryRequestAllowed(queryAddress('billing.payment', { id: approved.operationId }), 'GET', 'submission'), true);
	for (const name of ['billing.createCheckout', 'admin.payments', 'simulation.acquire']) assert.throws(() => queryAddress(name));
	assert.throws(() => queryAddress('billing.payment', { id: 'other' }));
	assert.deepEqual(scopedHeaders(`${approved.origin}/api/auth/session`, { 'X-Vercel-Protection-Bypass': 'OLD', accept: 'json' }, 'OFFLINE'), { accept: 'json', 'x-vercel-protection-bypass': 'OFFLINE' });
	for (const origin of ['https://checkout.stripe.com', 'https://js.stripe.com', 'https://hcaptcha.com', 'https://evil.example'])
		assert.deepEqual(scopedHeaders(origin, { 'x-vercel-protection-bypass': 'PRIVATE-MARKER', accept: 'json' }, 'OFFLINE'), { accept: 'json' });
});
test('one native control consumes permission before callback/error/abort and cannot retry', async () => {
	const signal = new AbortController(), gate = new OneNativeClick(); let clicks = 0;
	await assert.rejects(gate.perform(false, signal.signal, async () => { clicks++; })); assert.equal(clicks, 0);
	await assert.rejects(gate.perform(true, signal.signal, async () => { clicks++; throw new Error('PRIVATE-MARKER'); }));
	await assert.rejects(gate.perform(true, signal.signal, async () => { clicks++; })); assert.equal(clicks, 1); assert.equal(gate.attempts, 1);
	const second = new OneNativeClick(); await assert.rejects(second.perform(true, signal.signal, async () => { signal.abort(); }));
	assert.equal(second.attempts, 1); await assert.rejects(second.perform(true, signal.signal, async () => {}));
});
test('immediate submit surface check rejects stale/foreign instructions/challenge/changed controls/genuine errors', () => {
	assert.doesNotThrow(() => validateNativeSurface(cardSurface, NOW));
	for (const patch of [{ visibleCard: false }, { testModeLabel: false }, { panelCount: 1 }, { panelDigest: approved.panelDigest },
		{ controlCount: 1 }, { enabled: true }, { unknownInstructions: true }, { requiresCaptchaOrWalletOrAttestation: true },
		{ consoleErrors: 1 }, { pageErrors: 1 }, { httpErrors: 1 }, { observedAt: 'invalid' }, { observedAt: new Date(NOW - 5001).toISOString() }])
		assert.throws(() => validateNativeSurface({ ...cardSurface, ...patch }, NOW));
});
test('durable wait does not grandfather a changed/stale acknowledgment panel', () => {
	const surface = { ...cardSurface, testModeLabel: false, visibleCard: false, panelCount: 1, panelDigest: approved.panelDigest,
		controlName: approved.controlName, controlCount: 1, visible: true, enabled: true, unchecked: true };
	assert.doesNotThrow(() => validateAcknowledgmentSurface(surface, NOW));
	for (const patch of [{ panelCount: 2 }, { panelDigest: '0'.repeat(64) }, { controlName: 'different' }, { controlCount: 2 },
		{ unchecked: false }, { enabled: false }, { unknownInstructions: true }, { observedAt: new Date(NOW - 5001).toISOString() }])
		assert.throws(() => validateAcknowledgmentSurface({ ...surface, ...patch }, NOW));
});

function fakeExecution(settings: { panel?: boolean; badDurable?: boolean; badAsset?: boolean; staleAsset?: boolean;
	badSession?: boolean; abortAtAsset?: boolean; lateLaunch?: boolean; blockedNavigation?: boolean; staleOpenAfterNavigation?: boolean } = {}) {
	const abort = new AbortController(), value = input(), order: string[] = [], fills: string[] = [];
	let time = NOW, panel = settings.panel ?? false, connected = true, auth = 0, queries = 0;
	let route: ((route: unknown, request: unknown) => Promise<void>) | undefined;
	let release: (() => void) | undefined;
	const rawResponse = (raw: unknown) => ({ status: () => 200, url: () => approved.origin, headers: () => ({}),
		body: async () => Buffer.from(JSON.stringify(raw)), dispose: async () => { order.push('response-dispose'); } });
	const api = { fetch: async (url: string, options: { method: string; data?: string; maxRetries: number; maxRedirects: number; headers: Record<string, string> }) => {
		assert.equal(options.maxRetries, 0); assert.equal(options.maxRedirects, 0); assert.equal(options.headers['x-vercel-protection-bypass'], value.stagingBypass);
		if (url.endsWith('/api/auth/csrf')) return rawResponse({ csrfToken: 'OFFLINE-CSRF' });
		if (url.endsWith('/api/auth/callback/credentials')) {
			auth++; assert.equal(auth, 1); assert.equal(options.method, 'POST');
			assert.equal(new URLSearchParams(options.data).get('email'), approved.memberEmail); order.push('normal-auth'); return rawResponse({ url: `${approved.origin}/asks` });
		}
		if (url.endsWith('/api/auth/session')) return rawResponse(settings.badSession ? { ...session, access: 'billing_only' } : session);
		assert.equal(memberQueryRequestAllowed(url, options.method, 'submission'), true); queries++;
		const name = new URL(url).pathname.split('/').at(-1);
		const result = name === 'billing.availability' ? availability : name === 'billing.myOverview' ? overview : name === 'billing.mySubscriptions' ? [] : payment;
		return rawResponse({ result: { data: superjson.serialize(result) } });
	}, dispose: async () => { order.push('api-close'); } };
	const locator = (__selector: string, type?: string) => ({
		count: async () => panel && !type ? 0 : 1, nth() { return this; },
		isVisible: async () => type === 'checkbox' ? panel : !panel,
		isEnabled: async () => true, isEditable: async () => true, isChecked: async () => false,
		getAttribute: async () => 'submit', fill: async (text: string) => { fills.push(text); },
		click: async () => { order.push(type === 'checkbox' ? 'ack-native' : 'subscribe-native'); if (type === 'checkbox') panel = false; },
	});
	const frame = { url: () => value.proof.url, parentFrame: () => null,
		locator: (selector: string) => locator(selector), getByRole: (role: string) => locator('', role === 'checkbox' ? 'checkbox' : 'submit'),
		evaluate: async () => ({ panels: Number(panel), hash: panel ? approved.panelDigest : null, controls: Number(panel),
			label: panel ? approved.controlName : '', enabledControl: panel, uncheckedControl: panel, testMode: !panel, unknown: false, needsChallenge: false }) };
	const page = { frames: () => [frame], mainFrame: () => frame, goto: async () => {
		if (route) await route({ abort: async () => { order.push('route-blocked'); }, continue: async (options: { headers: Record<string, string> }) => {
			assert.equal(Object.keys(options.headers).some(key => key.toLowerCase() === 'x-vercel-protection-bypass'), false);
		} }, { frame: () => frame, resourceType: () => 'document', isNavigationRequest: () => true, postData: () => null, url: () => settings.blockedNavigation ? 'https://evil.example' : value.proof.url,
			method: () => 'GET', headers: () => ({ 'x-vercel-protection-bypass': 'PRIVATE-MARKER' }) });
		if (settings.staleOpenAfterNavigation) time += 30001;
	}, waitForTimeout: async () => {}, close: async () => {} };
	const context = { request: api, newPage: async () => page, route: async (__scope: string, callback: typeof route) => { route = callback; }, routeWebSocket: async () => {},
		unroute: async () => { order.push('route-detach'); }, on: () => {}, off: () => { order.push('listener-detach'); }, close: async () => { order.push('context-close'); } };
	const browser = { newContext: async (options: unknown) => {
		assert.deepEqual(options, { storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', acceptDownloads: false }); return context;
	}, close: async () => { order.push('browser-close'); connected = false; }, isConnected: () => connected };
	const runtime: CheckoutWorkerRuntime = { now: () => time++, freeBytes: () => limits.startupFreeBytes,
		loadBrowserType: async () => ({ launch: async () => {
			order.push('launch'); if (settings.lateLaunch) { await new Promise<void>(resolve => { release = resolve; }); } return browser;
		} }) as unknown as BrowserType };
	const broker: CheckoutMemberBroker = {
		writeIntent: async intent => { order.push(String(intent.phase)); return { name: `${assetName(value.manifest, intent.phase === 'ack-intent' ? 'ack-intent' : 'submit-intent')}.intent.json`,
			digest: digest(intent), exclusive: true, fsynced: !settings.badDurable }; },
		preSubmitProof: async () => { order.push('operator-pre-submit'); return { ...proof(value.manifest, 'pre-submit'), verifiedAt: new Date(time).toISOString() }; },
		retainSubmitIntent: async intent => {
			order.push('asset-ack'); if (settings.staleAsset) time += 30001; if (settings.abortAtAsset) abort.abort();
			return { ciphertextDigest: 'f'.repeat(64), acknowledgment: { name: assetName(value.manifest, 'submit-intent'), assetId: 99, size: 400,
				ciphertextDigest: 'f'.repeat(64), originalIntentDigest: digest(intent), releaseId: value.manifest.releaseId, jobId: value.manifest.job.id,
				jobNonce: value.manifest.job.nonce, headSha: HEAD, operationId: approved.operationId, observedAt: new Date(time).toISOString(),
				draftStillPrivate: true, anonymousDraft404: true, anonymousAsset404: !settings.badAsset, exclusiveUpload: true,
				exactRetainedAssetVerified: true, encryptedOriginalBytes: true } };
		},
	};
	return { value, runtime, broker, abort, order, fills, release: () => release?.(), auth: () => auth, queries: () => queries };
}
test('in-memory member path requires normal auth, twelve exact billing GETs, durable original and retained ACK before one Subscribe', async () => {
	const fake = fakeExecution(); const receipt = await runHostedCheckoutMember(fake.value, HEAD, { broker: fake.broker, runtime: fake.runtime });
	assert.equal(receipt.failed, false); assert.equal(receipt.state, 'submitted-pending-settlement');
	assert.equal(receipt.authPosts, 1); assert.equal(receipt.memberGets, 12); assert.equal(receipt.sessionGets, 6);
	assert.equal(fake.auth(), 1); assert.equal(fake.queries(), 12); assert.equal(receipt.submitClickAttempts, 1);
	assert.equal(fake.order.filter(item => item === 'subscribe-native').length, 1);
	assert.ok(fake.order.indexOf('submit-intent') < fake.order.indexOf('asset-ack'));
	assert.ok(fake.order.indexOf('asset-ack') < fake.order.indexOf('subscribe-native'));
	assert.equal(fake.fills.includes('4242424242424242'), true); assert.equal(fake.fills.includes('123'), true);
	assert.equal(receipt.paymentAccepted, false); assert.equal(receipt.retryAllowed, false); assert.equal(receipt.protocolCleanupConfirmed, false);
	assert.equal(receipt.executionEvidence, 'injected-offline-runtime'); assert.equal(receipt.independentBrokerAndOsProcessVerificationRequired, true);
	assert.equal(receipt.apiDisposed, true); assert.equal(receipt.browserContextClosed, true); assert.equal(receipt.browserDisconnected, true);
	assert.ok(fake.order.indexOf('listener-detach') < fake.order.indexOf('browser-close'));
	assert.equal(JSON.stringify(receipt).includes(fake.value.member.password), false); assert.equal(JSON.stringify(receipt).includes(fake.value.stagingBypass), false);
});

test('a fresh rendered surface cannot revive an opening provider proof that aged during navigation', async () => {
	const fake = fakeExecution({ staleOpenAfterNavigation: true });
	const result = await runHostedCheckoutMember(fake.value, HEAD, { broker: fake.broker, runtime: fake.runtime });
	assert.equal(result.failed, true); assert.equal(result.submitClickAttempts, 0);
	assert.equal(fake.fills.length, 0); assert.equal(fake.order.includes('submit-intent'), false);
	assert.equal(result.browserDisconnected, true);
});
test('reviewed panel gets one durable acknowledgment before native transition; card/submit happen only afterward', async () => {
	const fake = fakeExecution({ panel: true }); const result = await runHostedCheckoutMember(fake.value, HEAD, { broker: fake.broker, runtime: fake.runtime });
	assert.equal(result.failed, false); assert.equal(result.acknowledgmentClickAttempts, 1); assert.equal(result.submitClickAttempts, 1);
	assert.ok(fake.order.indexOf('ack-intent') < fake.order.indexOf('ack-native'));
	assert.ok(fake.order.indexOf('ack-native') < fake.order.indexOf('submit-intent'));
});
test('bad durable/asset, stale operator proof and cancellation at retention never permit a financial click', async () => {
	for (const settings of [{ badDurable: true }, { badAsset: true }, { staleAsset: true }, { abortAtAsset: true }, { badSession: true }, { blockedNavigation: true }]) {
		const fake = fakeExecution(settings); const result = await runHostedCheckoutMember(fake.value, HEAD, { broker: fake.broker, runtime: fake.runtime, signal: fake.abort.signal });
		assert.equal(result.failed, true); assert.equal(result.submitClickAttempts, 0); assert.equal(fake.order.includes('subscribe-native'), false);
		assert.equal(result.browserDisconnected, true); assert.equal(result.apiDisposed, true); assert.equal(result.paymentAccepted, false);
	}
});
test('already canceled/invalid head/low memory fails before launch, auth or broker', async () => {
	for (const variant of ['canceled', 'head', 'memory'] as const) {
		const fake = fakeExecution(); if (variant === 'canceled') fake.abort.abort();
		if (variant === 'memory') fake.runtime.freeBytes = () => limits.startupFreeBytes - 1;
		const result = await runHostedCheckoutMember(fake.value, variant === 'head' ? '0'.repeat(40) : HEAD, { broker: fake.broker, runtime: fake.runtime, signal: fake.abort.signal });
		assert.equal(result.failed, true); assert.equal(result.authPosts, 0); assert.equal(result.submitClickAttempts, 0); assert.deepEqual(fake.order, []);
	}
});
test('late-created owned browser is closed after abort but returned receipt never invents resolved creation', async () => {
	const fake = fakeExecution({ lateLaunch: true });
	const pending = runHostedCheckoutMember(fake.value, HEAD, { broker: fake.broker, runtime: fake.runtime, signal: fake.abort.signal });
	for (let index = 0; index < 10 && !fake.order.includes('launch'); index++) await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(fake.order.includes('launch'), true); fake.abort.abort(); const result = await pending;
	assert.equal(result.unresolvedResourceCreation, true); assert.equal(result.browserDisconnected, false); assert.equal(result.submitClickAttempts, 0);
	fake.release(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(fake.order.includes('browser-close'), true);
});
