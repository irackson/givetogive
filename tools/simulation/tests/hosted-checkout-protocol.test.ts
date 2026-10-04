import test from 'node:test';
import assert from 'node:assert/strict';
import { approved, limits, digest, validateManifest, validateProof, validateInput, memberCallAllowed,
	authRequestAllowed, requestAllowed, bypassDestinationAllowed, validateAssetSet, validateChildEnvironment, assetName, safeDiagnostic, NormalAuthAdmission, normalAuthBodyAllowed, memberQueryRequestAllowed, type Manifest, type Proof } from '../src/hosted-checkout-policy.ts';
import { CheckoutProtocol, encryptInput, decryptInput, encryptCheckpoint } from '../src/hosted-checkout-protocol.ts';
import { seal, unseal } from '../src/hosted-community-bundle.ts';

// All identifiers/passwords/keys below are synthetic OFFLINE fixture values, never actual receipts.
const NOW = Date.parse('2026-10-03T12:00:00.000Z'), HEAD = 'b'.repeat(40), KEY = Buffer.alloc(32, 7);
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
const identity = { userId: approved.actorId, verified: true, frozen: false, role: 'member', tier: 'neighbor', subscriptions: 0,
	environment: 'staging', livemode: false, supporterEnabled: true, askPaymentsEnabled: false, fundsEnabled: false, observedAt: new Date(NOW).toISOString(), sessionVersion: 0, verificationNonce: '9'.repeat(32), independentNormalSession: true };
const preparedIdentity = { ...identity, verificationNonce: '8'.repeat(32) };
const finalIdentity = { ...identity, verificationNonce: '7'.repeat(32) };
function surface(panel = false) { return { observedAt: new Date(NOW).toISOString(), testModeLabel: !panel, visibleCard: !panel, panelCount: panel ? 1 : 0,
	panelDigest: panel ? approved.panelDigest : null, controlName: panel ? approved.controlName : '', controlCount: panel ? 1 : 0,
	visible: panel, enabled: panel, unchecked: panel, optionalLinkDeferred: true, requiresCaptchaOrWalletOrAttestation: false,
	unknownInstructions: false, consoleErrors: 0, pageErrors: 0, httpErrors: 0 }; }
const fixture = { scenario: 'success', publicFixtureOnly: true, visibleDocumentedControls: true,
	noProviderInstructionsRemain: true, noFinancialSubmit: true };
function protocol(panel = false) { const p = new CheckoutProtocol(manifest(), HEAD, NOW);
	p.attestOpen(proof(p.manifest), identity, limits.startupFreeBytes, NOW); p.observeSurface(surface(panel), NOW); return p; }
function durable(p: CheckoutProtocol, intent: Record<string, unknown>) { return { name: `${assetName(p.manifest, intent.phase === 'ack-intent' ? 'ack-intent' : 'submit-intent')}.intent.json`, digest: digest(intent), exclusive: true, fsynced: true }; }
function submission() { const p = protocol(); p.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW);
	const intent = p.prepareSubmitIntent(proof(p.manifest, 'pre-submit'), preparedIdentity, limits.floorFreeBytes, NOW);
	p.admitSubmitIntent(durable(p, intent)); return { p, intent }; }
function ack(p: CheckoutProtocol, intent: Record<string, unknown>) { return { name: assetName(p.manifest, 'submit-intent'), assetId: 99, size: 400,
	ciphertextDigest: 'f'.repeat(64), originalIntentDigest: digest(intent), releaseId: p.manifest.releaseId, jobId: p.manifest.job.id,
	jobNonce: p.manifest.job.nonce, headSha: HEAD, operationId: approved.operationId, observedAt: new Date(NOW).toISOString(),
	draftStillPrivate: true, anonymousDraft404: true, anonymousAsset404: true, exclusiveUpload: true,
	exactRetainedAssetVerified: true, encryptedOriginalBytes: true }; }
function rejects(action: () => unknown) { assert.throws(action, /^Error: Hosted Checkout policy rejected; private details withheld\.$/); }

