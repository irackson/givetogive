import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonlStreamProducer } from '@trpc/server/unstable-core-do-not-import';
import superjson from 'superjson';
import { verifyBrowserMutationResponse } from '../src/browser-response.ts';
import { ApiRejection } from '../src/ui-session.ts';

const privateMarker = 'private-response-fixture-must-not-escape';
const shape = {
	message: privateMarker,
	code: -32600,
	data: { code: 'BAD_REQUEST', httpStatus: 400 },
};
async function streamBody(value: unknown) {
	const stream = jsonlStreamProducer({
		data: { 0: Promise.resolve(value) },
		serialize: superjson.serialize,
		formatError: () => shape,
	});
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
test('request-negotiated streaming decodes genuine tRPC JSONL success and an HTTP-200 application rejection', async () => {
	await verifyBrowserMutationResponse(
		200,
		'application/jsonl',
		await streamBody({
			result: Promise.resolve({ data: Promise.resolve({ id: 3 }) }),
		}),
	);
	await assert.rejects(
		verifyBrowserMutationResponse(
			200,
			'application/jsonl',
			await streamBody({ error: shape }),
		),
		(error) =>
			error instanceof ApiRejection &&
			error.status === 400 &&
			error.code === 'BAD_REQUEST' &&
			!error.message.includes(privateMarker),
	);
	await assert.rejects(
		verifyBrowserMutationResponse(
			200,
			'application/jsonl',
			await streamBody(Promise.reject(new Error(privateMarker))),
		),
		(error) =>
			error instanceof ApiRejection &&
			error.code === 'BAD_REQUEST' &&
			!error.message.includes(privateMarker),
	);
});
test('plain tRPC errors expose only whitelisted status/code; malformed or missing results stay ambiguous', async () => {
	await assert.rejects(
		verifyBrowserMutationResponse(
			400,
			'application/json',
			new TextEncoder().encode(
				JSON.stringify({ error: superjson.serialize(shape) }),
			),
		),
		ApiRejection,
	);
	for (const body of [
		privateMarker,
		'{}',
		JSON.stringify({
			error: { message: privateMarker, data: { code: privateMarker } },
		}),
	])
		await assert.rejects(
			verifyBrowserMutationResponse(
				200,
				'application/json',
				new TextEncoder().encode(body),
			),
			(error) =>
				error instanceof Error &&
				!(error instanceof ApiRejection) &&
				!error.message.includes(privateMarker),
		);
	await assert.rejects(
		verifyBrowserMutationResponse(
			200,
			'application/json',
			new Uint8Array(1_048_577),
		),
		/unresolved/,
	);
});
