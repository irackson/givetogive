/** PURE STATE MACHINE. No filesystem, network, env, auth, provider or browser execution.
 * Adapter evidence must be independently obtained and reviewed. This module cannot confer paid acceptance. */
import { z } from 'zod';
import { seal, unseal } from './hosted-community-bundle.ts';
import { approved, limits, digest, requirePolicy, reject, validateInput, validateManifest, validateProof, validateIdentity, checkMemory,
	assetName, type Manifest, type Proof, type Identity } from './hosted-checkout-policy.ts';

const sha = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.iso.datetime();
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); if (!result.success) reject(); return result.data; }
export function encryptInput(raw: unknown, key: Buffer, head: string, now: number): Buffer {
	const value = validateInput(raw, head, now); requirePolicy(Buffer.byteLength(JSON.stringify(value)) <= limits.inputBytes);
	try { const bytes = seal(value, key); requirePolicy(bytes.length <= limits.inputBytes + 65536); return bytes; } catch { reject(); }
}
export function decryptInput(bytes: Buffer, key: Buffer, head: string, now: number) {
	requirePolicy(Buffer.isBuffer(bytes) && bytes.length > 36 && bytes.length <= limits.inputBytes + 65536);
	try { const raw = unseal(bytes, key); requirePolicy(Buffer.byteLength(JSON.stringify(raw)) <= limits.inputBytes);
		return validateInput(raw, head, now); } catch { reject(); }
}
const surfaceSchema = z.object({ observedAt: timestamp, testModeLabel: z.boolean(), visibleCard: z.boolean(),
	panelCount: z.number().int().min(0).max(1), panelDigest: sha.nullable(),
	controlName: z.string().max(100), controlCount: z.number().int().min(0).max(1), visible: z.boolean(), enabled: z.boolean(),
	unchecked: z.boolean(), optionalLinkDeferred: z.literal(true), requiresCaptchaOrWalletOrAttestation: z.literal(false),
	unknownInstructions: z.literal(false), consoleErrors: z.literal(0), pageErrors: z.literal(0), httpErrors: z.literal(0) }).strict();
const durableSchema = z.object({ name: z.string(), digest: sha, exclusive: z.literal(true), fsynced: z.literal(true) }).strict();
const intentSchema = z.object({ protocol: z.literal(1), phase: z.enum(['ack-intent', 'submit-intent']), manifestDigest: sha,
	operationId: z.literal(approved.operationId), actorId: z.literal(approved.actorId), jobId: z.string().regex(/^[1-9][0-9]{0,19}$/),
	jobNonce: z.string().regex(/^[a-f0-9]{32}$/), maximumAmountCents: z.literal(1500), maximumActions: z.literal(1),
	proofDigest: sha.optional(), paymentAccepted: z.literal(false), retryAllowed: z.literal(false) }).strict();
const ackSchema = z.object({ name: z.string(), assetId: z.number().int().positive(), size: z.number().int().min(37).max(limits.checkpointBytes),
	ciphertextDigest: sha, originalIntentDigest: sha, releaseId: z.number().int().positive(), jobId: z.string(),
	jobNonce: z.string(), headSha: z.string(), operationId: z.string(), observedAt: timestamp,
	draftStillPrivate: z.literal(true), anonymousDraft404: z.literal(true), anonymousAsset404: z.literal(true),
	exclusiveUpload: z.literal(true), exactRetainedAssetVerified: z.literal(true), encryptedOriginalBytes: z.literal(true) }).strict();
export type State = 'initial' | 'open-attested' | 'ack-required' | 'ack-intent-written' | 'fixture-ready'
	| 'fixture-entered' | 'submit-intent-written' | 'submit-admitted' | 'submitted-pending-settlement' | 'uncertain' | 'blocked';
/** Durability/asset acknowledgments are trusted ADAPTER evidence to be implemented and reviewed separately.
 * This pure module never writes a journal, uploads assets, clicks a control or claims those actions happened. */