test('trusted manual signed-head binding, immutable original budget and source', () => {
	assert.deepEqual(validateManifest(manifest(), HEAD, NOW), manifest());
	for (const key of ['actor', 'triggeringActor', 'repository', 'event', 'ref', 'runner', 'platform']) {
		const m = manifest(); Reflect.set(m.job, key, 'wrong'); rejects(() => validateManifest(m, HEAD, NOW));
	}
	for (const patch of [{ attempt: 2 }, { publicRepository: false }, { nodeMajor: 22 }, { headSha: 'c'.repeat(40) }]) {
		const m = manifest(); Object.assign(m.job, patch); rejects(() => validateManifest(m, HEAD, NOW));
	}
	for (const patch of [{ runBudgetCents: 4000 }, { priorExpiredReservedCents: 0 }, { candidateReservedCents: 1499 }, { noReset: false }, { expiredHistoryDigests: ['2'.repeat(64), '2'.repeat(64)] }]) {
		const m = manifest(); Object.assign(m.budget, patch); rejects(() => validateManifest(m, HEAD, NOW));
	}
	for (const key of ['sourceDigest', 'canonicalSourceDigest', 'rootLockDigest', 'runnerDigest', 'databaseIdentity', 'origin']) {
		const m = manifest(); Reflect.set(m, key, 'wrong'); rejects(() => validateManifest(m, HEAD, NOW));
	}
	rejects(() => validateManifest(manifest(), HEAD, NOW + 300001));
});
test('proofs are exact open/unpaid TEST USD1500 sessions, not return-page claims', () => {
	const m = manifest(); assert.equal(validateProof(proof(m), m, 'open', NOW).amountTotal, 1500);
	for (const patch of [{ amountTotal: 1501 }, { amountTotal: 500 }, { livemode: true }, { currency: 'eur' }, { mode: 'payment' },
		{ sessionId: 'cs_live_FAKE' }, { status: 'complete' }, { paymentStatus: 'paid' }, { actorId: 'other' },
		{ jobNonce: '0'.repeat(32) }, { manifestDigest: '0'.repeat(64) }, { databaseIdentity: 'database-name' },
		{ successUrl: 'https://givetogive.vercel.app' }, { kind: 'server-ui-attestation' }, { providerInvoiceAbsent: false }]) {
		rejects(() => validateProof({ ...proof(m), ...patch }, m, 'open', NOW));
	}
	for (const url of ['https://evil.example/c/pay/cs_test_OFFLINEFIXTURE', 'https://checkout.stripe.com/c/pay/cs_test_WRONG',
		'https://user:secret@checkout.stripe.com/c/pay/cs_test_OFFLINEFIXTURE', 'https://checkout.stripe.com/c/pay/cs_test_OFFLINEFIXTURE?token=secret'])
		rejects(() => validateProof({ ...proof(m), url }, m, 'open', NOW));
});
test('both proofs preserve30s freshness,5s future skew, >15s expiry and same original session', () => {
	const m = manifest(), open = proof(m), submit = proof(m, 'pre-submit');
	assert.equal(validateProof(submit, m, 'pre-submit', NOW + 30000, open).phase, 'pre-submit');
	rejects(() => validateProof(submit, m, 'pre-submit', NOW + 30001, open));
	rejects(() => validateProof({ ...open, verifiedAt: new Date(NOW + 5001).toISOString() }, m, 'open', NOW));
	rejects(() => validateProof({ ...open, expiresAt: NOW / 1000 + 15 }, m, 'open', NOW));
	rejects(() => validateProof({ ...submit, proofNonce: open.proofNonce }, m, 'pre-submit', NOW, open));
	for (const patch of [{ customerAccountId: 'acct_OTHER' }, { expiresAt: submit.expiresAt + 1 }, { url: `${submit.url}changed` }])
		rejects(() => validateProof({ ...submit, ...patch }, m, 'pre-submit', NOW, open));
});
test('one-member input rejects every extra secret/token and second member', () => {
	assert.equal(validateInput(input(), HEAD, NOW).member.userId, approved.actorId);
	for (const key of ['stripeKey', 'databaseUrl', 'adminPassword', 'controlToken', 'runnerToken', 'brokerKey'])
		rejects(() => validateInput({ ...input(), [key]: 'PRIVATE-MARKER' }, HEAD, NOW));
	for (const key of ['token', 'mcpToken', 'sessionCookie']) {
		const raw = input(); Object.assign(raw.member, { [key]: 'PRIVATE-MARKER' }); rejects(() => validateInput(raw, HEAD, NOW));
	}
	rejects(() => validateInput({ ...input(), members: [input().member, input().member] }, HEAD, NOW));
	rejects(() => validateInput({ ...input(), member: { ...input().member, userId: 'other' } }, HEAD, NOW));
	for (const patch of [{id:'other'},{email:'other@givetogive.invalid'}]) rejects(()=>validateInput({...input(),member:{...input().member,...patch}},HEAD,NOW));
});
test('crypto reuses bounded authenticated sealing without operational key reads', () => {
	const encrypted = encryptInput(input(), KEY, HEAD, NOW); assert.deepEqual(decryptInput(encrypted, KEY, HEAD, NOW), input());
	assert.equal(encrypted.includes(Buffer.from(input().member.password)), false);
	const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1; rejects(() => decryptInput(tampered, KEY, HEAD, NOW));
	rejects(() => decryptInput(encrypted, Buffer.alloc(32, 8), HEAD, NOW));
	rejects(() => decryptInput(encrypted, KEY, 'a'.repeat(40), NOW));
	rejects(() => decryptInput(Buffer.alloc(limits.inputBytes + 65537), KEY, HEAD, NOW));
	rejects(() => decryptInput(seal({ untrusted: 'x'.repeat(limits.inputBytes) }, KEY), KEY, HEAD, NOW));
	rejects(() => encryptInput({ ...input(), extra: 'x'.repeat(limits.inputBytes) }, KEY, HEAD, NOW));
});
test('member normal API is four exact GETs, never a new purchase/control operation', () => {
	for (const name of ['billing.availability', 'billing.myOverview', 'billing.mySubscriptions']) assert.equal(memberCallAllowed('GET', name, undefined), true);
	assert.equal(memberCallAllowed('GET', 'billing.payment', { id: approved.operationId }), true);
	for (const name of ['billing.createCheckout', 'billing.cancelCheckout', 'billing.adminAudit', 'simulation.control', 'prepare_checkout'])
		assert.equal(memberCallAllowed('POST', name, {}), false);
	assert.equal(memberCallAllowed('GET', 'billing.payment', { id: 'other' }), false);
	assert.equal(memberCallAllowed('GET', 'billing.payment', { id: approved.operationId, actorId: approved.actorId }), false);
	assert.equal(authRequestAllowed('POST', '/api/auth/callback/credentials', 'sign-in'), true);
	assert.equal(authRequestAllowed('POST', '/api/auth/callback/credentials', 'submission'), false);
	assert.equal(authRequestAllowed('POST', '/api/auth/callback/google', 'sign-in'), false);
});
test('child environment refuses inheritance of secrets/debug/tool endpoints', () => {
	const env = { PATH: '/bin', HOME: '/tmp/member', TMPDIR: '/tmp/member', PLAYWRIGHT_BROWSERS_PATH: '/tmp/chromium' };
	assert.deepEqual(validateChildEnvironment(env), env);
	for (const key of ['STRIPE_SECRET_KEY', 'DATABASE_URL', 'GITHUB_TOKEN', 'COMMUNITY_BUNDLE_KEY', 'SIM_RUNNER_TOKEN', 'DEBUG', 'PWDEBUG', 'NODE_OPTIONS'])
		rejects(() => validateChildEnvironment({ ...env, [key]: 'PRIVATE-MARKER' }));
});
test('remote memory and exact independent normal-member identity are prerequisites', () => {
	for (const patch of [{ userId: 'other' }, { verified: false }, { frozen: true }, { role: 'admin' }, { tier: 'sustainer' },
		{ subscriptions: 1 }, { livemode: true }, { askPaymentsEnabled: true }, { fundsEnabled: true }]) {
		const p = new CheckoutProtocol(manifest(), HEAD, NOW); rejects(() => p.attestOpen(proof(), { ...identity, ...patch }, limits.startupFreeBytes, NOW));
	}
	const p = new CheckoutProtocol(manifest(), HEAD, NOW); rejects(() => p.attestOpen(proof(), identity, limits.startupFreeBytes - 1, NOW));
	const q = protocol(); rejects(() => q.recordFixture(fixture, limits.floorFreeBytes - 1, surface(), NOW));
});
test('ordinary reviewed acknowledgment is exclusive and durable; unknown UI stops', () => {
	const p = protocol(true), intent = p.acknowledgmentIntent(); p.admitAcknowledgment(durable(p, intent));
	p.recordAcknowledgment('transition-observed', surface(), NOW); assert.equal(p.state, 'fixture-ready'); rejects(() => p.admitAcknowledgment(durable(p, intent)));
	for (const patch of [{ panelDigest: '0'.repeat(64) }, { controlName: 'other' }, { enabled: false }, { visible: false },
		{ unchecked: false }, { panelCount: 2 }, { unknownInstructions: true }, { requiresCaptchaOrWalletOrAttestation: true }, { consoleErrors: 1 }]) {
		const q = new CheckoutProtocol(manifest(), HEAD, NOW); q.attestOpen(proof(), identity, limits.startupFreeBytes, NOW);
		rejects(() => q.observeSurface({ ...surface(true), ...patch }, NOW));
	}
	const q = protocol(true), pending = q.acknowledgmentIntent(); q.admitAcknowledgment(durable(q, pending)); q.recordAcknowledgment('uncertain', undefined, NOW);
	assert.equal(q.state, 'uncertain'); rejects(() => q.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW));
	const r = protocol(true); rejects(() => r.admitAcknowledgment({ ...durable(r, r.acknowledgmentIntent()), fsynced: false }));
});
test('no arbitrary PAN/payment method instructions are accepted in fixture evidence', () => {
	for (const patch of [{ scenario: 'decline' }, { publicFixtureOnly: false }, { noProviderInstructionsRemain: false },
		{ cardNumber: 'PRIVATE-PAN-MARKER' }, { paymentMethod: 'pm_private' }]) {
		const p = protocol(); rejects(() => p.recordFixture({ ...fixture, ...patch }, limits.floorFreeBytes, surface(), NOW));
	}
});
test('durable one-shot submit requires immutable encrypted checkpoint acknowledgment', () => {
	const { p, intent } = submission(); const ciphertext = encryptCheckpoint(p.manifest, intent, KEY);
	const envelope = unseal(ciphertext, KEY) as { intent: unknown }; assert.deepEqual(envelope.intent, intent);
	assert.deepEqual(p.acknowledgeCheckpoint(ack(p, intent), 'f'.repeat(64), NOW, limits.floorFreeBytes, finalIdentity, surface()), { maximumClicks: 1, paymentAccepted: false, retryAllowed: false });
	p.recordSubmitOutcome('clicked'); assert.equal(p.state, 'submitted-pending-settlement');
	assert.equal(p.receipt().paymentAccepted, false); rejects(() => p.recordSubmitOutcome('clicked'));
	assert.equal(p.state, 'uncertain');
	const q = protocol(); q.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW); rejects(() => q.acknowledgeCheckpoint(ack(p, intent), 'f'.repeat(64), NOW, limits.floorFreeBytes, finalIdentity, surface()));
	for (const patch of [{ originalIntentDigest: '0'.repeat(64) }, { ciphertextDigest: '0'.repeat(64) }, { name: 'other' },
		{ releaseId: 999 }, { jobId: '999' }, { jobNonce: '0'.repeat(32) }, { headSha: '0'.repeat(40) },
		{ draftStillPrivate: false }, { anonymousAsset404: false }, { exclusiveUpload: false }, { exactRetainedAssetVerified: false }, { size: limits.checkpointBytes + 1 }]) {
		const { p: r, intent: original } = submission(); rejects(() => r.acknowledgeCheckpoint({ ...ack(r, original), ...patch }, 'f'.repeat(64), NOW, limits.floorFreeBytes, finalIdentity, surface()));
	}
	const { p: stale, intent: original } = submission(); rejects(() => stale.acknowledgeCheckpoint(ack(stale, original), 'f'.repeat(64), NOW + 30001, limits.floorFreeBytes, finalIdentity, surface()));
	rejects(() => encryptCheckpoint(p.manifest, { ...intent, stripeKey: 'PRIVATE-MARKER' }, KEY));
});
test('selected second proof cannot be renewed or exchanged before admission', () => {
	const p = protocol(); p.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW);
	p.prepareSubmitIntent(proof(p.manifest, 'pre-submit'), preparedIdentity, limits.floorFreeBytes, NOW);
	rejects(() => p.prepareSubmitIntent({ ...proof(p.manifest, 'pre-submit'), proofNonce: 'f'.repeat(32) }, preparedIdentity, limits.floorFreeBytes, NOW));
});
test('cancellation before any phase blocks later admission; after durable intent remains uncertain', () => {
	for (const p of [new CheckoutProtocol(manifest(), HEAD, NOW), protocol(), protocol(true)]) {
		p.cancel(); assert.equal(p.state, 'blocked'); rejects(() => p.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW));
	}
	for (const sent of [false, true]) { const { p, intent } = submission();
		if (sent) p.acknowledgeCheckpoint(ack(p, intent), 'f'.repeat(64), NOW, limits.floorFreeBytes, finalIdentity, surface());
		p.cancel(); assert.equal(p.state, 'uncertain'); assert.equal(p.receipt().retryAllowed, false);
		rejects(() => p.acknowledgeCheckpoint(ack(p, intent), 'f'.repeat(64), NOW, limits.floorFreeBytes, finalIdentity, surface()));
	}
});
test('closure is separate, truthful and admission remains frozen after cleanup', () => {
	const p = protocol(); const closed = { browserProcessClosed: true, browserContextClosed: true, apiDisposed: true, ownedLiveProcesses: 0, noUnresolvedClosure: true };
	assert.equal(p.cleanup(closed).cleanupConfirmed, true); assert.equal(p.receipt().paymentAccepted, false);
	rejects(() => p.recordFixture(fixture, limits.floorFreeBytes, surface(), NOW));
	for (const patch of [{ browserProcessClosed: false }, { browserContextClosed: false }, { apiDisposed: false }, { ownedLiveProcesses: 1 }, { noUnresolvedClosure: false }]) {
		const q = protocol(); assert.equal(q.cleanup({ ...closed, ...patch }).cleanupConfirmed, false);
	}
});
test('public diagnostics never reflect secrets, raw provider errors or private inputs', () => {
	const secret = 'sk_private https://secret.example/PAN-MARKER'; const log = JSON.stringify(safeDiagnostic(secret, secret));
	assert.equal(log.includes(secret), false); assert.equal(log.includes('sk_private'), false);
	try { validateInput({ ...input(), stripeKey: secret }, HEAD, NOW); assert.fail(); } catch (error) {
		assert.equal(String(error).includes(secret), false); assert.equal(String(error).includes(input().member.password), false);
	}
});
test('manifest freezes nested original budget/job values without changing caller bytes', () => {
	const original = manifest(), before = JSON.stringify(original), p = new CheckoutProtocol(original, HEAD, NOW);
	assert.equal(JSON.stringify(original), before); assert.equal(Object.isFrozen(p.manifest.budget), true);
	assert.throws(() => { p.manifest.job.nonce = '0'.repeat(32); });
	assert.equal(JSON.stringify(original), before);
});
test('exact stage routes and provider frame origins, no foreign navigation or bypass forwarding', () => {
	assert.equal(requestAllowed(`${approved.origin}/giving/${approved.operationId}?checkout=returned`, 'GET', true, approved.origin, 'observation'), true);
	assert.equal(requestAllowed(`${approved.origin}/api/trpc/billing.payment?input=${encodeURIComponent(JSON.stringify({ json: { id: approved.operationId } }))}`, 'GET', false, approved.origin, 'observation', 'billing.payment', { id: approved.operationId }), true);
	for (const url of ['https://givetogive.vercel.app/support', 'https://evil.example', `${approved.origin}/giving/foreign`,
		`${approved.origin}/giving/${approved.operationId}?checkout=paid`, `${approved.origin}/support?checkout=returned`,
		`${approved.origin}/giving/${approved.operationId}?_rsc=a&_rsc=b`, `${approved.origin}/admin/payments`])
		assert.equal(requestAllowed(url, 'GET', true, approved.origin, 'observation'), false);
	assert.equal(requestAllowed(`${approved.origin}/api/trpc/billing.createCheckout`, 'POST', false, approved.origin, 'submission'), false);
	assert.equal(requestAllowed('https://api.stripe.com/v1/checkout/sessions', 'POST', false, 'node-sdk', 'submission'), false);
	assert.equal(requestAllowed('https://js.stripe.com/v3/', 'GET', false, 'https://checkout.stripe.com', 'opening'), true);
	assert.equal(requestAllowed(proof().url, 'GET', true, 'https://checkout.stripe.com', 'opening', undefined, undefined, proof().sessionId), true);
	assert.equal(requestAllowed('https://checkout.stripe.com/c/pay/cs_test_OTHER', 'GET', true, 'https://checkout.stripe.com', 'opening', undefined, undefined, proof().sessionId), false);
	assert.equal(requestAllowed('https://checkout.stripe.com/c/pay/cs_live_OTHER', 'GET', true, 'https://checkout.stripe.com', 'opening', undefined, undefined, 'cs_live_OTHER'), false);
	assert.equal(requestAllowed('https://js.stripe.com/v3/', 'GET', false, 'https://checkout.stripe.com', 'blocked'), false);
	assert.equal(requestAllowed('https://hcaptcha.com/checksiteconfig', 'POST', false, 'https://js.stripe.com', 'opening'), true);
	assert.equal(requestAllowed('https://evil.example', 'GET', false, 'https://checkout.stripe.com', 'opening'), false);
	assert.equal(bypassDestinationAllowed(`${approved.origin}/giving`), true);
	for (const url of ['https://checkout.stripe.com', 'https://api.stripe.com', 'https://hcaptcha.com', 'https://user:secret@givetogive-staging.vercel.app'])
		assert.equal(bypassDestinationAllowed(url), false);
});
test('private asset inventory has exclusive names and reserves final slot', () => {
	const m = manifest(), phases = ['input', 'open-proof', 'submit-proof', 'ack-intent', 'submit-intent'] as const;
	const rows = phases.map((phase, index) => ({ id: index + 1, name: assetName(m, phase), size: 100, digest: 'f'.repeat(64) }));
	assert.equal(validateAssetSet(rows, m, 'final').length, 5);
	rejects(() => validateAssetSet(rows, m, 'input'));
	rejects(() => validateAssetSet([{ ...rows[0], name: 'foreign-input' }], m, 'final'));
	rejects(() => validateAssetSet([rows[0], rows[0]], m, 'final'));
	rejects(() => validateAssetSet([{ ...rows[0], size: limits.checkpointBytes + 1 }], m, 'final'));
	rejects(() => validateAssetSet([...rows, { id: 6, name: assetName(m, 'final'), size: 100, digest: 'f'.repeat(64) }], m, 'final'));
});

