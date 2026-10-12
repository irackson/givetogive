import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture as apiFixture } from './give-mail-test-context.mjs';
import { SyntheticReceiptStore } from './mail-fixtures/synthetic-store.ts';
const { prepareGiveRuntime } = await import('../../src/server/mail/runtime-admission.ts');
const { getGiveToGiveMailRuntime } = await import('../../src/server/mail/runtime.ts');
const { authLinkBase } = await import('../../src/server/mail/auth-origin.ts');
const { PostgresGiveMailReceiptStore } = await import('../../src/server/mail/postgres-receipts.ts');
const fixture = {
	GIVE_MAIL_RUNTIME_ADMISSION: 'v1',
	GIVE_MAIL_STORAGE_ADMISSION: 'v1',
	APP_ENV: 'production',
	NODE_ENV: 'production',
	VERCEL_ENV: 'production',
	GIVE_AUTH_ORIGIN: 'https://givetogive.ianrackson.com',
	GIVE_MAIL_BINDING_KEY_B64: Buffer.alloc(32, 9).toString('base64'),
	GIVE_MAIL_RECEIPT_MAX_RECORDS: '1',
	EMAIL_PROVIDER: 'mailgun',
	MAILGUN_DOMAIN: 'ianrackson.com',
	MAILGUN_REGION: 'us',
	MAILGUN_API_KEY: 'PUBLIC-NOT-A-KEY',
	EMAIL_FROM: 'GiveToGive <noreply@ianrackson.com>',
	EMAIL_REPLY_TO: 'givetogive@ianrackson.com',
	EMAIL_CONTACT: 'givetogive@ianrackson.com',
};
const request = {
	key: 'mail:' + 'a'.repeat(32),
	binding: 'b'.repeat(64),
	app: 'givetogive' as const,
	providerScope: 'mailgun:us:ianrackson.com',
};
test('actual runtime getter requires current exact production admission and never bootstraps', () => {
	const previous = Object.fromEntries(
		Object.keys(fixture).map((key) => [key, process.env[key]]),
	);
	try {
		delete process.env['GIVE_MAIL_RUNTIME_ADMISSION'];
		assert.equal(getGiveToGiveMailRuntime(), undefined);
		Object.assign(process.env, fixture);
		assert.ok(getGiveToGiveMailRuntime());
		process.env['GIVE_MAIL_STORAGE_ADMISSION'] = '';
		assert.throws(() => getGiveToGiveMailRuntime());
		delete process.env['GIVE_MAIL_RUNTIME_ADMISSION'];
		assert.equal(getGiveToGiveMailRuntime(), undefined);
	} finally {
		for (const [key, value] of Object.entries(previous))
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
	}
});
test('real auth-email seam binds an already issued token hash and duplicate never sends twice', async () => {
	const { sendAuthEmail } = await import('../../src/server/auth/email.ts');
	const previous = process.env['EMAIL_PROVIDER'];
	const previousApp = process.env['APP_ENV'];
	process.env['EMAIL_PROVIDER'] = 'mailgun';
	process.env['APP_ENV'] = 'production';
	apiFixture.env['NODE_ENV'] = 'production';
	apiFixture.env['AUTH_EMAIL_STAGING_RECIPIENTS'] = '';
	let effects = 0;
	apiFixture.runtime = {
		...prepareGiveRuntime(fixture)!,
		store: new SyntheticReceiptStore(),
		fetch: async () => {
			effects++;
			return Response.json({ id: '<PUBLIC-FIXTURE>', message: 'Queued' });
		},
	};
	try {
		const input = {
			to: 'synthetic@example.invalid',
			url: 'https://givetogive.ianrackson.com/verify-email?token=PUBLIC-FIXTURE',
			purpose: 'email_verification' as const,
			tokenHash: 'f'.repeat(64),
		};
		assert.equal((await sendAuthEmail(input)).delivered, true);
		assert.equal((await sendAuthEmail(input)).delivered, true);
		assert.equal(effects, 1);
		await sendAuthEmail({
			to: input.to,
			url: input.url,
			purpose: input.purpose,
		});
		assert.equal(effects, 1);
		process.env['APP_ENV'] = 'staging';
		apiFixture.env['AUTH_EMAIL_STAGING_RECIPIENTS'] = input.to;
		assert.equal((await sendAuthEmail(input)).captured, true);
		assert.equal(effects, 1);
	} finally {
		apiFixture.runtime = undefined;
		if (previous === undefined) delete process.env['EMAIL_PROVIDER'];
		else process.env['EMAIL_PROVIDER'] = previous;
		if (previousApp === undefined) delete process.env['APP_ENV'];
		else process.env['APP_ENV'] = previousApp;
	}
});
test('runtime disabled by default; explicit admission constructs without native or provider effects', () => {
	assert.equal(prepareGiveRuntime({}), undefined);
	const runtime = prepareGiveRuntime(fixture);
	assert.ok(runtime);
	assert.ok(runtime.store instanceof PostgresGiveMailReceiptStore);
	const hash = 'c'.repeat(64);
	assert.equal(
		runtime.bindAuthIntent?.(hash, 'email_verification'),
		prepareGiveRuntime(fixture)?.bindAuthIntent?.(
			hash,
			'email_verification',
		),
	);
	assert.notEqual(
		runtime.bindAuthIntent?.(hash, 'email_verification'),
		runtime.bindAuthIntent?.(hash, 'password_reset'),
	);
	assert.notEqual(
		runtime.bindAuthIntent?.(hash, 'email_verification'),
		runtime.bindAuthIntent?.('d'.repeat(64), 'email_verification'),
	);
	assert.throws(() =>
		runtime.bindAuthIntent?.('raw-token', 'email_verification'),
	);
});
for (const patch of [
	{ VERCEL_ENV: 'preview' },
	{ APP_ENV: 'staging' },
	{ NODE_ENV: 'development' },
	{ GIVE_MAIL_STORAGE_ADMISSION: '' },
	{ GIVE_AUTH_ORIGIN: 'https://givetogive.vercel.app' },
	{ GIVE_MAIL_BINDING_KEY_B64: 'YQ==' },
	{ GIVE_MAIL_BINDING_KEY_B64: fixture.GIVE_MAIL_BINDING_KEY_B64 + '\n' },
	{ GIVE_MAIL_RECEIPT_MAX_RECORDS: '01' },
	{ GIVE_MAIL_RECEIPT_MAX_RECORDS: '10001' },
	{ EMAIL_PROVIDER: 'gmail' },
	{ MAILGUN_REGION: 'eu' },
])
	test(
		'invalid production/storage/key/capacity/provider configuration holds runtime ' +
			Object.keys(patch)[0] +
			':' +
			Object.values(patch)[0],
		() => {
			assert.throws(() => prepareGiveRuntime({ ...fixture, ...patch }));
		},
	);
