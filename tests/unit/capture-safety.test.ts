import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureSimulationRunId, captureStorageState, createCaptureDirectory, validateStagingStorageState } from '../e2e/capture-safety.ts';

async function withRepository(run: (repository: string) => Promise<void>) {
	const fixture = await mkdtemp(path.join(os.tmpdir(), 'givetogive-capture-safety-'));
	const repository = path.join(fixture, 'repo');
	await mkdir(repository);
	try { await run(repository); }
	finally {
		// Only this test's explicit, validated temporary fixture is removed.
		assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
		assert.ok(path.basename(fixture).startsWith('givetogive-capture-safety-'));
		await rm(fixture, { recursive: true });
	}
}

const freshRoot = () => `tmp/walkthrough-unit-${randomUUID()}`;
const bootstrap = () => ({ cookies: [{ name: '_vercel_jwt', value: 'dummy-test-cookie',
	domain: 'givetogive-staging.vercel.app', path: '/', expires: -1,
	httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] });

test('simulation capture requires an explicit valid UUID instead of selecting arbitrary historical runs', () => {
	assert.equal(captureSimulationRunId(undefined), undefined);
	const id = randomUUID();
	assert.equal(captureSimulationRunId(id.toUpperCase()), id);
	for (const value of ['', 'first', '100', '../run', `${id}?token=dummy`, `${id}\n`]) {
		assert.throws(() => captureSimulationRunId(value), /explicit UUID/);
	}
});

test('capture sections share a fresh UUID namespace without overwriting any existing section', async () => {
	await withRepository(async (repository) => {
		const root = freshRoot();
		const community = await createCaptureDirectory(repository, root, 'community-staging');
		await writeFile(path.join(community, 'manifest.json'), 'retained historical evidence');
		const payments = await createCaptureDirectory(repository, root, 'payments-staging');
		assert.equal(path.dirname(community), path.dirname(payments));
		await assert.rejects(createCaptureDirectory(repository, root, 'community-staging'), { code: 'EEXIST' });
		assert.equal(await readFile(path.join(community, 'manifest.json'), 'utf8'), 'retained historical evidence');
	});
});

test('capture roots reject missing, historical, traversal, nested and non-UUID paths', async () => {
	await withRepository(async (repository) => {
		for (const root of [undefined, '', 'tmp/walkthrough', 'tmp/payments-walkthrough', 'tmp',
			'../walkthrough', `tmp/nested/walkthrough-unit-${randomUUID()}`, 'tmp/walkthrough-not-unique',
			path.join(path.dirname(repository), `walkthrough-unit-${randomUUID()}`)]) {
			await assert.rejects(createCaptureDirectory(repository, root, 'production'));
		}
	});
});

test('a redirected tmp or capture root cannot write outside the repository', async () => {
	await withRepository(async (repository) => {
		const outside = path.join(path.dirname(repository), 'outside');
		await mkdir(outside);
		await symlink(outside, path.join(repository, 'tmp'), process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(createCaptureDirectory(repository, freshRoot(), 'production'), /must not redirect/);
	});
	await withRepository(async (repository) => {
		await mkdir(path.join(repository, 'tmp'));
		const outside = path.join(path.dirname(repository), 'outside');
		await mkdir(outside);
		const root = freshRoot();
		await symlink(outside, path.join(repository, root), process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(createCaptureDirectory(repository, root, 'production'), /must not redirect/);
	});
});

test('production and loopback capture state is explicitly empty without reading staging secrets', async () => {
	for (const origin of ['https://givetogive.vercel.app', 'http://127.0.0.1:3100', 'http://localhost:3100']) {
		assert.deepEqual(await captureStorageState(origin, 'nonexistent-repository', 'staging'), { cookies: [], origins: [] });
	}
	for (const origin of ['https://other.vercel.app', 'https://givetogive-staging.vercel.app.evil.example',
		'http://givetogive-staging.vercel.app', 'https://localhost:3100']) {
		await assert.rejects(captureStorageState(origin, 'nonexistent-repository', 'staging'), /not allowlisted/);
	}
	await assert.rejects(captureStorageState('https://givetogive-staging.vercel.app', 'nonexistent-repository', 'production'), /not allowlisted/);
	await assert.rejects(captureStorageState('https://dummy:dummy@givetogive.vercel.app', 'nonexistent-repository', 'production'), /must not contain credentials/);
	await assert.rejects(captureStorageState('https://givetogive.vercel.app/?token=dummy', 'nonexistent-repository', 'production'), /only an origin/);
});

test('staging contexts receive an explicitly validated independent bootstrap state', async () => {
	await withRepository(async (repository) => {
		await mkdir(path.join(repository, 'tmp/e2e'), { recursive: true });
		await writeFile(path.join(repository, 'tmp/e2e/staging-bypass.json'), JSON.stringify(bootstrap()));
		const state = await captureStorageState('https://givetogive-staging.vercel.app', repository, 'staging');
		assert.deepEqual(state, bootstrap());
		const original = bootstrap();
		const validated = validateStagingStorageState(original);
		assert.notEqual(validated.cookies, original.cookies);
		assert.notEqual(validated.cookies[0], original.cookies[0]);
		await writeFile(path.join(repository, 'tmp/e2e/staging-bypass.json'), 'dummy-private-invalid-json');
		await assert.rejects(captureStorageState('https://givetogive-staging.vercel.app', repository, 'staging'), (error) =>
			error instanceof Error && /missing or malformed/.test(error.message) && !error.message.includes('dummy-private'));
	});
});

test('staging state rejects sibling/subdomain cookies, local storage and malformed state without exposing values', () => {
	const original = bootstrap();
	for (const domain of ['givetogive.vercel.app', '.givetogive-staging.vercel.app', '.vercel.app', 'checkout.stripe.com']) {
		assert.throws(() => validateStagingStorageState({ ...original, cookies: [{ ...original.cookies[0], domain }] }), /host-only/);
	}
	for (const state of [null, {}, { cookies: [], origins: [] },
		{ ...original, origins: [{ origin: 'https://givetogive-staging.vercel.app', localStorage: [] }] },
		{ ...original, cookies: [{ ...original.cookies[0], secure: false }] },
		{ ...original, cookies: [{ ...original.cookies[0], path: '/other' }] },
		{ ...original, cookies: [{ ...original.cookies[0], name: 'authjs.session-token' }] },
		{ ...original, cookies: [{ ...original.cookies[0], httpOnly: false }] },
		{ ...original, cookies: [...original.cookies, ...original.cookies] },
		{ ...original, cookies: [{ ...original.cookies[0], expires: null }] },
		{ ...original, cookies: [{ ...original.cookies[0], sameSite: 'invalid' }] }]) {
		assert.throws(() => validateStagingStorageState(state), (error) =>
			error instanceof Error && /host-only/.test(error.message) && !error.message.includes('dummy-test-cookie'));
	}
});

test('staging bootstrap cookies must be session cookies or strictly unexpired', (context) => {
	context.mock.method(Date, 'now', () => 1_000_000);
	const original = bootstrap();
	const withExpiry = (expires: number) => ({ ...original, cookies: [{ ...original.cookies[0], expires }] });
	assert.equal(validateStagingStorageState(withExpiry(-1)).cookies[0]?.expires, -1);
	const future = Date.now() / 1000 + 0.001;
	assert.equal(validateStagingStorageState(withExpiry(future)).cookies[0]?.expires, future);
	for (const expires of [0, -2, Date.now() / 1000, Date.now() / 1000 - 1, NaN, Infinity, -Infinity]) {
		assert.throws(() => validateStagingStorageState(withExpiry(expires)), /host-only/);
	}
});