test('real initial exact Checkout navigation allows blank/staging but rejects foreign or late blank frames', () => {
	for (const frame of ['about:blank', approved.origin]) assert.equal(requestAllowed(proof().url, 'GET', true, frame, 'opening', undefined, undefined, proof().sessionId), true);
	for (const frame of ['https://evil.example', 'https://givetogive.vercel.app', 'about:srcdoc']) assert.equal(requestAllowed(proof().url, 'GET', true, frame, 'opening', undefined, undefined, proof().sessionId), false);
	assert.equal(requestAllowed(proof().url, 'GET', true, 'about:blank', 'submission', undefined, undefined, proof().sessionId), false);
	assert.equal(requestAllowed(proof().url, 'POST', true, approved.origin, 'opening', undefined, undefined, proof().sessionId), false);
});

test('normal sign-in callback is one-shot; later session GETs are read-only and strict-body', () => {
	const admission = new NormalAuthAdmission(); admission.admit('POST', '/api/auth/callback/credentials', 'sign-in');
	rejects(() => admission.admit('POST', '/api/auth/callback/credentials', 'sign-in'));
	for (const phase of ['opening', 'acknowledgment', 'fixture', 'submission', 'observation']) {
		assert.equal(authRequestAllowed('GET', '/api/auth/session', phase), true);
		assert.equal(authRequestAllowed('POST', '/api/auth/session', phase), false);
		assert.equal(authRequestAllowed('POST', '/api/auth/callback/credentials', phase), false);
	}
	const form = new URLSearchParams({csrfToken:'OFFLINE-CSRF',email:approved.memberEmail,password:'OFFLINE-PASSWORD-ONLY',callbackUrl:`${approved.origin}/asks`}).toString();
	assert.equal(normalAuthBodyAllowed('POST','/api/auth/callback/credentials','sign-in',form), true);
	for (const body of [form+'&extra=1', form+'&email=other', form.replace(encodeURIComponent(approved.memberEmail), 'foreign'), undefined, {}])
		assert.equal(normalAuthBodyAllowed('POST','/api/auth/callback/credentials','sign-in',body), false);
	assert.equal(normalAuthBodyAllowed('GET','/api/auth/session','submission',form), false);
});

