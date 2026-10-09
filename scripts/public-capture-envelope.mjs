/** Inert envelope primitives. Only encrypted bytes may leave the hosted runner. */
import assert from 'node:assert/strict';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createPublicKey,
	publicEncrypt,
	privateDecrypt,
	randomBytes,
	constants,
} from 'node:crypto';
export const envelopeLimit = 128 * 1024 * 1024;
const aad = Buffer.from('givetogive-public-capture-v1');
/** @typedef {{image:string,imageSha256:string,authenticatedViewCaptured:boolean}} CaptureView */
/** @typedef {{version:number,manifest:{kind:string,baseURL:string,environment:string,status:string,authenticated:boolean,readOnly:boolean,mutationRequests:number,errors:string[],views:CaptureView[],[key:string]:unknown},images:Array<{path:string,base64:string}>}} CaptureBundle */
/** @typedef {{version:number,algorithm:string,wrappedKey:string,iv:string,tag:string,ciphertext:string}} CaptureEnvelope */
/** @param {unknown} encoded */
export function approvedCaptureKey(encoded) {
	assert.ok(typeof encoded === 'string');
	assert.ok(
		encoded.length > 300 &&
			encoded.length < 2048 &&
			/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
	);
	const key = createPublicKey({
		key: Buffer.from(encoded, 'base64'),
		format: 'der',
		type: 'spki',
	});
	assert.equal(key.asymmetricKeyType, 'rsa');
	assert.ok((key.asymmetricKeyDetails?.modulusLength ?? 0) >= 3072);
	return key;
}
/** @param {unknown} value */
export function captureImagePath(value) {
	return (
		typeof value === 'string' &&
		/^tmp\/walkthrough-public-[a-f0-9-]{36}\/production\/images\/\d{3}\.png$/.test(
			value,
		)
	);
}
/** @param {CaptureBundle} bundle */
export function validatePublicCaptureBundle(bundle) {
	assert.ok(bundle && bundle.version === 1 && bundle.manifest);
	const m = bundle.manifest;
	assert.equal(m.kind, 'anonymous-public-walkthrough');
	assert.equal(m.baseURL, 'https://givetogive.vercel.app');
	assert.equal(m.environment, 'production');
	assert.equal(m.status, 'complete');
	assert.equal(m.authenticated, false);
	assert.equal(m.readOnly, true);
	assert.equal(m.mutationRequests, 0);
	assert.deepEqual(m.errors, []);
	assert.ok(
		Array.isArray(m.views) && m.views.length > 0 && m.views.length <= 40,
	);
	assert.ok(
		Array.isArray(bundle.images) && bundle.images.length === m.views.length,
	);
	const seen = new Set();
	let total = 0;
	for (let i = 0; i < m.views.length; i++) {
		const view = m.views[i],
			image = bundle.images[i];
		assert.ok(view && image);
		assert.ok(captureImagePath(view.image) && !seen.has(view.image));
		seen.add(view.image);
		assert.equal(view.authenticatedViewCaptured, false);
		assert.equal(image.path, view.image);
		assert.ok(
			typeof image.base64 === 'string' &&
				image.base64.length < 24 * 1024 * 1024,
		);
		const bytes = Buffer.from(image.base64, 'base64');
		total += bytes.length;
		assert.ok(total < 96 * 1024 * 1024);
		assert.ok(
			bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		);
		assert.equal(
			createHash('sha256').update(bytes).digest('hex'),
			view.imageSha256,
		);
	}
	return bundle;
}
/** @param {CaptureBundle} bundle @param {unknown} encodedKey */
export function sealPublicCapture(bundle, encodedKey) {
	validatePublicCaptureBundle(bundle);
	const key = randomBytes(32),
		iv = randomBytes(12);
	try {
		const cipher = createCipheriv('aes-256-gcm', key, iv);
		cipher.setAAD(aad);
		const encrypted = Buffer.concat([
			cipher.update(JSON.stringify(bundle)),
			cipher.final(),
		]);
		assert.ok(encrypted.length < envelopeLimit);
		return {
			version: 1,
			algorithm: 'RSA-OAEP-SHA256/AES-256-GCM',
			wrappedKey: publicEncrypt(
				{
					key: approvedCaptureKey(encodedKey),
					oaepHash: 'sha256',
					padding: constants.RSA_PKCS1_OAEP_PADDING,
				},
				key,
			).toString('base64'),
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			ciphertext: encrypted.toString('base64'),
		};
	} finally {
		key.fill(0);
	}
}
/** @param {CaptureEnvelope} envelope @param {import('node:crypto').KeyObject} privateKey */
export function openPublicCapture(envelope, privateKey) {
	assert.equal(envelope?.version, 1);
	assert.equal(envelope.algorithm, 'RSA-OAEP-SHA256/AES-256-GCM');
	assert.ok(
		typeof envelope.ciphertext === 'string' &&
			envelope.ciphertext.length < envelopeLimit * 1.4,
	);
	const key = privateDecrypt(
		{
			key: privateKey,
			oaepHash: 'sha256',
			padding: constants.RSA_PKCS1_OAEP_PADDING,
		},
		Buffer.from(envelope.wrappedKey, 'base64'),
	);
	try {
		assert.equal(key.length, 32);
		const iv = Buffer.from(envelope.iv, 'base64'),
			tag = Buffer.from(envelope.tag, 'base64');
		assert.equal(iv.length, 12);
		assert.equal(tag.length, 16);
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAAD(aad);
		decipher.setAuthTag(tag);
		const plain = Buffer.concat([
			decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
			decipher.final(),
		]);
		try {
			return validatePublicCaptureBundle(JSON.parse(plain.toString()));
		} finally {
			plain.fill(0);
		}
	} finally {
		key.fill(0);
	}
}
