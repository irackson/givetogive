import { jsonlStreamConsumer } from '@trpc/server/unstable-core-do-not-import';
import superjson from 'superjson';
import { z } from 'zod';
import { ApiRejection } from './ui-session.ts';

const record = z.record(z.string(), z.unknown());
export class BrowserMutationUnresolved extends Error {
	constructor(phase: string) {
		super(
			`Browser mutation response is unresolved (${phase}); private diagnostics withheld.`,
		);
	}
}
function rejection(value: unknown, fallbackStatus?: number) {
	const shape = record.parse(value);
	const data = record.parse(shape['data']);
	const status = data['httpStatus'] ?? fallbackStatus;
	if (
		typeof status !== 'number' ||
		!Number.isInteger(status) ||
		status < 400 ||
		status > 599
	)
		throw new Error('Unresolved mutation error envelope.');
	return new ApiRejection(
		status,
		typeof data['code'] === 'string' ? data['code'] : 'UNKNOWN',
	);
}

/** Read the same tRPC stream as the UI; never persist raw bodies or error messages. */
export async function verifyBrowserMutationResponse(
	status: number,
	requestAccept: string,
	body: Uint8Array,
) {
	let phase = 'body-size';
	try {
		if (body.byteLength > 1_048_576)
			throw new Error('Oversized mutation envelope.');
		let envelope: Record<string, unknown>;
		// tRPC negotiates streaming with the request's trpc-accept header, but
		// serves the stream as application/json. Response content-type alone
		// cannot distinguish its JSONL transport from an ordinary JSON envelope.
		if (
			requestAccept === 'application/jsonl' &&
			status >= 200 &&
			status < 300
		) {
			phase = 'stream-head';
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(body);
					controller.close();
				},
			});
			const [head] = await jsonlStreamConsumer<
				Record<string, Promise<unknown>>
			>({
				from: stream,
				deserialize: (value) =>
					superjson.deserialize(
						value as ReturnType<typeof superjson.serialize>,
					),
				formatError: ({ error }) => rejection(error),
				abortController: new AbortController(),
			});
			phase = 'stream-batch';
			if (Object.keys(head).length !== 1 || !Object.hasOwn(head, '0'))
				throw new Error('Unexpected mutation batch.');
			phase = 'stream-envelope';
			envelope = record.parse(await head['0']);
		} else {
			phase = 'plain-envelope';
			const plain: unknown = JSON.parse(new TextDecoder().decode(body));
			envelope = record.parse(
				Array.isArray(plain) && plain.length === 1 ? plain[0] : plain,
			);
		}
		if (envelope['error']) {
			phase = 'application-error';
			const error = record.parse(envelope['error']);
			throw rejection(
				Object.hasOwn(error, 'json') ?
					superjson.deserialize(
						error as unknown as ReturnType<
							typeof superjson.serialize
						>,
					)
				:	error,
				status,
			);
		}
		if (status < 200 || status >= 300)
			throw new ApiRejection(status, 'HTTP_ERROR');
		phase = 'result-shape';
		const result = record.parse(await envelope['result']);
		if (!Object.hasOwn(result, 'data'))
			throw new Error('Missing mutation result.');
		// Resolve nested streamed data too; an HTTP 200 header is not proof that
		// the application completed. The caller still verifies the UI and record.
		phase = 'result-data';
		await result['data'];
	} catch (error) {
		if (error instanceof ApiRejection) throw error;
		throw new BrowserMutationUnresolved(phase);
	}
}