const undefinedEnvelope = {json:null,meta:{values:['undefined'],v:1}};
function queryUrl(names: string, envelope: unknown, batch = false) {
	return `${approved.origin}/api/trpc/${names}?${batch?'batch=1&':''}input=${encodeURIComponent(JSON.stringify(envelope))}`;
}
test('actual single and <=2 indexed batch envelopes are decoded, never authorized by caller facts', () => {
	for (const name of ['billing.availability','billing.myOverview','billing.mySubscriptions']) assert.equal(memberQueryRequestAllowed(queryUrl(name,undefinedEnvelope),'GET','observation'),true);
	assert.equal(memberQueryRequestAllowed(queryUrl('billing.payment',{json:{id:approved.operationId}}),'GET','observation'),true);
	assert.equal(memberQueryRequestAllowed(queryUrl('billing.myOverview,billing.mySubscriptions',{'0':undefinedEnvelope,'1':undefinedEnvelope},true),'GET','observation'),true);
	assert.equal(memberQueryRequestAllowed(queryUrl('billing.payment,billing.myOverview',{'0':{json:{id:approved.operationId}},'1':undefinedEnvelope},true),'GET','observation'),true);
	for (const [names,envelope,batch] of [
		['billing.myOverview',{json:null},false], ['billing.myOverview',{...undefinedEnvelope,extra:1},false],
		['billing.myOverview',{json:null,meta:{values:['Date'],v:1}},false], ['billing.payment',{json:{id:'foreign'}},false],
		['billing.payment',{json:{id:approved.operationId},meta:{values:['undefined'],v:1}},false],
		['billing.myOverview,billing.mySubscriptions',{'0':undefinedEnvelope,'2':undefinedEnvelope},true],
		['billing.myOverview,billing.mySubscriptions',{'0':undefinedEnvelope,'1':undefinedEnvelope,'2':undefinedEnvelope},true],
		['billing.myOverview,billing.mySubscriptions,billing.availability',{'0':undefinedEnvelope,'1':undefinedEnvelope,'2':undefinedEnvelope},true],
		['billing.myOverview,billing.createCheckout',{'0':undefinedEnvelope,'1':undefinedEnvelope},true],
		['billing.myOverview,billing.myOverview',{'0':undefinedEnvelope,'1':undefinedEnvelope},true],
	] as const) assert.equal(memberQueryRequestAllowed(queryUrl(names,envelope,batch),'GET','observation'),false);
	const actual = queryUrl('billing.payment',{json:{id:'foreign'}});
	assert.equal(requestAllowed(actual,'GET',false,approved.origin,'observation','billing.payment',{id:approved.operationId}),false);
	for (const url of [queryUrl('billing.myOverview',undefinedEnvelope)+'&input=other',queryUrl('billing.myOverview',undefinedEnvelope)+'&extra=1',queryUrl('billing.myOverview',undefinedEnvelope,true).replace('batch=1','batch=2')])
		assert.equal(memberQueryRequestAllowed(url,'GET','observation'),false);
	assert.equal(memberQueryRequestAllowed(queryUrl('billing.myOverview',undefinedEnvelope),'POST','observation'),false);
	assert.equal(memberQueryRequestAllowed(queryUrl('billing.myOverview',undefinedEnvelope),'GET','observation','body'),false);
	for (const payload of ['{"json":null,"json":null,"meta":{"values":["undefined"],"v":1}}','[{}]','not-json','{"json":null, "meta":{"values":["undefined"],"v":1}}'])
		assert.equal(memberQueryRequestAllowed(`${approved.origin}/api/trpc/billing.myOverview?input=${encodeURIComponent(payload)}`,'GET','observation'),false);
});

