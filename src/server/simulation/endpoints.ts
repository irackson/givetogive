import 'server-only';
import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import {
	operationEvents,
	simulationAgents,
	simulationCommands,
	simulationRuns,
} from '@/server/db/operations-schema';
import {
	authenticateSimulation,
	requireSimulationScope,
	type SimulationActor,
} from './auth';
import {
	boundedJson,
	safeSimulationText,
	sanitizeSimulationData,
	simulationScopes,
} from './policy';
import { paymentConfiguration } from '@/server/payments/config';
import { controllerHeader, requireControllerOwnership } from './controller';

const eventSchema = z
	.object({
		id: z.uuid(),
		agentId: z.string().min(1).max(64),
		sequence: z.number().int().positive().max(2_147_483_647),
		kind: z.enum([
			'agent_state',
			'action_result',
			'heartbeat',
			'run_started',
			'run_stopped',
			'run_paused',
			'run_completed',
			'control_applied',
			'control_rejected',
		]),
		state: z.enum([
			'idle',
			'observing',
			'waiting_for_inference',
			'generating',
			'acting',
			'backing_off',
			'paused',
			'failed',
		]),
		occurredAt: z.iso.datetime(),
		correlationId: z.string().max(64),
		summary: z.string().max(500),
		data: z.record(z.string(), z.unknown()),
	})
	.strict();
const eventsSchema = z
	.object({
		runId: z.string().min(1).max(64),
		events: z.array(eventSchema).min(1).max(100),
	})
	.strict();

export async function simulationManifest(request: Request) {
	const actor = await authenticateSimulation(request, 'runner');
	requireSimulationScope(actor, simulationScopes.runnerRead);
	const members = await db
		.select({ id: simulationAgents.id, userId: simulationAgents.userId })
		.from(simulationAgents)
		.where(eq(simulationAgents.runId, actor.run.id));
	return Response.json(
		{
			protocolVersion: 1,
			environment: 'staging',
			origin: actor.target.origin,
			databaseIdentity: actor.target.databaseIdentity,
			stripeMode: actor.target.stripeMode,
			paymentsConfigured: paymentConfiguration().configured,
			simulationEnabled: true,
			mcpPath: '/mcp',
			runStatus: actor.run.status,
			runId: actor.run.id,
			mode: actor.run.mode,
			agentCount: actor.run.agentCount,
			browserUsers:
				actor.run.mode === 'scripted' ?
					Number(actor.run.settings['browserUsers'] ?? 3)
				:	0,
			members,
		},
		{ headers: { 'Cache-Control': 'no-store' } },
	);
}

