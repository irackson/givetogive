// Injected member/process/transport fixtures, actual private fsync/crypto/IPC.
// No provider contact, normal sign-in, native browser or payment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { approved, digest, assetName, type Manifest, type Proof } from '../src/hosted-checkout-policy.ts';
import { runHostedCheckoutParent, checkoutWorkerReceiptSchema, CheckoutParentPreflightFailure, type CheckoutParentRuntime } from '../src/hosted-checkout-parent.ts';
import { createCheckoutBrokerClient, type CheckoutIpcPeer } from '../src/checkout-broker-ipc.ts';
import { decodeProofRequest, createProofResponse } from '../src/checkout-proof-exchange.ts';
import { unseal } from '../src/hosted-community-bundle.ts';
import { retainCheckoutParentFinal } from '../src/checkout-final-retention.ts';
import type { CheckoutPrivateDraft, RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
const NOW = Date.parse('2026-10-08T21:00:00Z'), HEAD = 'b'.repeat(40);
function fixture(mode = 'normal') {
	const root = mkdtempSync(join(tmpdir(), 'g2g-parent-test-')), key = Buffer.alloc(32, 8), calls: string[] = [];
	let now = NOW, live = false, proofRequest: Buffer | undefined, launches = 0, processReads = 0;
	const manifest: Manifest = { protocol: 1, purpose: 'one-member-test-checkout-policy',
		job: { repository: approved.repository, actor: approved.actor, triggeringActor: approved.actor, event: 'workflow_dispatch', ref: 'refs/heads/main', attempt: 1,
			id: '123456789', headSha: HEAD, nonce: 'c'.repeat(32), publicRepository: true, runner: 'ubuntu-24.04', platform: 'linux', nodeMajor: 24 },
		releaseId: 123, createdAt: new Date(NOW).toISOString(), runId: approved.runId, actorId: approved.actorId, operationId: approved.operationId,
		origin: approved.origin, databaseIdentity: approved.databaseIdentity, sourceDigest: approved.sourceDigest, canonicalSourceDigest: approved.canonicalSourceDigest,
		rootLockDigest: approved.rootLockDigest, runnerDigest: approved.runnerDigest, currency: 'usd', maximumAmountCents: 1500, expectedTier: 'sustainer', scenario: 'success',
		budget: { runBudgetCents: 2500, actorBudgetCents: 1500, priorExpiredReservedCents: 1000, candidateReservedCents: 1500, originalAdmissionDigest: '1'.repeat(64), expiredHistoryDigests: ['2'.repeat(64),'3'.repeat(64)], noReset: true },
		rootProof: { observedAt: new Date(NOW).toISOString(), localIsolationVerified: true, normalMemberOnly: true, noMemberTokens: true, noCheckoutSubmitAdmission: true, canonicalCustomerClockVerified: true, releaseVerified: true, supportsTestSubscriptionsOnly: true } };
	const proof: Proof = { protocol: 1, kind: 'local-operator-provider-read', phase: 'open', proofNonce: 'a'.repeat(32), manifestDigest: digest(manifest),
		jobId: manifest.job.id, jobNonce: manifest.job.nonce, headSha: HEAD, runId: manifest.runId, actorId: manifest.actorId, operationId: manifest.operationId,
		verifiedAt: new Date(NOW).toISOString(), platformAccountId: approved.platformAccountId, databaseIdentity: manifest.databaseIdentity,
		customerAccountId: 'acct_fixtureCustomer', sessionId: 'cs_test_fixtureSession', url: 'https://checkout.stripe.com/c/pay/cs_test_fixtureSession',
		livemode: false, currency: 'usd', amountTotal: 1500, mode: 'subscription', status: 'open', paymentStatus: 'unpaid', expiresAt: NOW / 1000 + 3600,
		successUrl: `${approved.origin}/giving/${approved.operationId}?checkout=returned`, cancelUrl: `${approved.origin}/giving/${approved.operationId}?checkout=canceled`,
		providerIdentityVerified: true, canonicalCustomerClockVerified: true, providerInvoiceAbsent: true, providerSubscriptionAbsent: true };
	const input = { manifest, proof, member: { id: approved.memberId, userId: approved.actorId, email: approved.memberEmail, password: 'PUBLIC-OFFLINE-NOT-A-CREDENTIAL' }, stagingBypass: 'PUBLIC-OFFLINE-NOT-A-BYPASS' };
	const worker = checkoutWorkerReceiptSchema.parse({ protocol: 1, purpose: 'member-checkout-worker', state: 'submitted-pending-settlement', failed: false, paymentAccepted: false, retryAllowed: false,
		executionEvidence: 'native-playwright-adapter', durabilityEvidence: 'external-broker-not-worker-filesystem-proof', independentBrokerAndOsProcessVerificationRequired: true, protocolCleanupConfirmed: false,
		apiDisposed: true, browserContextClosed: true, browserDisconnected: true, unresolvedResourceCreation: false, authPosts: 1, memberGets: 12, sessionGets: 6,
		acknowledgmentClickAttempts: 0, submitClickAttempts: 1, consoleErrors: 0, pageErrors: 0, httpErrors: 0, blockedRequests: 0, failedRequests: 0, unexpectedPages: 0,
		signedWebhookCoverageLedgerReviewRequired: true, privateDetailsWithheld: true });
	class Peer extends EventEmitter implements CheckoutIpcPeer {
		other!: Peer;
		send(raw: unknown, callback: (error: Error | null) => void) { queueMicrotask(() => { this.other.emit('message', structuredClone(raw)); callback(null); }); return true; }
	}
	const child = new Peer() as Peer & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
	const member = new Peer(); child.other = member; member.other = child;
	child.pid = 999999; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
	child.kill = () => { if (live) { live = false; queueMicrotask(() => child.emit('exit', 1)); } return true; };
	if (mode === 'send-loss') child.send = () => { queueMicrotask(() => child.emit('error', new Error('PRIVATE-FIXTURE-CHANNEL-ERROR'))); return true; };
	member.once('message', (start: { binding: { manifestDigest: string; connectionNonce: string } }) => {
		void (async () => {
			const client = createCheckoutBrokerClient(member, start.binding);
			try {
				if (mode !== 'unearned-receipt') {
					const fresh = await client.preSubmitProof(new AbortController().signal);
					const intent = { protocol: 1, phase: 'submit-intent', manifestDigest: digest(manifest), operationId: approved.operationId, actorId: approved.actorId,
						jobId: manifest.job.id, jobNonce: manifest.job.nonce, maximumAmountCents: 1500, maximumActions: 1, proofDigest: digest(fresh), paymentAccepted: false, retryAllowed: false };
					const written = await client.writeIntent(intent, new AbortController().signal);
					await client.retainSubmitIntent(intent, written, new AbortController().signal);
				}
				if (mode === 'output') child.stdout.emit('data', Buffer.from('PRIVATE-FIXTURE-OUTPUT'));
				member.send({ protocol: 1, kind: 'checkout-member-receipt', ...start.binding, receipt: mode === 'bad-receipt' ? { ...worker, privateToken: 'PRIVATE-FIXTURE-TOKEN' } : worker }, () => {
					if (mode === 'foreign-file') writeFileSync(join(root, readdirSync(root)[0]!, 'unexpected-trace.har'), 'PUBLIC-OFFLINE-UNSUPPORTED-FIXTURE');
					if (mode === 'large-evidence') {
						const parentDirectory = join(root, readdirSync(root)[0]!);
						const durableDirectory = join(parentDirectory, `checkout-${manifest.operationId}-${manifest.job.id}-${manifest.job.nonce}`);
						writeFileSync(join(durableDirectory, `${assetName(manifest, 'ack-intent')}.intent.json`),
							randomBytes(1024 * 1024), { flag: 'wx', mode: 0o600 });
					}
					client.close(); live = mode === 'orphan'; child.emit('exit', 0);
				});
			} catch { client.close(); child.kill(); }
		})();
	});
	const runtime: CheckoutParentRuntime = { launch: () => { launches++; live = true; return child as unknown as ChildProcess; },
		processes: () => {
			if (mode === 'pid-reuse' && ++processReads === 3) {
				live = false; queueMicrotask(() => child.emit('exit', 1));
				return [{ pid: child.pid, parentPid: 1, processGroup: child.pid, session: child.pid, startTicks: '9999', state: 'S' }];
			}
			return live ? [{ pid: child.pid, parentPid: process.pid, processGroup: child.pid, session: child.pid, startTicks: '1234', state: 'S' }] : [];
		},
		verifySources: () => { calls.push('source'); }, now: () => now, freeBytes: () => 8 * 1024 ** 3,
		pause: async milliseconds => { now += milliseconds; await new Promise(accept => setImmediate(accept)); } };
	const retained = (phase: 'open-proof' | 'submit-intent' | 'final', bytes: Buffer): RetainedCheckoutAsset => ({ phase, assetId: phase === 'open-proof' ? 1 : phase === 'submit-intent' ? 2 : 3,
		name: assetName(manifest, phase), size: bytes.length, ciphertextDigest: createHash('sha256').update(bytes).digest('hex'), releaseId: manifest.releaseId,
		jobId: manifest.job.id, jobNonce: manifest.job.nonce, headSha: HEAD, operationId: approved.operationId, anonymousDraft404: true, anonymousAsset404: true,
		observedAt: new Date(now).toISOString(), exactRetainedAssetVerified: true, readbackVerified: true, retryAllowed: false, paymentAccepted: false });
	const draft = { inspect: async () => ({ releaseId: 123, assets: [], privateDraftVerified: true as const }),
		upload: async (phase: 'open-proof' | 'submit-intent' | 'final', bytes: Buffer) => {
			calls.push(phase); if (phase === 'open-proof') proofRequest = Buffer.from(bytes);
			if (phase === 'final') {
				if (mode === 'final-transfer-error') throw Error('PRIVATE-FIXTURE-TRANSFER-ERROR');
				if (mode === 'final-ciphertext-change') bytes[40] ^= 1;
				if (mode === 'final-original-change') {
					const parentDirectory = join(root, readdirSync(root)[0]!);
					writeFileSync(join(parentDirectory, 'member-receipt.json'), JSON.stringify({ ...worker, changed: true }));
				}
				if (mode === 'final-bad-receipt') return { ...retained(phase, bytes), readbackVerified: false };
				if (mode === 'final-extra-field') return { ...retained(phase, bytes), privateDetail: 'PUBLIC-OFFLINE-UNREVIEWED-FIELD' };
			}
			return retained(phase, bytes);
		},
		download: async () => { assert.ok(proofRequest); const request = decodeProofRequest(proofRequest, key, manifest, proof, now);
			return createProofResponse(request, manifest, proof, { ...proof, phase: 'pre-submit', proofNonce: 'd'.repeat(32), verifiedAt: new Date(now).toISOString() }, key, now); },
	} as unknown as Pick<CheckoutPrivateDraft, 'upload' | 'download' | 'inspect'>;
	const options = { root, key, draft, runtime, memberEnvironment: { PATH: '/usr/bin', HOME: '/tmp/public-fixture', TMPDIR: '/tmp/public-fixture', PLAYWRIGHT_BROWSERS_PATH: '/tmp/public-browsers' } };
	return { input, options, root, calls, launches: () => launches, advanceNow: (value:number) => { assert.ok(value>=now);now=value; } };
}

test('parent integration retains real originals through sole ordered encrypted proof and submit exchanges', async () => {
	const f = fixture(); const receipt = await runHostedCheckoutParent(f.input, HEAD, f.options);
	assert.equal(receipt.failed, false); assert.equal(receipt.executionEvidence, 'injected-offline-runtime');
	assert.equal(receipt.paymentAccepted, false); assert.equal(receipt.privateFinalRetentionStillRequired, false);
	assert.deepEqual(f.calls, ['source','open-proof','submit-intent','final']);
	const directory = join(f.root, readdirSync(f.root)[0]!);
	assert.equal(JSON.parse(readFileSync(join(directory, 'parent-receipt.json'), 'utf8')).paymentAccepted, false);
	const message = JSON.parse(readFileSync(join(directory, 'member-message.json'), 'utf8')) as { ciphertext: string };
	assert.equal((unseal(Buffer.from(message.ciphertext, 'base64'), f.options.key) as { kind: string }).kind, 'checkout-member-receipt');
	const final = unseal(readFileSync(join(directory, assetName(f.input.manifest, 'final'))), f.options.key) as { files: Array<{name: string; bytes: string}>; paymentAccepted: boolean };
	assert.equal(final.paymentAccepted, false);
	assert.ok(final.files.some(file => file.name.endsWith('-submit-intent.g2genc.intent.json')));
	assert.ok(final.files.some(file => file.name === 'member-message.json'));
	await assert.rejects(runHostedCheckoutParent(f.input, HEAD, f.options)); assert.equal(f.launches(), 1);
});

test('bounded original files may produce an encrypted final bundle larger than one original file', async () => {
	const f = fixture('large-evidence'); const receipt = await runHostedCheckoutParent(f.input, HEAD, f.options);
	assert.equal(receipt.failed, false); assert.equal(receipt.paymentAccepted, false);
	const directory = join(f.root, readdirSync(f.root)[0]!);
	assert.ok(readFileSync(join(directory, assetName(f.input.manifest, 'final'))).length > 1024 * 1024);
	assert.equal(f.calls.filter(phase => phase === 'final').length, 1);
});

test('uncertain final upload, changed originals/ciphertext or false private readback retain evidence and cannot repeat transport', async () => {
	for (const mode of ['final-transfer-error','final-ciphertext-change','final-original-change','final-bad-receipt','final-extra-field']) {
		const f = fixture(mode);
		await assert.rejects(runHostedCheckoutParent(f.input, HEAD, f.options), error => String(error) === 'Error: Private Checkout final retention failed; originals retained; no automatic retry.');
		assert.equal(f.calls.filter(phase => phase === 'final').length, 1);
		const directory = join(f.root, readdirSync(f.root)[0]!);
		assert.ok(readdirSync(directory).includes('final-upload.intent.json'));
		assert.ok(readdirSync(directory).includes(assetName(f.input.manifest, 'final')));
		assert.equal(readdirSync(directory).includes('final-upload.result.json'), false);
		await assert.rejects(retainCheckoutParentFinal(f.input.manifest, HEAD, f.root, f.options.key,
			async () => { assert.fail('Repeated final upload must not execute'); }, new AbortController().signal, () => NOW));
		assert.equal(f.calls.filter(phase => phase === 'final').length, 1);
	}
});

test('unearned, malformed, noisy or surviving-process receipts never satisfy parent closure', async () => {
	for (const mode of ['unearned-receipt','bad-receipt','output','orphan','pid-reuse','send-loss']) {
		const f = fixture(mode); const receipt = await runHostedCheckoutParent(f.input, HEAD, f.options);
		assert.equal(receipt.failed, true, mode); assert.equal(receipt.parentObservedProtocolClosure, false, mode);
		assert.equal(receipt.paymentAccepted, false); assert.equal(receipt.retryAllowed, false);
		assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE-FIXTURE|privateToken/);
		if (mode === 'bad-receipt') {
			const directory = join(f.root, readdirSync(f.root)[0]!);
			const original = JSON.parse(readFileSync(join(directory, 'member-message.json'), 'utf8'));
			assert.doesNotMatch(JSON.stringify(original), /PRIVATE-FIXTURE|privateToken/);
			assert.equal((unseal(Buffer.from(original.ciphertext, 'base64'), f.options.key) as { receipt: { privateToken: string } }).receipt.privateToken, 'PRIVATE-FIXTURE-TOKEN');
		}
	}
});