test('stage navigation and return remain exact and phase/frame bound',()=>{
	for(const phase of ['blocked','uncertain','cleanup','wrong']) assert.equal(requestAllowed(`${approved.origin}/support`,'GET',true,approved.origin,phase),false);
	assert.equal(requestAllowed(`${approved.origin}/support`,'GET',true,'https://evil.example','observation'),false);
	assert.equal(requestAllowed(`${approved.origin}/giving/${approved.operationId}?checkout=returned`,'GET',true,'https://checkout.stripe.com','submission'),true);
	assert.equal(requestAllowed(`${approved.origin}/support`,'GET',true,'https://checkout.stripe.com','submission'),false);
	assert.equal(requestAllowed(`${approved.origin}/giving/${approved.operationId}?checkout=returned`,'GET',true,'about:blank','observation'),false);
});

test('panel may hide card/test labels; detached ack control needs fresh verified card surface', () => {
	const p = protocol(true), intent=p.acknowledgmentIntent(); p.admitAcknowledgment(durable(p,intent));
	// The old checkbox need not remain attached or checked: only the new no-panel surface matters.
	p.recordAcknowledgment('transition-observed',surface(),NOW);
	p.recordFixture(fixture,limits.floorFreeBytes,surface(),NOW);
	assert.equal(p.state,'fixture-entered');
	for (const patch of [{panelCount:1,panelDigest:approved.panelDigest,controlName:approved.controlName,controlCount:1,visible:true,enabled:true,unchecked:true},
		{testModeLabel:false},{visibleCard:false},{unknownInstructions:true},{requiresCaptchaOrWalletOrAttestation:true},{observedAt:new Date(NOW-5001).toISOString()}]) {
		const q=protocol(true); q.admitAcknowledgment(durable(q,q.acknowledgmentIntent()));
		rejects(()=>q.recordAcknowledgment('transition-observed',{...surface(),...patch},NOW)); assert.equal(q.state,'uncertain');
	}
	const q=protocol(); rejects(()=>q.recordFixture(fixture,limits.floorFreeBytes,surface(true),NOW));
});

test('final submit requires independently revalidated fresh exact identity and current no-panel card controls', () => {
	for (const patch of [{observedAt:new Date(NOW-30001).toISOString()},{sessionVersion:1},{verificationNonce:preparedIdentity.verificationNonce},
		{verificationNonce:identity.verificationNonce},{userId:'other'},{independentNormalSession:false}]) {
		const {p,intent}=submission(); rejects(()=>p.acknowledgeCheckpoint(ack(p,intent),'f'.repeat(64),NOW,limits.floorFreeBytes,{...finalIdentity,...patch},surface()));
		assert.equal(p.state,'uncertain');
	}
	for (const patch of [{visibleCard:false},{testModeLabel:false},{unknownInstructions:true},{observedAt:new Date(NOW-5001).toISOString()}]) {
		const {p,intent}=submission(); rejects(()=>p.acknowledgeCheckpoint(ack(p,intent),'f'.repeat(64),NOW,limits.floorFreeBytes,finalIdentity,{...surface(),...patch}));
		assert.equal(p.state,'uncertain');
	}
});