export async function simulationControl(request: Request) {
	const actor = await authenticateSimulation(request, 'runner');
	requireSimulationScope(actor, simulationScopes.runnerRead);
	requireControllerOwnership(
		actor.run,
		request.headers.get(controllerHeader),
	);
	const url = new URL(request.url);
	const runId = url.searchParams.get('runId');
	const after = url.searchParams.get('after') || '0';
	if (
		runId !== actor.run.id ||
		!/^\d{1,15}$/.test(after) ||
		!Number.isSafeInteger(Number(after))
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	const commands = await db
		.select()
		.from(simulationCommands)
		.where(
			and(
				eq(simulationCommands.runId, actor.run.id),
				gt(simulationCommands.id, Number(after)),
			),
		)
		.orderBy(asc(simulationCommands.id))
		.limit(100);
	return Response.json(
		{
			cursor: String(commands.at(-1)?.id ?? after),
			commands: commands.map((command) => ({
				id: String(command.id),
				type: command.type,
				...(command.agentId ? { agentId: command.agentId } : {}),
				...(typeof command.value === 'number' ?
					{ value: command.value }
				:	{}),
			})),
		},
		{ headers: { 'Cache-Control': 'no-store' } },
	);
}

export async function simulationEvents(request: Request) {
	const actor = await authenticateSimulation(request, 'runner');
	return ingestSimulationEvents(
		actor,
		await boundedJson(request, 262_144),
		request.headers.get(controllerHeader),
	);
}

/** Internal ingestion for an already authenticated runner; routes must use simulationEvents. */
export async function ingestSimulationEvents(
	actor: SimulationActor,
	body: unknown,
	controllerId?: string | null,
) {
	if (actor.token.kind !== 'runner')
		throw new TRPCError({ code: 'FORBIDDEN' });
	requireSimulationScope(actor, simulationScopes.runnerEvents);
	const parsed = eventsSchema.safeParse(body);
	if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST' });
	const input = parsed.data;
	if (input.runId !== actor.run.id)
		throw new TRPCError({ code: 'FORBIDDEN' });
	const members = await db
		.select({ id: simulationAgents.id, userId: simulationAgents.userId })
		.from(simulationAgents)
		.where(eq(simulationAgents.runId, actor.run.id));
	const memberIds = new Map(
		members.map((member) => [member.id, member.userId]),
	);
	for (const event of input.events) {
		if (event.agentId !== 'runner' && !memberIds.has(event.agentId))
			throw new TRPCError({ code: 'FORBIDDEN' });
		if (
			event.agentId !== 'runner' &&
			[
				'heartbeat',
				'run_started',
				'run_stopped',
				'run_paused',
				'run_completed',
				'control_applied',
				'control_rejected',
			].includes(event.kind)
		)
			throw new TRPCError({ code: 'BAD_REQUEST' });
		if (Date.parse(event.occurredAt) > Date.now() + 60_000)
			throw new TRPCError({ code: 'BAD_REQUEST' });
	}
	await db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.id, actor.run.id))
			.for('update');
		if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
		requireControllerOwnership(run, controllerId, true);
		let terminal = ['stopped', 'completed', 'cancelled'].includes(
			run.status,
		);
		let runnerSequence = Number(run.settings['runnerSequence'] ?? 0);
		let metrics = run.metrics;
		for (const event of input.events) {
			const externalId = `simulation:${actor.run.id}:${event.id}`;
			if (
				run.mode === 'scripted' &&
				run.settings['controllerId'] === null
			) {
				// A released owner may only acknowledge already-persisted retries, not publish new activity.
				const [persisted] = await tx
					.select({ id: operationEvents.id })
					.from(operationEvents)
					.where(eq(operationEvents.externalId, externalId))
					.limit(1);
				if (persisted) continue;
				throw new TRPCError({ code: 'CONFLICT' });
			}
			if (terminal && event.kind === 'run_started') {
				const [persisted] = await tx
					.select({ id: operationEvents.id })
					.from(operationEvents)
					.where(eq(operationEvents.externalId, externalId))
					.limit(1);
				if (persisted) continue;
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Finished simulation runs cannot restart.',
				});
			}
			const details = sanitizeSimulationData(event.data);
			const summary = safeSimulationText(event.summary);
			const [inserted] = await tx
				.insert(operationEvents)
				.values({
					externalId,
					environment: 'staging',
					actorId:
						event.agentId === 'runner' ?
							actor.user.id
						:	memberIds.get(event.agentId),
					entityType: 'simulation',
					entityId: event.agentId,
					action: `simulation_${event.kind}`,
					outcome: event.state,
					correlationId: event.correlationId,
					runId: actor.run.id,
					summary,
					details: {
						...details,
						sequence: event.sequence,
						source: 'runner_telemetry',
					},
					occurredAt: new Date(event.occurredAt),
				})
				.onConflictDoNothing({ target: operationEvents.externalId })
				.returning({ id: operationEvents.id });
			if (!inserted) continue;
			if (event.agentId !== 'runner') {
				await tx
					.update(simulationAgents)
					.set({
						state: event.state,
						sequence: event.sequence,
						lastAction: summary,
						updatedAt: new Date(),
						...((
							typeof details['cycles'] === 'number' &&
							Number.isSafeInteger(details['cycles']) &&
							details['cycles'] <= 2_147_483_647
						) ?
							{ cycles: details['cycles'] }
						:	{}),
					})
					.where(
						and(
							eq(simulationAgents.id, event.agentId),
							eq(simulationAgents.runId, actor.run.id),
							lt(simulationAgents.sequence, event.sequence),
						),
					);
			} else if (
				!terminal &&
				event.sequence > runnerSequence &&
				(event.kind === 'heartbeat' ||
					event.kind === 'run_started' ||
					event.kind === 'run_stopped' ||
					event.kind === 'run_paused' ||
					event.kind === 'run_completed')
			) {
				// Never infer financial success from telemetry. These fields describe only the local runner.
				runnerSequence = event.sequence;
				// Lifecycle events may omit measurements or report only final counts.
				// Preserve the last measured fields, including within this same batch.
				if (event.kind !== 'run_started')
					metrics = { ...metrics, ...details };
				await tx
					.update(simulationRuns)
					.set({
						settings: { ...run.settings, runnerSequence },
						lastHeartbeatAt: new Date(),
						status:
							event.kind === 'run_completed' ? 'completed'
							: event.kind === 'run_stopped' ? 'stopped'
							: event.kind === 'run_paused' ? 'paused'
							: event.state === 'paused' ? 'paused'
							: 'running',
						...(event.kind !== 'run_started' ? { metrics } : {}),
						...(event.kind === 'run_started' ?
							{ startedAt: new Date(), finishedAt: null }
						:	{}),
						...((
							event.kind === 'run_stopped' ||
							event.kind === 'run_completed'
						) ?
							{ finishedAt: new Date() }
						:	{}),
					})
					.where(eq(simulationRuns.id, actor.run.id));
				terminal =
					event.kind === 'run_stopped' ||
					event.kind === 'run_completed';
			}
		}
	});
	// Includes retries already present in the inbox; the runner can safely prune its outbox.
	const persisted = await db
		.select({ externalId: operationEvents.externalId })
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.runId, actor.run.id),
				inArray(
					operationEvents.externalId,
					input.events.map(
						(event) => `simulation:${actor.run.id}:${event.id}`,
					),
				),
			),
		);
	return Response.json(
		{
			acceptedIds: persisted.map((event) =>
				event.externalId!.split(':').at(-1),
			),
		},
		{ headers: { 'Cache-Control': 'no-store' } },
	);
}
