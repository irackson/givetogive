import 'server-only';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '@/server/db';
import {
	simulationAgents,
	simulationCommands,
	simulationRuns,
} from '@/server/db/operations-schema';
import { users } from '@/server/db/schema';
import { requireSimulationScope, type SimulationActor } from './auth';
import { simulationScopes } from './policy';
import { assertAdmin } from '@/server/security/authorization';
import { recordEvent } from '@/server/observability/events';

export const controllerHeader = 'x-givetogive-controller';
export const controllerRecoveryConfirmation =
	'CONTROLLER STOPPED AND PENDING ACTIONS REVIEWED';
export const controllerRecoverySchema = z
	.object({
		runId: z.string().min(1).max(64),
		controllerId: z.uuid(),
		confirmation: z.literal(controllerRecoveryConfirmation),
	})
	.strict();
const commandSchema = z
	.object({
		runId: z.string().min(1).max(64),
		controllerId: z.uuid(),
		journalId: z.uuid(),
		programDigest: z.string().regex(/^[a-f0-9]{64}$/),
		action: z.enum(['acquire', 'release']),
	})
	.strict();

/** Run-wide fencing is durable and never expires into automatic takeover. */
export function requireControllerOwnership(
	run: Pick<typeof simulationRuns.$inferSelect, 'mode' | 'settings'>,
	controllerId?: string | null,
	allowReleased = false,
) {
	if (run.mode !== 'scripted') return;
	const owner = run.settings['controllerId'];
	if (
		!controllerId ||
		(owner !== controllerId &&
			!(
				allowReleased &&
				owner === null &&
				run.settings['lastControllerId'] === controllerId
			))
	)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'Community controller ownership is unavailable; recovery review is required.',
		});
}

/** Internal authenticated layer, also exercised on the isolated CI database. */
export async function changeSimulationController(
	actor: SimulationActor,
	body: unknown,
) {
	if (actor.token.kind !== 'runner')
		throw new TRPCError({ code: 'FORBIDDEN' });
	requireSimulationScope(actor, simulationScopes.runnerEvents);
	const parsed = commandSchema.safeParse(body);
	if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST' });
	const input = parsed.data;
	if (input.runId !== actor.run.id)
		throw new TRPCError({ code: 'FORBIDDEN' });
	return db.transaction(async (tx) => {
		const cohort = await tx
			.select({ id: simulationAgents.userId })
			.from(simulationAgents)
			.where(eq(simulationAgents.runId, input.runId));
		const userIds = cohort.map(({ id }) => id);
		if (input.action === 'acquire' && userIds.length) {
			// Serialize overlapping cohorts across runs, not only competing claims on one run.
			await tx
				.select({ id: users.id })
				.from(users)
				.where(inArray(users.id, userIds))
				.orderBy(asc(users.id))
				.for('update');
			const overlaps = await tx
				.select({ id: simulationRuns.id })
				.from(simulationRuns)
				.innerJoin(
					simulationAgents,
					eq(simulationAgents.runId, simulationRuns.id),
				)
				.where(
					and(
						ne(simulationRuns.id, input.runId),
						inArray(simulationAgents.userId, userIds),
						sql`${simulationRuns.settings}->>'controllerId' is not null`,
					),
				)
				.limit(1);
			if (overlaps.length)
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'An account in this cohort is owned by another run controller.',
				});
		}
		const [run] = await tx
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.id, input.runId))
			.for('update');
		if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
		if (
			run.mode !== 'scripted' ||
			run.environment !== 'staging' ||
			run.createdById !== actor.user.id ||
			run.databaseIdentity !== actor.target.databaseIdentity
		)
			throw new TRPCError({ code: 'FORBIDDEN' });
		const settings = { ...run.settings };
		if (
			settings['controllerJournalId'] &&
			settings['controllerJournalId'] !== input.journalId
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'Restore the existing journal instead of restarting the cohort with empty history.',
			});
		if (input.action === 'acquire') {
			if (cohort.length !== run.agentCount)
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'The complete cohort must be provisioned first.',
				});
			if (!['created', 'running', 'paused'].includes(run.status))
				throw new TRPCError({ code: 'CONFLICT' });
			if (
				settings['controllerId'] &&
				settings['controllerId'] !== input.controllerId
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'Another controller owns this community. A stale heartbeat does not authorize takeover.',
				});
			if (
				settings['programDigest'] &&
				settings['programDigest'] !== input.programDigest
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'Create a fresh run rather than changing its program.',
				});
			settings['controllerId'] = input.controllerId;
			settings['programDigest'] = input.programDigest;
			settings['controllerJournalId'] = input.journalId;
			settings['controllerAcquiredAt'] ??= new Date().toISOString();
		} else {
			requireControllerOwnership(run, input.controllerId, true);
			if (settings['programDigest'] !== input.programDigest)
				throw new TRPCError({ code: 'CONFLICT' });
			settings['controllerId'] = null;
			settings['lastControllerId'] = input.controllerId;
			settings['controllerAcquiredAt'] = null;
		}
		await tx
			.update(simulationRuns)
			.set({ settings })
			.where(eq(simulationRuns.id, run.id));
		return {
			runId: run.id,
			controllerId: input.controllerId,
			action: input.action,
		};
	});
}

/** Caller must independently attest isolated staging; recovery never clears member intents. */
export async function recoverSimulationController(
	operatorId: string,
	databaseIdentity: string,
	body: unknown,
) {
	await assertAdmin(operatorId);
	const parsed = controllerRecoverySchema.safeParse(body);
	if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST' });
	const input = parsed.data;
	return db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.id, input.runId))
			.for('update');
		if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
		if (
			run.environment !== 'staging' ||
			run.databaseIdentity !== databaseIdentity ||
			run.mode !== 'scripted'
		)
			throw new TRPCError({ code: 'FORBIDDEN' });
		if (!['created', 'running', 'paused'].includes(run.status))
			throw new TRPCError({ code: 'CONFLICT' });
		if (
			run.settings['controllerId'] === null &&
			run.settings['recoveredControllerId'] === input.controllerId
		)
			return { recovered: true, alreadyRecovered: true };
		if (run.settings['controllerId'] !== input.controllerId)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'Controller ownership changed; refresh before recovery.',
			});
		const acquiredAt = run.settings['controllerAcquiredAt'];
		const lastContact = Math.max(
			run.lastHeartbeatAt?.getTime() ?? 0,
			typeof acquiredAt === 'string' ? Date.parse(acquiredAt) : NaN,
		);
		if (!Number.isFinite(lastContact) || Date.now() - lastContact < 120_000)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'A recent controller cannot be recovered. Stop it and wait at least two minutes without contact.',
			});
		await tx
			.update(simulationRuns)
			.set({
				status: 'paused',
				settings: {
					...run.settings,
					controllerId: null,
					controllerAcquiredAt: null,
					lastControllerId: input.controllerId,
					recoveredControllerId: input.controllerId,
				},
			})
			.where(eq(simulationRuns.id, run.id));
		await tx
			.insert(simulationCommands)
			.values({ runId: run.id, actorId: operatorId, type: 'pause' });
		await recordEvent(
			{
				actorId: operatorId,
				entityType: 'simulation',
				entityId: run.id,
				runId: run.id,
				externalId: `controller-recovery:${run.id}:${input.controllerId}`,
				action: 'simulation_controller_recovered',
				outcome: 'paused',
				summary:
					'Operator confirmed stopped controller and reviewed pending actions; run remains paused.',
				details: {
					controllerId: input.controllerId,
					pendingActionsCleared: false,
				},
			},
			tx,
		);
		return { recovered: true, alreadyRecovered: false };
	});
}