test('unexpected capture files cannot enter the encrypted final bundle or invoke transport', async () => {
	const f = fixture('foreign-file');
	await assert.rejects(runHostedCheckoutParent(f.input, HEAD, f.options));
	assert.equal(f.calls.includes('final'), false);
	const directory = join(f.root, readdirSync(f.root)[0]!);
	assert.ok(readdirSync(directory).includes('parent-receipt.json'));
	assert.equal(readdirSync(directory).includes(assetName(f.input.manifest, 'final')), false);
});

test('source, environment, memory and pre-abort failures happen before member launch or lease admission', async () => {
	for (const mode of ['source','environment','memory','abort']) {
		const f = fixture(); const controller = new AbortController();
		if (mode === 'source') f.options.runtime.verifySources = () => { throw Error('private source fixture'); };
		if (mode === 'environment') Object.assign(f.options.memberEnvironment, { STRIPE_SECRET_KEY: 'PRIVATE-FIXTURE' });
		if (mode === 'memory') f.options.runtime.freeBytes = () => 1024;
		if (mode === 'abort') controller.abort();
		await assert.rejects(runHostedCheckoutParent(f.input, HEAD, { ...f.options, signal: controller.signal }), error => {
			assert.ok(error instanceof CheckoutParentPreflightFailure);
			assert.equal(error.phase,mode); assert.equal(error.memberLaunchAdmitted,false);
			assert.doesNotMatch(error.message,/private source fixture|PRIVATE-FIXTURE/); return true;
		});
		assert.equal(f.launches(), 0); assert.deepEqual(readdirSync(f.root), []);
	}
});

test('a durable-parent initialization failure after lease keeps an original failed final without launching or claiming closure',async()=>{
	const f=fixture();let reads=0;
	const originalNow=f.options.runtime.now;
	f.options.runtime.now=()=>{if(reads++===1)f.advanceNow(NOW+300001);return originalNow();};
	const result=await runHostedCheckoutParent(f.input,HEAD,f.options);
	assert.equal(f.launches(),0);assert.equal(result.failed,true);assert.equal(result.worker,null);
	assert.equal(result.processClosure,null);assert.equal(result.parentObservedProtocolClosure,false);
	assert.equal(result.paymentAccepted,false);assert.equal(result.retryAllowed,false);
	assert.equal(result.privateFinalRetentionStillRequired,false);assert.deepEqual(f.calls,['source','final']);
});
