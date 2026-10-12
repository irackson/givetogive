import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type {
	ClaimRequest,
	Outcome,
	ReceiptStore,
	Reservation,
} from './types.ts';

const intent = /^mail:[a-f0-9]{32}$/;
const claimPattern = /^mail:[a-f0-9]{32}\.[a-f0-9]{32}$/;
const requestSchema = z
	.object({
		key: z.string().regex(intent),
		binding: z.string().regex(/^[a-f0-9]{64}$/),
		app: z.literal('givetogive'),
		providerScope: z.literal('mailgun:us:ianrackson.com'),
		recipientBinding: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		templateVersion: z.string().min(1).max(80).optional(),
		messageExpiresAt: z
			.number()
			.int()
			.min(1)
			.max(99_999_999_999_999)
			.optional(),
	})
	.strict();
const outcomeSchema = z.discriminatedUnion('state', [
	z
		.object({
			state: z.literal('accepted'),
			providerMessageId: z.string().regex(/^[!-~]{1,512}$/),
		})
		.strict(),
	z
		.object({
			state: z.literal('unknown'),
			reason: z.enum([
				'deadline',
				'network_or_body',
				'unrecognized_response',
				'malformed_acceptance',
				'receipt_unavailable',
				'in_progress_or_uncertain',
				'provider_id_conflict',
				'intent_conflict',
			]),
		})
		.strict(),
	z
		.object({
			state: z.literal('rejected'),
			reason: z.enum([
				'provider_rejection',
				'intent_conflict',
				'invalid_message',
			]),
			httpStatus: z.number().int().min(400).max(599).optional(),
		})
		.strict(),
]);
function unavailable(): never {
	throw new Error('Give mail receipt admission unavailable.');
}
function plain(value: unknown) {
	if (
		!value ||
		typeof value !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		unavailable();
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			typeof key !== 'string' ||
			!descriptor ||
			!Object.hasOwn(descriptor, 'value') ||
			!descriptor.enumerable
		)
			unavailable();
	}
}
function request(value: unknown): ClaimRequest {
	plain(value);
	const parsed = requestSchema.safeParse(value);
	if (!parsed.success) unavailable();
	const v = parsed.data;
	return Object.freeze({
		key: v.key,
		binding: v.binding,
		app: v.app,
		providerScope: v.providerScope,
		...(v.recipientBinding === undefined ?
			{}
		:	{ recipientBinding: v.recipientBinding }),
		...(v.templateVersion === undefined ?
			{}
		:	{ templateVersion: v.templateVersion }),
		...(v.messageExpiresAt === undefined ?
			{}
		:	{ messageExpiresAt: v.messageExpiresAt }),
	});
}
function outcome(value: unknown): Outcome {
	plain(value);
	const parsed = outcomeSchema.safeParse(value);
	if (!parsed.success) unavailable();
	const v = parsed.data;
	return v.state === 'rejected' ?
			Object.freeze({
				state: v.state,
				reason: v.reason,
				...(v.httpStatus === undefined ?
					{}
				:	{ httpStatus: v.httpStatus }),
			})
		:	Object.freeze(v);
}
export type GiveReceiptExecutor = (
	operation: 'reserve' | 'complete',
	payload: Readonly<Record<string, unknown>>,
	capacity: number,
) => Promise<unknown>;

/** Uses the existing application pool, no new credential or persistent access.
 * One transaction; server statement/lock deadlines are installed before the
 * atomic function. No replay or bootstrap. Connection/commit uncertainty is held.
 */
export const executeNativeGiveReceipt: GiveReceiptExecutor = async (
	operation,
	payload,
	capacity,
) => {
	const [{ db }, { sql }] = await Promise.all([
		import('@/server/db'),
		import('drizzle-orm'),
	]);
	return db.transaction(async (transaction) => {
		await transaction.execute(sql`SET LOCAL statement_timeout = '2000'`);
		await transaction.execute(sql`SET LOCAL lock_timeout = '2000'`);
		const rows = await transaction.execute(
			sql`SELECT public.give_mail_receipt_command_v1(${operation}, ${JSON.stringify(payload)}::jsonb, ${capacity}) AS result`,
		);
		if (rows.length !== 1) unavailable();
		return rows[0]?.['result'];
	});
};

export class PostgresGiveMailReceiptStore implements ReceiptStore {
	readonly #execute: GiveReceiptExecutor;
	readonly #capacity: number;
	constructor(options: {
		maxRecords: number;
		execute?: GiveReceiptExecutor;
	}) {
		plain(options);
		if (!Object.hasOwn(options, 'maxRecords') || Reflect.ownKeys(options).some(key => key !== 'maxRecords' && key !== 'execute')) unavailable();
		const capacity = options.maxRecords;
		if (
			!Number.isSafeInteger(capacity) ||
			capacity < 1 ||
			capacity > 10000
		)
			unavailable();
		this.#capacity = capacity;
		const executor = Object.hasOwn(options, 'execute') ? options.execute : undefined;
		this.#execute = executor === undefined ? executeNativeGiveReceipt : executor;
		if (typeof this.#execute !== 'function') unavailable();
	}
	async reserve(input: ClaimRequest): Promise<Reservation> {
		const prepared = request(input),
			claim = prepared.key + '.' + randomBytes(16).toString('hex');
		const value = await this.#execute(
			'reserve',
			{ request: prepared, claim },
			this.#capacity,
		);
		plain(value);
		const result = z
			.object({
				state: z.enum(['new', 'existing', 'conflict']),
				claim: z.string().optional(),
				outcome: z.unknown().optional(),
			})
			.strict()
			.safeParse(value);
		if (!result.success) unavailable();
		if (
			result.data.state === 'new' &&
			result.data.claim === claim &&
			result.data.outcome === undefined
		)
			return { state: 'new', claim };
		if (
			result.data.state === 'conflict' &&
			result.data.claim === undefined &&
			result.data.outcome === undefined
		)
			return { state: 'conflict' };
		if (result.data.state !== 'existing' || result.data.claim !== undefined)
			unavailable();
		return result.data.outcome === undefined ?
				{ state: 'existing' }
			:	{ state: 'existing', outcome: outcome(result.data.outcome) };
	}
	async complete(
		claim: string,
		input: Outcome,
	): Promise<'saved' | 'provider_id_conflict' | 'stale'> {
		if (typeof claim !== 'string' || !claimPattern.test(claim))
			return 'stale';
		const prepared = outcome(input);
		const value = await this.#execute(
			'complete',
			{ claim, outcome: prepared },
			this.#capacity,
		);
		if (
			value !== 'saved' &&
			value !== 'provider_id_conflict' &&
			value !== 'stale'
		)
			unavailable();
		return value;
	}
}
