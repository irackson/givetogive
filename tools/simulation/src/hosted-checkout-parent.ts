/** Explicit Checkout parent adapter. Import is inert; no credential loading.
 * Root retains Stripe/SQL authority. This parent holds only the private transfer
 * key/token, and launches one ordinary-cookie member with an exact environment.
 * The caller must privately retain returned originals and reconcile settlement. */
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { releaseSourceDigest } from '../../../scripts/release-rehearsal-fingerprint.mjs';
import { digest, validateInput, validateChildEnvironment, checkMemory, type Manifest } from './hosted-checkout-policy.ts';
import type { CheckoutPrivateDraft } from './hosted-checkout-github.ts';
import { CheckoutDurableParent } from './checkout-durable-parent.ts';
import { attachCheckoutBrokerParent, type CheckoutIpcPeer } from './checkout-broker-ipc.ts';
import { CheckoutProcessObservation, readCheckoutProcessTable, type CheckoutProcessIdentity } from './checkout-process-observation.ts';
import { seal } from './hosted-community-bundle.ts';
import { retainCheckoutParentFinal } from './checkout-final-retention.ts';

export const checkoutRunnerFiles = [
	'hosted-checkout-parent.ts', 'checkout-hosted-member.mjs', 'hosted-checkout-worker.ts',
	'checkout-broker-ipc.ts', 'checkout-durable-parent.ts', 'checkout-proof-exchange.ts',
	'checkout-process-observation.ts', 'hosted-checkout-github.ts', 'hosted-checkout-protocol.ts',
	'hosted-community-attention.ts', 'hosted-community-bundle.ts', 'hosted-community-policy.ts',
	'checkout-final-retention.ts',
	'checkout-readiness.ts',
	'checkout-bootstrap.ts', 'checkout-input-mailbox.ts',
	'checkout-browser-smoke.ts', 'hosted-community.ts',
	'checkout-bootstrap-retention.ts',
	'checkout-current-preflight.ts',
	'checkout-candidate-budget.ts',
	'checkout-current-profile.ts',
	'checkout-current-input.ts', 'sandbox-policy.ts',
	'checkout-current-draft.ts',
	'checkout-current-phase.ts', 'stripe-checkout-driver.ts', 'protection.ts',
	'checkout-current-member.ts', 'ui-session.ts', 'config.ts', 'browser.ts',
	'protocol.ts', 'semaphore.ts',
	'checkout-current-ipc.ts', 'checkout-current-member-entry.mjs',
	'checkout-current-parent.ts',
	'checkout-current-exchange.ts',
	'checkout-current-provider.ts', 'checkout-current-root.ts', 'sandbox-ledger.ts',
	'checkout-prepared-budget.ts', 'sandbox-plan.ts',
	'checkout-current-responder.ts',
	'checkout-current-coordinate.ts',
	'checkout-current-job.ts', 'checkout-current-bootstrap.ts',
	'checkout-root-responder.ts', 'checkout-provider-proof.ts', 'checkout-readiness-observer.ts', 'checkout-root-preparation.ts', 'checkout-original-budget.ts',
] as const;
const base = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = resolve(base, '../..');
const fail = (): never => { throw new Error('Hosted Checkout parent stopped; originals retained; no automatic retry.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
/** Raised only by checks before any parent namespace, lease or child launch. */
export class CheckoutParentPreflightFailure extends Error {
	readonly memberLaunchAdmitted = false;
	readonly phase: 'input' | 'environment' | 'key' | 'source' | 'memory' | 'abort';
	constructor(phase: CheckoutParentPreflightFailure['phase']) {
		super('Hosted Checkout parent preflight rejected; no member launch admitted; no retry.');
		this.phase = phase;
	}
}

/** Policy approval is excluded from its own hash to avoid a circular digest;
 * the exact reviewed Git head independently binds that policy and all code. */
export function checkoutParentSourceSnapshot(expectedHead: string) {
	guard(process.platform === 'linux' && process.versions.node.split('.')[0] === '24');
	guard(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim() === expectedHead);
	// The self-excluded approval policy must still be the reviewed HEAD's bytes.
	execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'tools/simulation/src/hosted-checkout-policy.ts'], { cwd: repositoryRoot, stdio: 'ignore' });
	const canonicalSourceDigest = releaseSourceDigest(repositoryRoot);
	const rootLockDigest = createHash('sha256').update(readFileSync(join(repositoryRoot, 'package-lock.json'))).digest('hex');
	const hash = createHash('sha256');
	for (const name of checkoutRunnerFiles) {
		const path = join(base, 'src', name); guard(!lstatSync(path).isSymbolicLink());
		hash.update(name).update('\0').update(readFileSync(path)).update('\0');
	}
	hash.update('package-lock.json').update('\0').update(readFileSync(join(base, 'package-lock.json'))).update('\0');
	const workflowName = '.github/workflows/checkout-staging.yml';
	hash.update(workflowName).update('\0').update(readFileSync(join(repositoryRoot, workflowName))).update('\0');
	const currentWorkflow = '.github/workflows/checkout-current-staging.yml';
	hash.update(currentWorkflow).update('\0').update(readFileSync(join(repositoryRoot, currentWorkflow))).update('\0');
	return { canonicalSourceDigest, rootLockDigest, runnerDigest: hash.digest('hex') };
}
export function verifyCheckoutParentSources(manifest: Manifest) {
	const actual = checkoutParentSourceSnapshot(manifest.job.headSha);
	guard(actual.canonicalSourceDigest === manifest.canonicalSourceDigest && actual.rootLockDigest === manifest.rootLockDigest && actual.runnerDigest === manifest.runnerDigest);
}