test('mail-only canonical origin does not rewrite current staging/payment origin', () => {
	assert.equal(
		authLinkBase({ APP_URL: 'http://localhost:3000' }),
		'http://localhost:3000',
	);
	assert.equal(
		authLinkBase({ ...fixture, APP_URL: 'https://givetogive.vercel.app' }),
		'https://givetogive.ianrackson.com',
	);
	assert.equal(
		authLinkBase({
			...fixture,
			APP_ENV: 'staging',
			APP_URL: 'https://givetogive-staging.vercel.app',
		}),
		'https://givetogive-staging.vercel.app',
	);
	assert.throws(() =>
		authLinkBase({ ...fixture, GIVE_AUTH_ORIGIN: 'https://evil.example' }),
	);
});
test('actual adapter snapshots executor, binds fresh claim and never retries', async () => {
	let calls = 0;
	let captured: Readonly<Record<string, unknown>> | undefined;
	const options = {
		maxRecords: 1,
		execute: async (
			__op: string,
			payload: Readonly<Record<string, unknown>>,
			capacity: number,
		) => {
			calls++;
			captured = payload;
			assert.equal(capacity, 1);
			return { state: 'new', claim: payload['claim'] };
		},
	};
	const store = new PostgresGiveMailReceiptStore(options);
	options.execute = async () => {
		throw Error('replaced');
	};
	const result = await store.reserve(request);
	assert.equal(result.state, 'new');
	assert.equal(calls, 1);
	assert.match(
		String(captured?.['claim']),
		/^mail:[a-f0-9]{32}\.[a-f0-9]{32}$/,
	);
});
test('constructor rejects stateful accessors before reading admitted capacity', () => {
	let reads = 0;
	const options = { maxRecords: 1 };
	Object.defineProperty(options, 'maxRecords', { enumerable: true, get() { reads++; return reads < 4 ? 1 : 0; } });
	assert.throws(() => new PostgresGiveMailReceiptStore(options));
	assert.equal(reads, 0);
	const extra = { maxRecords: 1, foreign: true };
	assert.throws(() => new PostgresGiveMailReceiptStore(extra));
});
test('storage errors/forged new claims and malformed retained outcomes are held', async () => {
	for (const answer of [
		{ state: 'new', claim: 'foreign' },
		{
			state: 'existing',
			outcome: { state: 'accepted', providerMessageId: 'bad\nID' },
		},
		{ state: 'conflict', claim: 'unexpected' },
	]) {
		let calls = 0;
		const store = new PostgresGiveMailReceiptStore({
			maxRecords: 1,
			execute: async () => {
				calls++;
				return answer;
			},
		});
		await assert.rejects(store.reserve(request));
		assert.equal(calls, 1);
	}
	let calls = 0;
	const store = new PostgresGiveMailReceiptStore({
		maxRecords: 1,
		execute: async () => {
			calls++;
			throw Error('synthetic uncertain commit');
		},
	});
	await assert.rejects(store.reserve(request));
	assert.equal(calls, 1);
});
test('invalid accessors/extra fields cannot reach SQL; old claims cannot complete', async () => {
	let calls = 0;
	const store = new PostgresGiveMailReceiptStore({
		maxRecords: 1,
		execute: async () => {
			calls++;
			return 'saved';
		},
	});
	const extra = { ...request, extra: 'foreign' };
	await assert.rejects(store.reserve(extra));
	const accessor = { ...request };
	Object.defineProperty(accessor, 'binding', {
		get() {
			throw Error('getter read');
		},
		enumerable: true,
	});
	await assert.rejects(store.reserve(accessor));
	assert.equal(calls, 0);
	assert.equal(
		await store.complete('foreign', {
			state: 'unknown',
			reason: 'deadline',
		}),
		'stale',
	);
	assert.equal(calls, 0);
	assert.equal(
		await store.complete(request.key + '.' + 'd'.repeat(32), {
			state: 'unknown',
			reason: 'deadline',
		}),
		'saved',
	);
	assert.equal(calls, 1);
});
