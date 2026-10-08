import { z } from 'zod';
import type { UiApi } from './ui-session.ts';

const alias = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const type = z.enum(['time', 'task', 'item', 'resource']);
const match = z
	.object({
		type: type.optional(),
		query: z.string().max(100).optional(),
		maxDifficulty: z.number().int().min(1).max(5).optional(),
		maxMinutes: z.number().int().min(1).max(10000).optional(),
	})
	.strict();
const target = z.union([
	z.object({ id: z.number().int().positive() }).strict(),
	z.object({ ref: alias }).strict(),
	z.object({ match }).strict(),
]);
const contributionTarget = z.union([
	z.object({ ref: alias }).strict(),
	z
		.object({
			match: z
				.object({
					ask: target,
					as: z.enum(['owner', 'contributor']),
				})
				.strict(),
		})
		.strict(),
]);
const common = {
	id: alias,
	user: alias,
	everySeconds: z.number().int().min(10).max(3600).optional(),
	ref: alias.optional(),
};
export const activitySchema = z
	.discriminatedUnion('action', [
		// Both drivers perform this exact read. Other views get explicit actions later.
		z
			.object({
				...common,
				action: z.literal('browse'),
				path: z.literal('/asks').default('/asks'),
			})
			.strict(),
		z
			.object({
				...common,
				action: z.literal('create_ask'),
				input: z
					.object({
						title: z.string().min(3).max(256),
						description: z.string().min(10).max(20000),
						type,
						goalAmount: z.number().int().positive().max(1000000),
						difficulty: z.number().int().min(1).max(5).default(2),
						estimatedMinutesToComplete: z
							.number()
							.int()
							.positive()
							.max(1000000)
							.default(30),
					})
					.strict(),
			})
			.strict(),
		z
			.object({
				...common,
				action: z.literal('save_ask'),
				ask: target,
				saved: z.boolean().default(true),
			})
			.strict(),
		z
			.object({
				...common,
				action: z.literal('contribute'),
				ask: target,
				amount: z.number().int().positive().max(1000000),
				note: z.string().max(500).optional(),
			})
			.strict(),
		z
			.object({
				...common,
				action: z.literal('set_contribution_status'),
				contribution: contributionTarget,
				status: z.enum(['completed', 'cancelled']),
			})
			.strict(),
	])
	.superRefine((line, ctx) => {
		if (
			line.action === 'set_contribution_status' &&
			line.status === 'cancelled' &&
			'match' in line.contribution &&
			line.contribution.match.as === 'owner'
		)
			ctx.addIssue({
				code: 'custom',
				message:
					'Only the contributor can select their pledge for cancellation.',
			});
		if (line.everySeconds && line.ref)
			ctx.addIssue({
				code: 'custom',
				message:
					'A recurring line cannot overwrite an exact result reference.',
			});
	});