const count = z.number().int().min(0).max(1000000);
export const checkoutWorkerReceiptSchema = z.object({
	protocol: z.literal(1), purpose: z.literal('member-checkout-worker'),
	state: z.enum(['initial','open-attested','ack-required','ack-intent-written','fixture-ready','fixture-entered','submit-intent-written','submit-admitted','submitted-pending-settlement','uncertain','blocked']),
	failed: z.boolean(), paymentAccepted: z.literal(false), retryAllowed: z.literal(false),
	executionEvidence: z.literal('native-playwright-adapter'),
	durabilityEvidence: z.literal('external-broker-not-worker-filesystem-proof'),
	independentBrokerAndOsProcessVerificationRequired: z.literal(true), protocolCleanupConfirmed: z.literal(false),
	apiDisposed: z.boolean(), browserContextClosed: z.boolean(), browserDisconnected: z.boolean(), unresolvedResourceCreation: z.boolean(),
	authPosts: count.max(1), memberGets: count, sessionGets: count, acknowledgmentClickAttempts: count.max(1), submitClickAttempts: count.max(1),
	consoleErrors: count, pageErrors: count, httpErrors: count, blockedRequests: count, failedRequests: count, unexpectedPages: count,
	signedWebhookCoverageLedgerReviewRequired: z.literal(true), privateDetailsWithheld: z.literal(true),
}).strict();
type WorkerReceipt = z.infer<typeof checkoutWorkerReceiptSchema>;
export interface CheckoutParentRuntime {
	launch(environment: Record<string, string>): ChildProcess;
	processes(): CheckoutProcessIdentity[];
	verifySources(manifest: Manifest): void;
	now(): number;
	freeBytes(): number;
	pause(milliseconds: number): Promise<unknown>;
}
function contained(path: string) {
	for (let cursor = path;; cursor = dirname(cursor)) {
		if (existsSync(cursor)) guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
		if (dirname(cursor) === cursor) break;
	}
}
function original(directory: string, name: string, value: unknown) {
	contained(directory); guard(/^[a-z-]+\.json$/.test(name));
	const bytes = Buffer.from(JSON.stringify(value)); guard(bytes.length <= 131072);
	const path = join(directory, name), fd = openSync(path, 'wx', 0o600);
	try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
	if (process.platform === 'linux') { const directoryFd = openSync(directory, 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); } }
	try { guard(readFileSync(path).equals(bytes)); } finally { bytes.fill(0); }
}

/** A returned receipt is private test evidence, never authority to retry or grant.
 * Runtime injection is only for offline tests and can never produce native evidence. */
