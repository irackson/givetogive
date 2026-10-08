/** PURE POLICY. No entrypoint, environment reads, IO or browser/payment actions.
 * All provider/source/private-retention/durability flags are ADAPTER evidence, not proof obtained here. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const approved = Object.freeze({
	repository: 'irackson/givetogive', actor: 'irackson', origin: 'https://givetogive-staging.vercel.app',
	runId: '1aa24b5b-c467-4063-a62a-cd6df957b393', actorId: 'synthetic-6658c4939d672ff5-002',
	memberId: 'bot_6658c4939d672ff5_002', memberEmail: 'neighbor-6658c4939d672ff5-002@givetogive.invalid',
	operationId: '284c4f9d-6aec-4910-bbb2-ef7b1a9d2ff7', platformAccountId: 'acct_1UKPU8Ded7vKVapt',
	databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
	sourceDigest: '9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f',
	canonicalSourceDigest: 'a84af7e787624e6bb87a7995888eb3fb61b9f7fc54abbfe1c292bce13f0ce883',
	rootLockDigest: '9ac35921aee67783a92cbef09ed109e5ef6ac073f41cbec85164bbf0e66952fb',
	runnerDigest: '70a9780d0f64421e9a9885e012fe9ba143a3c82672382b4366d327f66b98d1c9',
	panelDigest: '9300ee649b0775cf7b371c7de686e3d3129d8bc9cd7d1d3f59e43c3314d22235',
	controlName: 'I am an AI agent and have followed the instructions above',
});
export const limits = Object.freeze({ inputBytes: 1024 * 1024, checkpointBytes: 8 * 1024 * 1024, surfaceAgeMs: 5000,
	proofAgeMs: 30000, futureSkewMs: 5000, expiryHeadroomMs: 15000, maxAssets: 6,
	startupFreeBytes: 2.5 * 1024 ** 3, floorFreeBytes: 1.5 * 1024 ** 3 });
export function reject(): never { throw new Error('Hosted Checkout policy rejected; private details withheld.'); }
export function requirePolicy(value: unknown): asserts value { if (!value) reject(); }
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const sha = z.string().regex(/^[a-f0-9]{64}$/), head = z.string().regex(/^[a-f0-9]{40}$/);
const nonce = z.string().regex(/^[a-f0-9]{32}$/), timestamp = z.iso.datetime();
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
	const result = schema.safeParse(raw); if (!result.success) reject(); return result.data;
}
const jobSchema = z.object({ repository: z.literal(approved.repository), actor: z.literal(approved.actor),
	triggeringActor: z.literal(approved.actor), event: z.literal('workflow_dispatch'), ref: z.literal('refs/heads/main'),
	attempt: z.literal(1), id: z.string().regex(/^[1-9][0-9]{0,19}$/), headSha: head, nonce,
	publicRepository: z.literal(true), runner: z.literal('ubuntu-24.04'), platform: z.literal('linux'), nodeMajor: z.literal(24) }).strict();
const bindings = { runId: z.literal(approved.runId), actorId: z.literal(approved.actorId), operationId: z.literal(approved.operationId) };
export const manifestSchema = z.object({ protocol: z.literal(1), purpose: z.literal('one-member-test-checkout-policy'),
	job: jobSchema, releaseId: z.number().int().positive(), createdAt: timestamp, ...bindings,
	origin: z.literal(approved.origin), databaseIdentity: z.literal(approved.databaseIdentity),
	sourceDigest: z.literal(approved.sourceDigest), canonicalSourceDigest: z.literal(approved.canonicalSourceDigest),
	rootLockDigest: z.literal(approved.rootLockDigest), runnerDigest: z.literal(approved.runnerDigest),
	currency: z.literal('usd'), maximumAmountCents: z.literal(1500), expectedTier: z.literal('sustainer'), scenario: z.literal('success'),
	budget: z.object({ runBudgetCents: z.literal(2500), actorBudgetCents: z.literal(1500),
		priorExpiredReservedCents: z.literal(1000), candidateReservedCents: z.literal(1500),
		originalAdmissionDigest: sha, expiredHistoryDigests: z.tuple([sha, sha]), noReset: z.literal(true) }).strict(),
	rootProof: z.object({ observedAt: timestamp, localIsolationVerified: z.literal(true), normalMemberOnly: z.literal(true),
		noMemberTokens: z.literal(true), noCheckoutSubmitAdmission: z.literal(true), canonicalCustomerClockVerified: z.literal(true),
		releaseVerified: z.literal(true), supportsTestSubscriptionsOnly: z.literal(true) }).strict() }).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function validateManifest(raw: unknown, expectedHead: string, now: number): Manifest {
	const value = parse(manifestSchema, raw);
	requirePolicy(/^[a-f0-9]{40}$/.test(expectedHead) && value.job.headSha === expectedHead && Number.isFinite(now));
	for (const time of [value.createdAt, value.rootProof.observedAt]) {
		const age = now - Date.parse(time); requirePolicy(age >= -5000 && age <= 300000);
	}
	requirePolicy(new Set(value.budget.expiredHistoryDigests).size === 2); return value;
}
const proofSchema = z.object({ protocol: z.literal(1), kind: z.literal('local-operator-provider-read'),
	phase: z.enum(['open', 'pre-submit']), proofNonce: nonce, manifestDigest: sha, jobId: jobSchema.shape.id,
	jobNonce: nonce, headSha: head, ...bindings, verifiedAt: timestamp,
	platformAccountId: z.literal(approved.platformAccountId), databaseIdentity: z.literal(approved.databaseIdentity),
	customerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]+$/),
	url: z.url(), livemode: z.literal(false), currency: z.literal('usd'), amountTotal: z.literal(1500),
	mode: z.literal('subscription'), status: z.literal('open'), paymentStatus: z.literal('unpaid'), expiresAt: z.number().int().positive(),
	successUrl: z.literal(`${approved.origin}/giving/${approved.operationId}?checkout=returned`),
	cancelUrl: z.literal(`${approved.origin}/giving/${approved.operationId}?checkout=canceled`),
	providerIdentityVerified: z.literal(true), canonicalCustomerClockVerified: z.literal(true),
	providerInvoiceAbsent: z.literal(true), providerSubscriptionAbsent: z.literal(true) }).strict();
export type Proof = z.infer<typeof proofSchema>;
export function validateProof(raw: unknown, manifest: Manifest, phase: Proof['phase'], now: number, prior?: Proof): Proof {
	const value = parse(proofSchema, raw);
	requirePolicy(Number.isFinite(now) && value.phase === phase && value.manifestDigest === digest(manifest)
		&& value.jobId === manifest.job.id && value.jobNonce === manifest.job.nonce && value.headSha === manifest.job.headSha);
	const age = now - Date.parse(value.verifiedAt);
	requirePolicy(age >= -limits.futureSkewMs && age <= limits.proofAgeMs && value.expiresAt * 1000 > now + limits.expiryHeadroomMs);
	let url: URL; try { url = new URL(value.url); } catch { reject(); }
	requirePolicy(url.origin === 'https://checkout.stripe.com' && !url.username && !url.password && !url.search
		&& url.pathname === `/c/pay/${value.sessionId}`);
	if (prior) requirePolicy(value.proofNonce !== prior.proofNonce
		&& Date.parse(value.verifiedAt) >= Date.parse(prior.verifiedAt)
		&& ['sessionId', 'customerAccountId', 'url', 'expiresAt'].every(key => value[key as keyof Proof] === prior[key as keyof Proof]));
	return value;
}
const memberSchema = z.object({ id: z.literal(approved.memberId), userId: z.literal(approved.actorId),
	email: z.literal(approved.memberEmail), password: z.string().min(12).max(512) }).strict();
const inputSchema = z.object({ manifest: manifestSchema, member: memberSchema,
	stagingBypass: z.string().min(16).max(2048), proof: proofSchema }).strict();
export function validateInput(raw: unknown, expectedHead: string, now: number) {
	const value = parse(inputSchema, raw); const manifest = validateManifest(value.manifest, expectedHead, now);
	const proof = validateProof(value.proof, manifest, 'open', now); return { ...value, manifest, proof };
}
/** These are independently obtained ADAPTER observations, not authentication performed here. */
const identitySchema = z.object({ userId: z.literal(approved.actorId), verified: z.literal(true), frozen: z.literal(false),
		role: z.literal('member'), tier: z.literal('neighbor'), subscriptions: z.literal(0),
		environment: z.literal('staging'), livemode: z.literal(false), supporterEnabled: z.literal(true),
		askPaymentsEnabled: z.literal(false), fundsEnabled: z.literal(false), observedAt: timestamp,
		sessionVersion: z.number().int().nonnegative(), verificationNonce: nonce, independentNormalSession: z.literal(true) }).strict();
