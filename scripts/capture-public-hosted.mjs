/** Explicit trusted main-only capture. No credentials, login or mutations. */
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	approvedCaptureKey,
	sealPublicCapture,
	captureImagePath,
} from './public-capture-envelope.mjs';
export async function captureEncryptedPublicWalkthrough() {
	assert.equal(process.env['GITHUB_REPOSITORY'], 'irackson/givetogive');
	assert.equal(process.env['GITHUB_REF'], 'refs/heads/main');
	assert.equal(process.env['GITHUB_EVENT_NAME'], 'workflow_dispatch');
	assert.equal(process.env['GITHUB_ACTOR'], 'irackson');
	assert.equal(process.env['GITHUB_RUN_ATTEMPT'], '1');
	assert.equal(
		process.env['CAPTURE_EXPECTED_SHA'],
		process.env['GITHUB_SHA'],
	);
	assert.match(process.env['GITHUB_SHA'] ?? '', /^[a-f0-9]{40}$/);
	const publicKey = process.env['CAPTURE_PUBLIC_KEY'];
	approvedCaptureKey(publicKey);
	const { capturePublicWalkthrough } =
		await import('./capture-public-walkthrough.mjs');
	const result = await capturePublicWalkthrough();
	assert.equal(result.status, 'complete');
	const root = fileURLToPath(new URL('../', import.meta.url));
	const manifest = JSON.parse(
		await readFile(path.join(root, result.manifest), 'utf8'),
	);
	const images = [];
	for (const view of manifest.views) {
		assert.ok(captureImagePath(view.image));
		const full = path.join(root, view.image);
		assert.ok(
			(await lstat(full)).isFile() &&
				!(await lstat(full)).isSymbolicLink(),
		);
		assert.equal(await realpath(full), path.resolve(full));
		images.push({
			path: view.image,
			base64: (await readFile(full)).toString('base64'),
		});
	}
	const envelope = sealPublicCapture(
		{ version: 1, manifest, images },
		publicKey,
	);
	await writeFile(
		path.join(root, 'tmp', 'public-walkthrough.encrypted.json'),
		JSON.stringify(envelope),
		{ flag: 'wx' },
	);
	return {
		status: 'complete',
		views: result.views,
		encryptedArtifact: true,
		authenticatedAcceptance: false,
		paymentAcceptance: false,
		mutationRequests: result.mutationRequests,
	};
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		assert.deepEqual(process.argv.slice(2), [
			'--capture-encrypted-readonly',
		]);
		console.log(JSON.stringify(await captureEncryptedPublicWalkthrough()));
	} catch {
		console.error(
			'Encrypted public capture failed; private diagnostics withheld.',
		);
		process.exitCode = 1;
	}
}