export type Activity = z.infer<typeof activitySchema>;
export type EntityRef = {
	kind: 'ask' | 'contribution';
	id: number;
	askId?: number;
};
export type ActivityResult = {
	outcome: 'success' | 'waiting';
	entity?: EntityRef;
	procedure?: string;
};
export interface ActivityHooks {
	beforeMutation(procedure: string): void;
	browserAction?(
		line: Activity,
		ask?: Ask,
		beforeMutation?: (procedure: string) => void,
		entity?: EntityRef,
	): Promise<EntityRef | undefined>;
}
const askSchema = z.object({
	id: z.number().int().positive(),
	type: z.enum(['time', 'task', 'item', 'resource', 'money']),
	createdById: z.string(),
	status: z.string(),
	goalAmount: z.number(),
	contributedAmount: z.number(),
	paymentEnabled: z.boolean().optional(),
});
export type Ask = z.infer<typeof askSchema>;
/** A fresh authoritative read invalidated a selection before any mutation. */
export class ActivitySelectionChanged extends Error {
	constructor() {
		super(
			'The selected record changed before a member mutation was admitted.',
		);
	}
}
export function canContribute(ask: Ask, userId: string, amount: number) {
	return (
		ask.createdById !== userId &&
		ask.type !== 'money' &&
		!ask.paymentEnabled &&
		ask.status !== 'complete' &&
		ask.goalAmount - ask.contributedAmount >= amount
	);
}
export async function freshContributionTarget(
	api: UiApi,
	id: number,
	amount: number,
) {
	const ask = askSchema.parse(await api.query('ask.getAsk', { id }));
	if (!canContribute(ask, api.userId, amount))
		throw new ActivitySelectionChanged();
	return ask;
}
/** Exact lifecycle target recheck; never substitutes a different pledge or writes. */
export async function freshContributionStatusTarget(
	api: UiApi,
	entity: EntityRef,
	status: 'completed' | 'cancelled',
) {
	if (entity.kind !== 'contribution' || !entity.askId)
		throw new Error('An exact contribution and parent Ask are required.');
	const detail = askSchema.extend({
		contributions: z.array(z.object({
			id: z.number().int().positive(),
			contributorId: z.string(),
			status: z.enum(['pledged', 'completed', 'cancelled']),
		})),
	}).parse(await api.query('ask.getAsk', { id: entity.askId }));
	if (detail.id !== entity.askId)
		throw new Error('Contribution parent identity mismatch.');
	const pledge = detail.contributions.find(row => row.id === entity.id);
	if (detail.type === 'money' || detail.paymentEnabled || !pledge ||
		pledge.status !== 'pledged' ||
		(pledge.contributorId !== api.userId &&
			(status === 'cancelled' || detail.createdById !== api.userId)))
		throw new ActivitySelectionChanged();
	return pledge;
}
export function parseActivity(source: string) {
	const rows = source
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line, index) => {
			try {
				return activitySchema.parse(JSON.parse(line));
			} catch {
				throw new Error(
					`Invalid activity line ${index + 1}; use the documented action schema.`,
				);
			}
		});
	if (
		!rows.length ||
		rows.length > 10000 ||
		new Set(rows.map((row) => row.id)).size !== rows.length
	)
		throw new Error('Activity IDs must be unique; supply 1–10000 lines.');
	const references = rows.flatMap((row) => (row.ref ? [row.ref] : []));
	if (new Set(references).size !== references.length)
		throw new Error('Result references must be unique.');
	return rows;
}

/** Fresh selection includes records created by browsers or any other member. */
export async function selectAsk(
	api: UiApi,
	value: z.infer<typeof target>,
	refs: ReadonlyMap<string, EntityRef>,
	contributing = false,
	amount = 0,
): Promise<Ask | undefined> {
	let candidates: Ask[];
	if ('match' in value)
		candidates = z
			.array(askSchema)
			.parse(await api.query('ask.getAsks', value.match));
	else {
		const id =
			'id' in value ? value.id
			: refs.get(value.ref)?.kind === 'ask' ? refs.get(value.ref)!.id
			: undefined;
		if (!id) return undefined;
		candidates = [askSchema.parse(await api.query('ask.getAsk', { id }))];
	}
	return candidates.find(
		(ask) => !contributing || canContribute(ask, api.userId, amount),
	);
}