export type Identity = z.infer<typeof identitySchema>;
export function validateIdentity(raw: unknown, now: number, prior?: Identity): Identity {
	const value = parse(identitySchema, raw), age = now - Date.parse(value.observedAt);
	requirePolicy(Number.isFinite(now) && age >= -limits.futureSkewMs && age <= limits.proofAgeMs);
	if (prior) requirePolicy(value.sessionVersion === prior.sessionVersion && value.verificationNonce !== prior.verificationNonce
		&& Date.parse(value.observedAt) >= Date.parse(prior.observedAt));
	return value;
}
export function checkMemory(bytes: number, admission: boolean) {
	requirePolicy(Number.isFinite(bytes) && bytes >= (admission ? limits.startupFreeBytes : limits.floorFreeBytes));
}
/** A narrow adapter around UiSession.query, NOT a new HTTP endpoint or privileged context API. */
export function memberCallAllowed(method: string, procedure: string, input: unknown): boolean {
	if (method !== 'GET') return false;
	if (['billing.availability', 'billing.myOverview', 'billing.mySubscriptions'].includes(procedure)) return input === undefined;
	return procedure === 'billing.payment' && typeof input === 'object' && input !== null
		&& Object.keys(input).length === 1 && Reflect.get(input, 'id') === approved.operationId;
}
export function authRequestAllowed(method: string, path: string, phase: string): boolean {
	if (method === 'GET' && path === '/api/auth/session') return ['sign-in', 'opening', 'acknowledgment', 'fixture', 'submission', 'observation'].includes(phase);
	return phase === 'sign-in' && ((method === 'GET' && path === '/api/auth/csrf') || (method === 'POST' && path === '/api/auth/callback/credentials'));
}
/** One normal credential callback admission; the adapter must consume this BEFORE its POST. */
export class NormalAuthAdmission {
	private consumed = false;
	admit(method: string, path: string, phase: string) {
		requirePolicy(!this.consumed && method === 'POST' && path === '/api/auth/callback/credentials' && phase === 'sign-in');
		this.consumed = true; return { maximumPosts: 1, retryAllowed: false } as const;
	}
}
export function normalAuthBodyAllowed(method: string, path: string, phase: string, body: unknown): boolean {
	if (!authRequestAllowed(method, path, phase)) return false;
	if (method === 'GET') return body == null;
	if (typeof body !== 'string' || body.length > 4096) return false;
	const fields = new URLSearchParams(body), keys = [...fields.keys()];
	return keys.length === 4 && new Set(keys).size === 4 && keys.every(key => ['csrfToken', 'email', 'password', 'callbackUrl'].includes(key))
		&& (fields.get('csrfToken')?.length ?? 0) > 0 && fields.get('email') === approved.memberEmail
		&& (fields.get('password')?.length ?? 0) >= 12 && (fields.get('password')?.length ?? 0) <= 512
		&& fields.get('callbackUrl') === `${approved.origin}/asks`;
}
/** Decode the actual URL envelope; caller-supplied procedure/input facts never authorize a request. */
function decodeMemberEnvelope(raw: unknown): unknown {
	const undef = z.object({ json: z.null(), meta: z.object({ values: z.tuple([z.literal('undefined')]), v: z.literal(1) }).strict() }).strict();
	if (undef.safeParse(raw).success) return undefined;
	return parse(z.object({ json: z.object({ id: z.literal(approved.operationId) }).strict() }).strict(), raw).json;
}
export function memberQueryRequestAllowed(rawUrl: string, method: string, phase: string, body?: unknown): boolean {
	try {
		const url = new URL(rawUrl);
		if (url.origin !== approved.origin || url.username || url.password || url.hash || method !== 'GET' || body != null
			|| !['opening', 'acknowledgment', 'fixture', 'submission', 'observation'].includes(phase)) return false;
		const prefix = '/api/trpc/'; if (!url.pathname.startsWith(prefix)) return false;
		const names = url.pathname.slice(prefix.length).split(',');
		if (names.length < 1 || names.length > 2 || new Set(names).size !== names.length) return false;
		const keys = [...url.searchParams.keys()];
		if (new Set(keys).size !== keys.length || !keys.includes('input') || keys.some(key => !['input', 'batch'].includes(key))) return false;
		const text = url.searchParams.get('input')!; if (text.length > 4096) return false;
		const raw: unknown = JSON.parse(text);
		// Both installed transports JSON.stringify SuperJSON. Reject duplicate JSON keys/noncanonical envelopes.
		if (JSON.stringify(raw) !== text) return false;
		if (url.searchParams.has('batch')) {
			if (url.searchParams.get('batch') !== '1' || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
			const indexes = Object.keys(raw); if (indexes.length !== names.length || indexes.some((key, index) => key !== String(index))) return false;
			return names.every((name, index) => memberCallAllowed(method, name, decodeMemberEnvelope(Reflect.get(raw, String(index)))));
		}
		return names.length === 1 && memberCallAllowed(method, names[0]!, decodeMemberEnvelope(raw));
	} catch { return false; }
}
/** Browser adapter must supply genuine frame/decoded-query facts; this is not an HTTP client. */
export function requestAllowed(rawUrl: string, method: string, topLevel: boolean, frameOrigin: string,
	phase: string, __procedure?: string, __decodedInput?: unknown, sessionId?: string, body?: unknown): boolean {
	let url: URL; try { url = new URL(rawUrl); } catch { return false; }
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
	if (url.origin === approved.origin) {
		if (url.hash) return false;
		if (url.pathname.startsWith('/api/auth/')) return !topLevel && !url.search && normalAuthBodyAllowed(method, url.pathname, phase, body);
		if (url.pathname.startsWith('/api/trpc/')) return !topLevel && memberQueryRequestAllowed(rawUrl, method, phase, body);
		if (body != null || !['opening', 'acknowledgment', 'fixture', 'submission', 'observation'].includes(phase)) return false;
		if (!['GET', 'HEAD'].includes(method)) return false;
		if (!topLevel && (url.pathname.startsWith('/_next/static/') || url.pathname === '/favicon.ico')) return !url.search;
		if (![`${approved.origin}/giving/${approved.operationId}`, `${approved.origin}/support`, `${approved.origin}/account/billing`].includes(`${url.origin}${url.pathname}`)) return false;
		if (topLevel) {
			let frame: URL; try { frame = new URL(frameOrigin); } catch { return false; }
			const ownFrame = frame.origin === approved.origin;
			const initial = frameOrigin === 'about:blank' && phase === 'opening';
			const stripeReturn = frame.origin === 'https://checkout.stripe.com' && ['submission', 'observation'].includes(phase)
				&& url.pathname === `/giving/${approved.operationId}` && url.searchParams.has('checkout');
			if (!ownFrame && !initial && !stripeReturn) return false;
		}
		const keys = [...url.searchParams.keys()];
		return keys.every(key => key === '_rsc' || key === 'checkout') && new Set(keys).size === keys.length
			&& (!url.searchParams.has('checkout') || (url.pathname === `/giving/${approved.operationId}`
				&& ['returned', 'canceled'].includes(url.searchParams.get('checkout') ?? '')));
	}
	const owned = (value: URL) => value.protocol === 'https:' && !value.username && !value.password && (!value.port || value.port === '443')
		&& (value.hostname === 'stripe.com' || value.hostname.endsWith('.stripe.com') || value.hostname === 'stripecdn.com' || value.hostname.endsWith('.stripecdn.com'));
	let frame: URL; try { frame = new URL(frameOrigin); } catch { return false; }
	if (topLevel) {
		const initial = phase === 'opening' && (frameOrigin === 'about:blank' || frame.origin === approved.origin);
		return (initial || (owned(frame) && ['opening', 'acknowledgment', 'fixture', 'submission', 'observation'].includes(phase)))
			&& ['GET', 'HEAD'].includes(method) && body == null && url.origin === 'https://checkout.stripe.com'
			&& /^cs_test_[A-Za-z0-9]+$/.test(sessionId ?? '') && url.pathname === `/c/pay/${sessionId}` && !url.search;
	}
	if (!owned(frame) || !['GET', 'HEAD', 'POST'].includes(method)
		|| !['opening', 'acknowledgment', 'fixture', 'submission', 'observation'].includes(phase)) return false;
	return owned(url) || url.hostname === 'm.stripe.network' || url.hostname === 'hcaptcha.com' || url.hostname.endsWith('.hcaptcha.com');
}
export function bypassDestinationAllowed(rawUrl: string): boolean {
	try { const url = new URL(rawUrl); return url.origin === approved.origin && !url.username && !url.password; } catch { return false; }
}
/** Never inherit arbitrary process.env. This is an offline allowlist validator, not a launcher. */
export function validateChildEnvironment(raw: unknown): Record<string, string> {
	return parse(z.object({ PATH: z.string().min(1), HOME: z.string().min(1), TMPDIR: z.string().min(1),
		PLAYWRIGHT_BROWSERS_PATH: z.string().min(1) }).strict(), raw);
}
export type CheckoutAssetBinding = Pick<Manifest, 'releaseId' | 'operationId'> & { job: Pick<Manifest['job'], 'id' | 'nonce' | 'headSha'> };
export function assetName(manifest: CheckoutAssetBinding, phase: 'input' | 'open-proof' | 'submit-proof' | 'ack-intent' | 'submit-intent' | 'final') {
	return `checkout-${manifest.operationId}-${manifest.job.id}-1-${manifest.job.nonce}-${phase}.g2genc`;
}
export function validateAssetSet(raw: unknown, manifest: CheckoutAssetBinding, next: Parameters<typeof assetName>[1]) {
	const rows = parse(z.array(z.object({ id: z.number().int().positive(), name: z.string(), digest: sha,
		size: z.number().int().positive().max(limits.checkpointBytes) }).strict()).max(limits.maxAssets), raw);
	const phases = ['input', 'open-proof', 'submit-proof', 'ack-intent', 'submit-intent', 'final'] as const;
	const names = phases.map(phase => assetName(manifest, phase));
	requirePolicy(rows.every(row => names.includes(row.name)) && new Set(rows.map(row => row.id)).size === rows.length
		&& new Set(rows.map(row => row.name)).size === rows.length && !rows.some(row => row.name === assetName(manifest, next))
		&& rows.length < limits.maxAssets && (next === 'final' || rows.length < limits.maxAssets - 1));
	return rows;
}
export function safeDiagnostic(phase: string, state: string) {
	const phases = ['input', 'opening', 'acknowledgment', 'fixture', 'submission', 'observation', 'cleanup'];
	const states = ['blocked', 'uncertain', 'submitted-pending-settlement', 'cleanup-confirmed', 'cleanup-unknown'];
	return { purePolicy: true, phase: phases.includes(phase) ? phase : 'blocked',
		state: states.includes(state) ? state : 'blocked', privateDetailsWithheld: true, paymentAccepted: false, retryAllowed: false };
}