export class CheckoutProtocol {
	readonly manifest: Manifest;
	private opening?: Proof; private submission?: Proof;
	private openingIdentity?: Identity; private submissionIdentity?: Identity;
	private current: State = 'initial';
	private pendingIntent?: Record<string, unknown>;
	private cleanupConfirmed = false;
	private closed = false;
	constructor(manifest: unknown, expectedHead: string, now: number) {
		const value = validateManifest(manifest, expectedHead, now);
		const freeze = (object: object): void => { for (const child of Object.values(object)) if (child && typeof child === 'object') freeze(child); Object.freeze(object); };
		freeze(value); this.manifest = value;
	}
	get state(): State { return this.current; }
	private fail(): never { this.current = ['ack-intent-written', 'submit-intent-written', 'submit-admitted', 'submitted-pending-settlement', 'uncertain'].includes(this.current) ? 'uncertain' : 'blocked'; reject(); }
	private guard(value: unknown): asserts value { if (!value || this.closed) this.fail(); }
	private bounded<T>(action: () => T): T { try { return action(); } catch { this.fail(); } }
	attestOpen(raw: unknown, identity: unknown, freeBytes: number, now: number) {
		return this.bounded(() => { this.guard(this.current === 'initial'); checkMemory(freeBytes, true); this.openingIdentity = validateIdentity(identity, now);
			this.opening = validateProof(raw, this.manifest, 'open', now); this.current = 'open-attested'; });
	}
	private surface(raw: unknown, now: number, ready: boolean) {
		const value = parse(surfaceSchema, raw), age = now - Date.parse(value.observedAt);
		this.guard(Number.isFinite(now) && age >= -limits.futureSkewMs && age <= limits.surfaceAgeMs);
		if (value.panelCount === 1) this.guard(!ready && value.panelDigest === approved.panelDigest && value.controlName === approved.controlName
			&& value.controlCount === 1 && value.visible && value.enabled && value.unchecked);
		else this.guard(value.panelDigest === null && value.controlCount === 0 && value.controlName === '' && !value.visible && !value.enabled
			&& !value.unchecked && value.testModeLabel && value.visibleCard);
		return value;
	}
	observeSurface(raw: unknown, now: number) {
		return this.bounded(() => { this.guard(this.current === 'open-attested'); const value = parse(surfaceSchema, raw);
			this.surface(value, now, false);
			this.current = value.panelCount ? 'ack-required' : 'fixture-ready'; });
	}
	acknowledgmentIntent() {
		return this.bounded(() => { this.guard(this.current === 'ack-required'); return this.intent('ack-intent'); });
	}
	admitAcknowledgment(rawDurable: unknown) {
		return this.bounded(() => { this.guard(this.current === 'ack-required'); this.verifyDurable(rawDurable, this.intent('ack-intent'));
			this.current = 'ack-intent-written'; });
	}
	recordAcknowledgment(result: 'transition-observed' | 'uncertain', postSurface: unknown, now: number) {
		return this.bounded(() => { this.guard(this.current === 'ack-intent-written');
			if (result === 'uncertain') { this.current = 'uncertain'; return; }
			this.guard(result === 'transition-observed'); this.surface(postSurface, now, true); this.current = 'fixture-ready'; });
	}
	recordFixture(raw: unknown, freeBytes: number, surface: unknown, now: number) {
		return this.bounded(() => { this.guard(this.current === 'fixture-ready'); checkMemory(freeBytes, false);
			this.surface(surface, now, true);
			parse(z.object({ scenario: z.literal('success'), publicFixtureOnly: z.literal(true),
				visibleDocumentedControls: z.literal(true), noProviderInstructionsRemain: z.literal(true),
				noFinancialSubmit: z.literal(true) }).strict(), raw); this.current = 'fixture-entered'; });
	}
	prepareSubmitIntent(rawProof: unknown, identity: unknown, freeBytes: number, now: number) {
		return this.bounded(() => { this.guard(this.current === 'fixture-entered' && this.opening && !this.submission && !this.pendingIntent); checkMemory(freeBytes, false);
			this.guard(this.openingIdentity); this.submissionIdentity = validateIdentity(identity, now, this.openingIdentity);
			this.submission = validateProof(rawProof, this.manifest, 'pre-submit', now, this.opening);
			this.pendingIntent = this.intent('submit-intent'); return structuredClone(this.pendingIntent); });
	}
	admitSubmitIntent(rawDurable: unknown) {
		return this.bounded(() => { this.guard(this.current === 'fixture-entered' && this.pendingIntent);
			this.verifyDurable(rawDurable, this.pendingIntent); this.current = 'submit-intent-written'; });
	}
	acknowledgeCheckpoint(raw: unknown, expectedCiphertextDigest: string, now: number, freeBytes: number, identity: unknown, surface: unknown) {
		return this.bounded(() => { this.guard(this.current === 'submit-intent-written' && this.submission && this.pendingIntent);
			this.guard(this.submissionIdentity && this.openingIdentity);
			const finalIdentity = validateIdentity(identity, now, this.submissionIdentity);
			this.guard(finalIdentity.verificationNonce !== this.openingIdentity.verificationNonce);
			this.surface(surface, now, true);
			const value = parse(ackSchema, raw); checkMemory(freeBytes, false);
			parse(sha, expectedCiphertextDigest);
			validateProof(this.submission, this.manifest, 'pre-submit', now, this.opening);
			const age = now - Date.parse(value.observedAt);
			this.guard(age >= -5000 && age <= 30000 && value.name === assetName(this.manifest, 'submit-intent')
				&& value.originalIntentDigest === digest(this.pendingIntent) && value.ciphertextDigest === expectedCiphertextDigest
				&& value.releaseId === this.manifest.releaseId && value.jobId === this.manifest.job.id
				&& value.jobNonce === this.manifest.job.nonce && value.headSha === this.manifest.job.headSha
				&& value.operationId === this.manifest.operationId);
			this.current = 'submit-admitted'; return { maximumClicks: 1, paymentAccepted: false, retryAllowed: false } as const; });
	}
	/** Conservatively classify click admission as possibly sent. Never move backward to fixture-ready. */
	recordSubmitOutcome(outcome: 'clicked' | 'uncertain') {
		return this.bounded(() => { this.guard(this.current === 'submit-admitted');
			this.current = outcome === 'clicked' ? 'submitted-pending-settlement' : 'uncertain'; });
	}
	cancel() { this.current = ['submit-admitted', 'submitted-pending-settlement', 'submit-intent-written', 'ack-intent-written', 'uncertain'].includes(this.current) ? 'uncertain' : 'blocked'; }
	cleanup(raw: unknown) {
		this.closed = true;
		return this.bounded(() => { const value = parse(z.object({ browserProcessClosed: z.boolean(), browserContextClosed: z.boolean(),
			apiDisposed: z.boolean(), ownedLiveProcesses: z.number().int().nonnegative(), noUnresolvedClosure: z.boolean() }).strict(), raw);
			this.cleanupConfirmed = value.browserProcessClosed && value.browserContextClosed && value.apiDisposed
				&& value.ownedLiveProcesses === 0 && value.noUnresolvedClosure; return this.receipt(); });
	}
	receipt() { return { protocol: 1, purePolicy: true, operationId: this.manifest.operationId, state: this.current,
		cleanupConfirmed: this.cleanupConfirmed, adapterEvidenceRequired: true, originalAdmissionBindingRetained: true, paymentAccepted: false,
		signedWebhookCoverageLedgerReviewRequired: true, retryAllowed: false }; }
	private intent(phase: 'ack-intent' | 'submit-intent'): Record<string, unknown> {
		return { protocol: 1, phase, manifestDigest: digest(this.manifest), operationId: this.manifest.operationId,
			actorId: this.manifest.actorId, jobId: this.manifest.job.id, jobNonce: this.manifest.job.nonce,
			maximumAmountCents: 1500, maximumActions: 1, ...(phase === 'submit-intent' ? { proofDigest: digest(this.submission) } : {}),
			paymentAccepted: false, retryAllowed: false };
	}
	private verifyDurable(raw: unknown, intent: Record<string, unknown>) {
		const value = parse(durableSchema, raw); const phase = intent.phase === 'ack-intent' ? 'ack-intent' : 'submit-intent';
		this.guard(value.name === `${assetName(this.manifest, phase)}.intent.json` && value.digest === digest(intent));
	}
}
export function encryptCheckpoint(manifest: Manifest, raw: unknown, key: Buffer): Buffer {
	try { const intent = parse(intentSchema, raw);
		requirePolicy(intent.manifestDigest === digest(manifest) && intent.jobId === manifest.job.id && intent.jobNonce === manifest.job.nonce
			&& (intent.phase === 'submit-intent' ? !!intent.proofDigest : intent.proofDigest === undefined));
		const envelope = { protocol: 1, kind: 'original-checkout-intent', manifestDigest: digest(manifest), intent };
		requirePolicy(Buffer.byteLength(JSON.stringify(envelope)) <= limits.checkpointBytes); const bytes = seal(envelope, key);
		requirePolicy(bytes.length <= limits.checkpointBytes + 65536); return bytes; } catch { reject(); }
}
