import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
	approvedCaptureKey,
	captureImagePath,
	sealPublicCapture,
	openPublicCapture,
	validatePublicCaptureBundle,
	type CaptureBundle,
} from '../../scripts/public-capture-envelope.mjs';
import { captureEncryptedPublicWalkthrough } from '../../scripts/capture-public-hosted.mjs';
const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const publicKey = pair.publicKey
	.export({ format: 'der', type: 'spki' })
	.toString('base64');
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const imagePath =
	'tmp/walkthrough-public-11111111-1111-4111-8111-111111111111/production/images/001.png';
const bundle = (): CaptureBundle => ({
	version: 1,
	manifest: {
		kind: 'anonymous-public-walkthrough',
		baseURL: 'https://givetogive.vercel.app',
		environment: 'production',
		status: 'complete',
		authenticated: false,
		readOnly: true,
		mutationRequests: 0,
		errors: [],
		views: [
			{
				image: imagePath,
				imageSha256: createHash('sha256').update(image).digest('hex'),
				authenticatedViewCaptured: false,
			},
		],
	},
	images: [{ path: imagePath, base64: image.toString('base64') }],
});
test('envelope round-trips without publishing plaintext and rejects modified ciphertext', () => {
	const b = bundle(),
		sealed = sealPublicCapture(b, publicKey);
	assert.deepEqual(openPublicCapture(sealed, pair.privateKey), b);
	assert.ok(!JSON.stringify(sealed).includes('givetogive.vercel.app'));
	const bytes = Buffer.from(sealed.ciphertext, 'base64');
	bytes[0] = bytes[0]! ^ 1;
	assert.throws(() =>
		openPublicCapture(
			{ ...sealed, ciphertext: bytes.toString('base64') },
			pair.privateKey,
		),
	);
	assert.throws(() =>
		openPublicCapture(
			{ ...sealed, tag: Buffer.alloc(16).toString('base64') },
			pair.privateKey,
		),
	);
});
test('only a strong RSA public key is accepted', () => {
	assert.ok(approvedCaptureKey(publicKey));
	assert.throws(() => approvedCaptureKey('not-a-key'));
	const weak = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.publicKey.export({ format: 'der', type: 'spki' })
		.toString('base64');
	assert.throws(() => approvedCaptureKey(weak));
	assert.throws(() =>
		approvedCaptureKey(
			pair.privateKey
				.export({ format: 'der', type: 'pkcs8' })
				.toString('base64'),
		),
	);
});
test('capture packing refuses private, failed, mutated, mismatched or traversing material', () => {
	const mutations: Array<(b: ReturnType<typeof bundle>) => void> = [
		(b) => {
			b.manifest.authenticated = true;
		},
		(b) => {
			b.manifest.status = 'failed';
		},
		(b) => {
			b.manifest.mutationRequests = 1;
		},
		(b) => {
			b.manifest.errors = ['error'];
		},
		(b) => {
			b.images[0]!.path = '../secret';
		},
		(b) => {
			b.manifest.views[0]!.imageSha256 = '0'.repeat(64);
		},
	];
	for (const mutate of mutations) {
		const b = bundle();
		mutate(b);
		assert.throws(() => validatePublicCaptureBundle(b));
	}
	for (const value of [
		'.env.local',
		imagePath + '?token=x',
		'../' + imagePath,
		'tmp/private/images/001.png',
	])
		assert.equal(captureImagePath(value), false);
});
test('hosted capture rejects ordinary local invocation before browser launch or allocation', async () => {
	await assert.rejects(() => captureEncryptedPublicWalkthrough());
});
