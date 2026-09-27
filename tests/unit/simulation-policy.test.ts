import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bearerToken,
	boundedJson,
	hashSimulationToken,
	safeSimulationText,
	sanitizeSimulationData,
	stableInputHash,
} from '../../src/server/simulation/policy.ts';

test('scoped simulation tokens are hashed and bearer syntax is strict', () => {
	const token = 'ab'.repeat(32);
	assert.equal(
		bearerToken(new Headers({ authorization: `Bearer ${token}` })),
		token,
	);
	assert.equal(hashSimulationToken(token).length, 64);
	assert.notEqual(hashSimulationToken(token), token);
	for (const authorization of [
		'',
		'Basic abc',
		'Bearer short',
		`Bearer ${token} extra`,
	]) {
		assert.throws(() => bearerToken(new Headers({ authorization })));
	}
});

test('idempotency hashes canonicalize object order but not user input or array order', () => {
	assert.equal(
		stableInputHash({ saved: true, askId: 7, nested: { z: 1, a: 2 } }),
		stableInputHash({ nested: { a: 2, z: 1 }, askId: 7, saved: true }),
	);
	assert.notEqual(
		stableInputHash({ saved: true, askId: 7 }),
		stableInputHash({ saved: false, askId: 7 }),
	);
	assert.notEqual(stableInputHash([1, 2]), stableInputHash([2, 1]));
});

test('telemetry retains safe scalars only, excluding secrets and financial success claims', () => {
	const result = sanitizeSimulationData({
		tool: 'save_ask',
		cycles: 3,
		actions: 4,
		password: 'secret',
		token: 'secret',
		paymentSucceeded: true,
		hiddenReasoning: {},
		ramFreeGiB: Infinity,
		model: 'Bearer abcdefghijklmnop',
	});
	assert.deepEqual(result, {
		tool: 'save_ask',
		cycles: 3,
		actions: 4,
		model: 'Bearer [redacted]',
	});
	assert.equal(
		safeSimulationText(
			'Contact fake@example.test with sk_test_abcdefghijklmno',
		),
		'Contact [email redacted] with [redacted]',
	);
	assert.equal(safeSimulationText('x'.repeat(600)).length, 500);
	assert.equal(
		safeSimulationText('ab'.repeat(32)),
		'[credential hash redacted]',
	);
	assert.deepEqual(
		sanitizeSimulationData({ cycles: -2, actions: 1e300 }),
		{},
	);
});

test('JSON ingestion enforces streamed size even without content length', async () => {
	const request = (body: string, headers: Record<string, string> = {}) =>
		new Request(
			'https://givetogive-staging.example/api/simulation/events',
			{
				method: 'POST',
				body,
				headers: { 'content-type': 'application/json', ...headers },
			},
		);
	assert.deepEqual(await boundedJson(request('{"ok":true}'), 32), {
		ok: true,
	});
	await assert.rejects(
		boundedJson(request('"' + 'a'.repeat(40) + '"'), 32),
		/BODY_TOO_LARGE/,
	);
	await assert.rejects(
		boundedJson(request('{}', { 'content-length': '100' }), 32),
		/BODY_TOO_LARGE/,
	);
	await assert.rejects(
		boundedJson(request('{}', { 'content-type': 'text/plain' })),
		/JSON_REQUIRED/,
	);
	await assert.rejects(
		boundedJson(request('{}', { 'content-type': 'application/jsonp' })),
		/JSON_REQUIRED/,
	);
	await assert.rejects(boundedJson(request('{broken}')), SyntaxError);
});