export async function executeActivity(
	api: UiApi,
	line: Activity,
	refs: ReadonlyMap<string, EntityRef>,
	hooks: ActivityHooks,
): Promise<ActivityResult> {
	let admitted = false;
	try {
		return await executeSelectedActivity(api, line, refs, {
			...hooks,
			beforeMutation(procedure) {
				hooks.beforeMutation(procedure);
				admitted = true;
			},
		});
	} catch (error) {
		// Only a proved pre-mutation selection change can wait safely. Once an
		// intent is admitted, an absent response remains unresolved, never replayed.
		if (error instanceof ActivitySelectionChanged && !admitted)
			return { outcome: 'waiting' };
		throw error;
	}
}
async function executeSelectedActivity(
	api: UiApi,
	line: Activity,
	refs: ReadonlyMap<string, EntityRef>,
	hooks: ActivityHooks,
): Promise<ActivityResult> {
	if (line.action === 'browse') {
		if (hooks.browserAction) await hooks.browserAction(line);
		else await api.query('ask.getAsks', {});
		return { outcome: 'success' };
	}
	if (line.action === 'create_ask') {
		if (!hooks.browserAction) hooks.beforeMutation('ask.createAsk');
		const entity =
			hooks.browserAction ?
				await hooks.browserAction(line, undefined, hooks.beforeMutation)
			:	{
					kind: 'ask' as const,
					id: z
						.object({
							newlyCreatedAskId: z.number().int().positive(),
						})
						.parse(await api.mutate('ask.createAsk', line.input))
						.newlyCreatedAskId,
				};
		if (!entity)
			throw new Error('Created Ask did not return an authoritative ID.');
		return { outcome: 'success', entity, procedure: 'ask.createAsk' };
	}
	if (line.action === 'set_contribution_status') {
		const entity =
			'ref' in line.contribution ?
				refs.get(line.contribution.ref)
			:	await selectContribution(api, line.contribution.match, refs);
		if (!entity || entity.kind !== 'contribution')
			return { outcome: 'waiting' };
		if (!hooks.browserAction)
			hooks.beforeMutation('ask.updateContributionStatus');
		if (hooks.browserAction)
			await hooks.browserAction(
				line,
				undefined,
				hooks.beforeMutation,
				entity,
			);
		else
			await api.mutate('ask.updateContributionStatus', {
				contributionId: entity.id,
				status: line.status,
			});
		return {
			outcome: 'success',
			entity,
			procedure: 'ask.updateContributionStatus',
		};
	}
	const ask = await selectAsk(
		api,
		line.ask,
		refs,
		line.action === 'contribute',
		line.action === 'contribute' ? line.amount : 0,
	);
	if (!ask) return { outcome: 'waiting' };
	const procedure =
		line.action === 'save_ask' ? 'ask.setSaved' : 'ask.createContribution';
	if (!hooks.browserAction) hooks.beforeMutation(procedure);
	const entity =
		hooks.browserAction ?
			await hooks.browserAction(line, ask, hooks.beforeMutation)
		: line.action === 'save_ask' ?
			(await api.mutate(procedure, { askId: ask.id, saved: line.saved }),
			{ kind: 'ask' as const, id: ask.id })
		:	{
				kind: 'contribution' as const,
				id: z
					.object({ contributionId: z.number().int().positive() })
					.parse(
						await api.mutate(procedure, {
							askId: ask.id,
							amount: line.amount,
							note: line.note,
						}),
					).contributionId,
				askId: ask.id,
			};
	if (!entity)
		throw new Error(
			'Member mutation did not yield its verified entity reference.',
		);
	return { outcome: 'success', entity, procedure };
}

/** Recurring lifecycle rules select a current pledge; they never overwrite refs. */
async function selectContribution(
	api: UiApi,
	selection: { ask: z.infer<typeof target>; as: 'owner' | 'contributor' },
	refs: ReadonlyMap<string, EntityRef>,
): Promise<EntityRef | undefined> {
	const { ask: value, as } = selection;
	let candidates: Ask[];
	if ('match' in value) {
		candidates = z.array(askSchema).parse(
			await api.query('ask.getAsks', {
				...value.match,
				...(as === 'owner' ?
					{ filter: { createdById: api.userId } }
				:	{}),
			}),
		);
	} else {
		const ask = await selectAsk(api, value, refs);
		candidates = ask ? [ask] : [];
	}
	// Bound observation cost. This is a fresh UI browse window, not a claim to
	// traverse all historical pledges. Owner filtering happens on the server.
	for (const candidate of candidates.slice(0, 20)) {
		if (
			candidate.type === 'money' ||
			candidate.paymentEnabled ||
			(as === 'owner' && candidate.createdById !== api.userId)
		)
			continue;
		const detail = askSchema
			.extend({
				contributions: z.array(
					z.object({
						id: z.number().int().positive(),
						contributorId: z.string(),
						status: z.enum(['pledged', 'completed', 'cancelled']),
					}),
				),
			})
			.parse(await api.query('ask.getAsk', { id: candidate.id }));
		if (
			detail.type === 'money' ||
			detail.paymentEnabled ||
			(as === 'owner' && detail.createdById !== api.userId)
		)
			continue;
		const pledge = detail.contributions.find(
			(row) =>
				row.status === 'pledged' &&
				(as === 'owner' || row.contributorId === api.userId),
		);
		if (pledge)
			return { kind: 'contribution', id: pledge.id, askId: detail.id };
	}
	return undefined;
}
