/** Explicit one-shot private retention of ORIGINAL parent files. No provider,
 * browser, authentication, payment, environment loading or automatic recovery.
 * This records evidence only; failed transfer never permits purchase replay. */
import { createHash } from 'node:crypto';
import { constants, openSync, readFileSync, writeFileSync, closeSync, fsyncSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { assetName, digest, limits, validateManifest, type Manifest } from './hosted-checkout-policy.ts';
import { seal, unseal, privateFile, type PrivateFile } from './hosted-community-bundle.ts';
import type { RetainedCheckoutAsset } from './hosted-checkout-github.ts';
const fail = (): never => { throw new Error('Private Checkout final retention failed; originals retained; no automatic retry.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function contained(path: string) {
	for (let cursor = path;; cursor = dirname(cursor)) {
		guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
		if (dirname(cursor) === cursor) break;
	}
}
function read(path: string, maximum = 1024 * 1024) {
	contained(path); const stat = lstatSync(path);
	guard(stat.isFile() && stat.nlink === 1 && stat.size <= maximum);
	if (process.platform === 'linux') guard((stat.mode & 0o077) === 0);
	const fd = openSync(path, constants.O_RDONLY | (process.platform === 'linux' ? constants.O_NOFOLLOW : 0));
	try { const bytes = readFileSync(fd); guard(bytes.length === stat.size); return bytes; } finally { closeSync(fd); }
}
function original(directory: string, name: string, bytes: Buffer, maximum = 1024 * 1024) {
	guard(bytes.length <= maximum);
	contained(directory); const fd = openSync(join(directory, name), 'wx', 0o600);
	try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
	if (process.platform === 'linux') { const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
	const after = read(join(directory, name), maximum); try { guard(after.equals(bytes)); } finally { after.fill(0); }
}
function snapshot(directory: string, manifest: Manifest): PrivateFile[] {
	const files: PrivateFile[] = [], durable = `checkout-${manifest.operationId}-${manifest.job.id}-${manifest.job.nonce}`;
	const rootNames = new Set(['parent-lease.json','member-message.json','member-receipt.json','parent-receipt.json']);
	const ownNames = new Set(['final-upload.intent.json', assetName(manifest, 'final'), 'final-upload.result.json']);
	const durableNames = new Set(['lease.json','submit-upload.intent.json','submit-upload.result.json','proof-request.original.json',
		'proof-request-upload.intent.json','proof-request-upload.result.json', assetName(manifest, 'open-proof'), assetName(manifest, 'submit-proof'),
		assetName(manifest, 'submit-intent'), `${assetName(manifest, 'ack-intent')}.intent.json`, `${assetName(manifest, 'submit-intent')}.intent.json`]);
	let total = 0;
	const add = (relative: string) => {
		const bytes = read(join(directory, relative));
		try { total += bytes.length; guard(total <= 4 * 1024 * 1024); files.push(privateFile(relative.replaceAll('\\','/'), bytes)); } finally { bytes.fill(0); }
	};
	contained(directory);
	for (const name of readdirSync(directory).sort()) {
		if (ownNames.has(name)) continue;
		if (name === durable) {
			const path = join(directory, name); contained(path); guard(lstatSync(path).isDirectory());
			for (const nested of readdirSync(path).sort()) { guard(durableNames.has(nested)); add(join(name, nested)); }
		} else { guard(rootNames.has(name)); add(name); }
	}
	guard(files.some(file => file.name === 'parent-lease.json') && files.some(file => file.name === 'parent-receipt.json'));
	return files;
}
function sameFiles(before: PrivateFile[], after: PrivateFile[]) {
	guard(before.length === after.length && before.every((file, index) => file.name === after[index]?.name && file.digest === after[index]?.digest));
}

/** After bounded parent cleanup (which may remain unconfirmed), preserve its
 * original manifest at admission time instead of freshening financial proofs.
 * Retaining failure evidence never claims that surviving resources closed. */
export async function retainCheckoutParentFinal(rawManifest: unknown, head: string, root: string, key: Buffer,
	upload: (phase: 'final', bytes: Buffer, signal: AbortSignal) => Promise<RetainedCheckoutAsset>,
	signal: AbortSignal, now = Date.now) {
	let encrypted: Buffer | undefined, ownedKey: Buffer | undefined;
	try {
		const created = z.object({ createdAt: z.iso.datetime() }).parse(rawManifest).createdAt;
		const manifest = validateManifest(rawManifest, head, Date.parse(created));
		guard(Buffer.isBuffer(key) && key.length === 32 && Number.isFinite(now())); signal.throwIfAborted();
		ownedKey = Buffer.from(key);
		const directory = join(resolve(root), `checkout-parent-${manifest.operationId}-${manifest.job.id}-${manifest.job.nonce}`);
		const binding = digest(manifest), before = snapshot(directory, manifest);
		const lease = before.find(file => file.name === 'parent-lease.json')!;
		const leaseValue = JSON.parse(Buffer.from(lease.bytes, 'base64').toString('utf8'));
		guard(leaseValue.manifestDigest === binding && leaseValue.expectedHead === head && leaseValue.retryAllowed === false && leaseValue.paymentAccepted === false);
		const parent = before.find(file => file.name === 'parent-receipt.json')!;
		const parentValue = JSON.parse(Buffer.from(parent.bytes, 'base64').toString('utf8'));
		guard(parentValue.purpose === 'hosted-checkout-parent' && parentValue.manifestDigest === binding && parentValue.paymentAccepted === false && parentValue.retryAllowed === false);
		// Exclusive persistent permission before encryption/transport; never rewrite it.
		const intent = Buffer.from(JSON.stringify({ protocol: 1, manifestDigest: binding, phase: 'final', maximumUploads: 1,
			originalFilesDigest: digest(before.map(({name,digest}) => ({name,digest}))), retryAllowed: false, paymentAccepted: false }));
		try { original(directory, 'final-upload.intent.json', intent); } finally { intent.fill(0); }
		encrypted = seal({ protocol: 1, kind: 'original-checkout-parent-final', manifest, manifestDigest: binding, files: before,
			paymentAccepted: false, retryAllowed: false }, ownedKey);
		guard(encrypted.length > 36 && encrypted.length <= limits.checkpointBytes);
		const decoded = unseal(encrypted, ownedKey) as { files: PrivateFile[]; manifestDigest: string };
		guard(decoded.manifestDigest === binding); sameFiles(before, decoded.files);
		original(directory, assetName(manifest, 'final'), encrypted, limits.checkpointBytes);
		sameFiles(before, snapshot(directory, manifest)); signal.throwIfAborted();
		const ciphertextDigest = hash(encrypted), retained = await upload('final', encrypted, signal);
		// Keep transport metadata bounded and reject unreviewed extra fields before
		// any private result is persisted or returned to the caller.
		const receiptKeys = ['phase','assetId','name','size','ciphertextDigest','releaseId','jobId','jobNonce','headSha','operationId',
			'anonymousDraft404','anonymousAsset404','observedAt','exactRetainedAssetVerified','readbackVerified','retryAllowed','paymentAccepted'];
		guard(retained && typeof retained === 'object' && Object.keys(retained).length === receiptKeys.length &&
			Object.keys(retained).every(field => receiptKeys.includes(field)));
		signal.throwIfAborted(); guard(hash(encrypted) === ciphertextDigest);
		sameFiles(before, snapshot(directory, manifest));
		const onDisk = read(join(directory, assetName(manifest, 'final')), limits.checkpointBytes);
		try { guard(onDisk.equals(encrypted)); } finally { onDisk.fill(0); }
		guard(retained.phase === 'final' && retained.name === assetName(manifest, 'final') && retained.ciphertextDigest === ciphertextDigest && retained.size === encrypted.length &&
			retained.releaseId === manifest.releaseId && retained.jobId === manifest.job.id && retained.jobNonce === manifest.job.nonce && retained.headSha === head &&
			retained.operationId === manifest.operationId && Number.isSafeInteger(retained.assetId) && retained.assetId > 0 && retained.anonymousDraft404 === true && retained.anonymousAsset404 === true &&
			retained.exactRetainedAssetVerified === true && retained.readbackVerified === true && retained.retryAllowed === false && retained.paymentAccepted === false &&
			Number.isFinite(Date.parse(retained.observedAt)) && now() - Date.parse(retained.observedAt) >= -5000 && now() - Date.parse(retained.observedAt) <= 30000);
		const result = Buffer.from(JSON.stringify(retained)); try { original(directory, 'final-upload.result.json', result); } finally { result.fill(0); }
		return retained;
	} catch { return fail(); } finally { encrypted?.fill(0); ownedKey?.fill(0); }
}