export async function runHostedCheckoutParent(raw: unknown, expectedHead: string, options: {
	root: string; key: Buffer; draft: Pick<CheckoutPrivateDraft, 'upload' | 'download' | 'inspect'>;
	memberEnvironment: unknown; signal?: AbortSignal; runtime?: CheckoutParentRuntime;
}) {
	const injected = options.runtime !== undefined;
	const runtime: CheckoutParentRuntime = options.runtime ?? {
		launch: environment => fork(fileURLToPath(new URL('./checkout-hosted-member.mjs', import.meta.url)), ['--execute-hosted-member'], {
			cwd: base, execArgv: ['--experimental-strip-types'], detached: true,
			env: environment, stdio: ['ignore','pipe','pipe','ipc'], serialization: 'json',
		}), processes: readCheckoutProcessTable, verifySources: verifyCheckoutParentSources,
		now: Date.now, freeBytes: freemem, pause: milliseconds => sleep(milliseconds),
	};
	let preflightPhase: CheckoutParentPreflightFailure['phase'] = 'input';
	let input: ReturnType<typeof validateInput>, environment: Record<string,string>;
	try {
		input = validateInput(raw, expectedHead, runtime.now());
		preflightPhase = 'environment'; environment = validateChildEnvironment(options.memberEnvironment);
		preflightPhase = 'key'; guard(Buffer.isBuffer(options.key) && options.key.length === 32);
		preflightPhase = 'source'; runtime.verifySources(input.manifest);
		preflightPhase = 'memory'; checkMemory(runtime.freeBytes(), true);
		preflightPhase = 'abort'; options.signal?.throwIfAborted();
	} catch { throw new CheckoutParentPreflightFailure(preflightPhase); }
	const directory = join(resolve(options.root), `checkout-parent-${input.manifest.operationId}-${input.manifest.job.id}-${input.manifest.job.nonce}`);
	contained(directory); guard(lstatSync(dirname(directory)).isDirectory()); mkdirSync(directory, { mode: 0o700 });
	if (process.platform === 'linux') { const fd = openSync(dirname(directory), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
	// Exclusive, flushed admission before any child launch; a second call cannot restart it.
	original(directory, 'parent-lease.json', { manifestDigest: digest(input.manifest), expectedHead, retryAllowed: false, paymentAccepted: false });
	const binding = { manifestDigest: digest(input.manifest), connectionNonce: randomBytes(16).toString('hex') };
	const cancellation = new AbortController(), deadline = AbortSignal.timeout(210000);
	const signal = AbortSignal.any([cancellation.signal, deadline, ...(options.signal ? [options.signal] : [])]);
	let durable: CheckoutDurableParent | undefined;
	let child: ChildProcess | undefined, broker: ReturnType<typeof attachCheckoutBrokerParent> | undefined;
	let processes: CheckoutProcessObservation | undefined, receipt: WorkerReceipt | undefined;
	let ownedMember: CheckoutProcessIdentity | undefined, memberLive = false;
	let exitCode: number | null = null, exited = false, failed = false, outputBytes = 0, interval: ReturnType<typeof setInterval> | undefined;
	let closure: ReturnType<CheckoutProcessObservation['inspect']> | undefined;
	let stopRequested = false;
	const stop = () => {
		if (stopRequested) return; stopRequested = true;
		cancellation.abort(); broker?.close();
		if (!child) return;
		// Never signal a PID whose kernel identity changed while exit delivery lagged.
		if (ownedMember) {
			try {
				const current = runtime.processes().find(row => row.pid === ownedMember!.pid);
				if (current?.startTicks === ownedMember.startTicks && !['Z','X','x'].includes(current.state ?? '')) child.kill('SIGTERM');
			} catch { /* Ownership observation unavailable: no signal or closure claim. */ }
		} else if (child.connected) child.disconnect(); // Unadmitted member stops on IPC loss.
	};
	const sample = () => { if (processes) {
		const table = runtime.processes();
		memberLive = table.some(row => row.pid === ownedMember?.pid && row.startTicks === ownedMember.startTicks && !['Z','X','x'].includes(row.state ?? ''));
		closure = processes.inspect(table); if (closure.escapedDescendantObserved) fail();
	} };
	const active = () => {
		signal.throwIfAborted(); checkMemory(runtime.freeBytes(), false); sample();
		guard(memberLive && !exited && !failed && outputBytes === 0);
	};
	const onMessage = (rawMessage: unknown) => {
		try {
			guard(Buffer.byteLength(JSON.stringify(rawMessage)) <= 65536);
			const envelope = z.object({ protocol: z.literal(1), kind: z.literal('checkout-member-receipt'),
				manifestDigest: z.literal(binding.manifestDigest), connectionNonce: z.literal(binding.connectionNonce), receipt: checkoutWorkerReceiptSchema }).strict();
			if (rawMessage && typeof rawMessage === 'object' && 'kind' in rawMessage && rawMessage.kind === 'checkout-member-receipt') {
				guard(!receipt);
				// Preserve original private IPC bytes encrypted BEFORE validating them;
				// malformed/partial evidence is not silently replaced by parsed output.
				const encrypted = seal(rawMessage, options.key);
				try { original(directory, 'member-message.json', { ciphertext: encrypted.toString('base64'), ciphertextDigest: createHash('sha256').update(encrypted).digest('hex') }); }
				finally { encrypted.fill(0); }
				receipt = envelope.parse(rawMessage).receipt;
				original(directory, 'member-receipt.json', receipt);
			} else guard(rawMessage && typeof rawMessage === 'object' && 'kind' in rawMessage &&
				['checkout-broker-request','checkout-broker-cancel'].includes(String(rawMessage.kind)));
		} catch { failed = true; stop(); }
	};
	try {
		durable = new CheckoutDurableParent(directory, input.manifest, expectedHead, options.key,
			(phase, bytes, admitted) => options.draft.upload(phase, bytes, admitted), runtime.now);
		await options.draft.inspect(signal); signal.throwIfAborted();
		// Revalidate proof after private IO and immediately before member admission.
		validateInput(input, expectedHead, runtime.now());
		child = runtime.launch(environment); guard(child.pid);
		child.on('exit', code => { exitCode = code; exited = true; });
		child.on('error', () => { failed = true; exited = true; stop(); });
		const unexpectedOutput = (bytes: Buffer) => { outputBytes += bytes.length; failed = true; stop(); };
		child.stdout?.on('data', unexpectedOutput); child.stderr?.on('data', unexpectedOutput);
		const started = runtime.now();
		while (!processes && runtime.now() - started < 5000 && !exited) {
			const root = runtime.processes().find(row => row.pid === child!.pid);
			if (root) { processes = new CheckoutProcessObservation(root, process.pid); ownedMember = { ...root }; }
			else await runtime.pause(25);
		}
		guard(processes); sample();
		broker = attachCheckoutBrokerParent(child as unknown as CheckoutIpcPeer, binding, {
			writeIntent: async (intent, admitted) => { active(); return durable!.writeIntent(intent, AbortSignal.any([signal, admitted])); },
			retainSubmitIntent: async (intent, written, admitted) => { active(); return durable!.retainSubmitIntent(intent, written, AbortSignal.any([signal, admitted])); },
			preSubmitProof: async admitted => { active(); return durable!.requestPreSubmitProof(input.proof, options.draft, AbortSignal.any([signal, admitted])); },
		});
		child.on('message', onMessage); signal.addEventListener('abort', stop, { once: true });
		interval = setInterval(() => { if (exited) return; try { active(); } catch { failed = true; stop(); } }, 100);
		await new Promise<void>((accept, reject) => {
			const interrupted = () => { cleanup(); reject(new Error('Private member start interrupted.')); };
			const timer = setTimeout(interrupted, 5000);
			const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', interrupted); };
			signal.addEventListener('abort', interrupted, { once: true });
			if (signal.aborted) { interrupted(); return; }
			try {
				child!.send({ protocol: 1, kind: 'checkout-member-start', expectedHead, binding, input }, error => {
					cleanup(); if (error) reject(new Error('Private member start unavailable.')); else accept();
				});
			} catch { interrupted(); }
		});
		while (!exited && !signal.aborted) await runtime.pause(25);
		guard(exited && exitCode === 0 && receipt && !receipt.failed && !failed && outputBytes === 0 && broker.phase === 'retained');
		guard(receipt.state === 'submitted-pending-settlement' && receipt.submitClickAttempts === 1 && receipt.authPosts === 1 &&
			receipt.memberGets >= 8 && receipt.sessionGets >= 6 && receipt.apiDisposed && receipt.browserContextClosed && receipt.browserDisconnected && !receipt.unresolvedResourceCreation);
		guard([receipt.consoleErrors,receipt.pageErrors,receipt.httpErrors,receipt.blockedRequests,receipt.failedRequests,receipt.unexpectedPages].every(value => value === 0));
	} catch { failed = true; stop(); }
	finally {
		if (interval) clearInterval(interval); broker?.close();
		const until = runtime.now() + 35000;
		while (processes && runtime.now() < until) {
			try { sample(); if (closure?.ownedGroupClosed) break; } catch { failed = true; break; }
			await runtime.pause(25);
		}
		if (!exited || !closure?.ownedGroupClosed) failed = true;
		signal.removeEventListener('abort', stop); child?.removeListener('message', onMessage); durable?.close();
	}
	const result = { protocol: 1, purpose: 'hosted-checkout-parent', failed,
		executionEvidence: injected ? 'injected-offline-runtime' : 'native-linux-parent',
		manifestDigest: digest(input.manifest), worker: receipt ?? null, exitCode, publicOutputBytes: outputBytes,
		processClosure: closure ?? null, parentObservedProtocolClosure: !failed && !!receipt?.apiDisposed && !!receipt?.browserContextClosed && !!receipt?.browserDisconnected && closure?.ownedGroupClosed === true,
		privateFinalRetentionStillRequired: true, signedWebhookCoverageLedgerReviewRequired: true, paymentAccepted: false, retryAllowed: false } as const;
	original(directory, 'parent-receipt.json', result);
	// Cleanup cancellation cannot discard failed-run evidence. Separate bounded
	// evidence-only transport; it performs no financial action or member replay.
	const finalRetention = await retainCheckoutParentFinal(input.manifest, expectedHead, options.root, options.key,
		(phase, bytes, retainedSignal) => options.draft.upload(phase, bytes, retainedSignal), AbortSignal.timeout(180000), runtime.now);
	return { ...result, privateFinalRetentionStillRequired: false as const, finalRetention };
}
