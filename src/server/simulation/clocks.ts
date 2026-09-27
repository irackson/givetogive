import 'server-only';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import { simulationRuns, toolOperations } from '@/server/db/operations-schema';
import { paymentConfiguration } from '@/server/payments/config';
import { stripeClient } from '@/server/payments/stripe';
import { ensureCustomerAccount } from '@/server/payments/accounts';
import { simulationCheckoutOrigin } from '@/server/payments/simulation-checkout-policy';
import { recordEvent } from '@/server/observability/events';
import {
	authenticateSimulation,
	requireSimulationScope,
	type SimulationActor,
} from './auth';
import { boundedJson, simulationScopes, stableInputHash } from './policy';
import {
	assertClockAdvance,
	assertClockCohort,
	clockCommandSchema,
	clockCreateId,
	verifyNamedClock,
} from './clock-policy';

function clockEnvironment(actor: SimulationActor) {
	const config = paymentConfiguration();
	if (
		actor.target.origin !== simulationCheckoutOrigin ||
		actor.target.stripeMode !== 'test' ||
		config.origin !== simulationCheckoutOrigin ||
		config.environment !== 'staging' ||
		config.livemode ||
		!config.configured
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	assertClockCohort(actor.run);
}
const operationWhere = (actorId: string, correlationId: string) =>
	and(
		eq(toolOperations.actorId, actorId),
		eq(toolOperations.correlationId, correlationId),
	);
async function createdClock(actor: SimulationActor) {
	const entry = await db.query.toolOperations.findFirst({
		where: operationWhere(
			actor.run.createdById,
			clockCreateId(actor.run.id),
		),
	});
	if (
		entry?.tool !== 'simulation_clock_create' ||
		entry.status !== 'completed' ||
		entry.result?.['runId'] !== actor.run.id ||
		typeof entry.result?.['clockId'] !== 'string' ||
		typeof entry.result?.['initialFrozenTime'] !== 'number'
	)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'Create this run’s clock through the scoped operator endpoint first.',
		});
	return {
		id: entry.result['clockId'],
		initialFrozenTime: entry.result['initialFrozenTime'],
	};
}

export async function simulationClockCommand(request: Request) {
	const actor = await authenticateSimulation(request, 'runner');
	requireSimulationScope(actor, simulationScopes.clock);
	clockEnvironment(actor);
	const input = clockCommandSchema.parse(await boundedJson(request, 2048));
	const stripe = stripeClient();
	if (input.action === 'read') {
		const binding = await createdClock(actor);
		const clock = await stripe.testHelpers.testClocks.retrieve(binding.id);
		verifyNamedClock(clock, actor.run.id, binding.id);
		return Response.json(
			{
				runId: actor.run.id,
				clockId: clock.id,
				frozenTime: clock.frozen_time,
				status: clock.status,
				livemode: false,
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	}
	const correlationId =
		input.action === 'create' ?
			clockCreateId(actor.run.id)
		:	input.operationId;
	const tool = `simulation_clock_${input.action}`;
	const inputHash = stableInputHash({ ...input, runId: actor.run.id });
	const operation = await db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.id, actor.run.id))
			.for('update');
		if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
		assertClockCohort(run);
		const inserted = await tx
			.insert(toolOperations)
			.values({ actorId: actor.user.id, correlationId, tool, inputHash })
			.onConflictDoNothing()
			.returning({ id: toolOperations.correlationId });
		const [prior] = await tx
			.select()
			.from(toolOperations)
			.where(operationWhere(actor.user.id, correlationId))
			.for('update');
		if (!prior || prior.tool !== tool || prior.inputHash !== inputHash)
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'The operation ID belongs to another clock action.',
			});
		return { ...prior, previouslyAdmitted: inserted.length === 0 };
	});
	if (operation.status === 'completed')
		return Response.json(operation.result, {
			headers: { 'Cache-Control': 'no-store' },
		});
	if (operation.status === 'failed')
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message:
				'This clock operation previously failed validation. Use a new valid operator command.',
		});
	if (Date.now() - operation.createdAt.getTime() > 23 * 3600_000)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'Ambiguous clock operations older than Stripe’s retry window require operator reconciliation.',
		});
	let clock;
	let initialFrozenTime: number;
	if (input.action === 'create') {
		initialFrozenTime = Math.floor(operation.createdAt.getTime() / 1000);
		clock = await stripe.testHelpers.testClocks.create(
			{
				name: `givetogive:${actor.run.id}`,
				frozen_time: initialFrozenTime,
			},
			{ idempotencyKey: `g2g-clock:${actor.run.id}:create` },
		);
	} else {
		const binding = await createdClock(actor);
		initialFrozenTime = binding.initialFrozenTime;
		const current = await stripe.testHelpers.testClocks.retrieve(
			binding.id,
		);
		verifyNamedClock(current, actor.run.id, binding.id);
		if (!operation.previouslyAdmitted) {
			try {
				if (current.status !== 'ready')
					throw new Error('Clock is advancing.');
				assertClockAdvance(
					current.frozen_time,
					input.frozenTime,
					initialFrozenTime,
				);
			} catch {
				await db
					.update(toolOperations)
					.set({
						status: 'failed',
						result: {
							error: 'Clock advance bounds or ready state failed validation.',
						},
						updatedAt: new Date(),
					})
					.where(operationWhere(actor.user.id, correlationId));
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'Clock advance bounds or ready state failed validation.',
				});
			}
		}
		// A retry after an acknowledged provider advance reconciles, never advances twice.
		if (
			current.frozen_time === input.frozenTime ||
			current.status_details.advancing?.target_frozen_time ===
				input.frozenTime
		)
			clock = current;
		else {
			if (current.status !== 'ready')
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Wait for the named test clock to become ready.',
				});
			assertClockAdvance(
				current.frozen_time,
				input.frozenTime,
				initialFrozenTime,
			);
			clock = await stripe.testHelpers.testClocks.advance(
				binding.id,
				{ frozen_time: input.frozenTime },
				{
					idempotencyKey: `g2g-clock:${actor.run.id}:${correlationId}`,
				},
			);
		}
	}
	verifyNamedClock(clock, actor.run.id);
	const result = {
		runId: actor.run.id,
		clockId: clock.id,
		frozenTime: clock.frozen_time,
		initialFrozenTime,
		status: clock.status,
		livemode: false,
	};
	await db.transaction(async (tx) => {
		await tx
			.update(toolOperations)
			.set({ status: 'completed', result, updatedAt: new Date() })
			.where(operationWhere(actor.user.id, correlationId));
		await recordEvent(
			{
				externalId: `simulation-clock:${actor.run.id}:${correlationId}`,
				actorId: actor.user.id,
				entityType: 'simulation_clock',
				entityId: clock.id,
				runId: actor.run.id,
				correlationId,
				action: tool,
				outcome: 'completed',
				summary: `Sandbox clock ${input.action} acknowledged; wait for ready and signed billing events.`,
			},
			tx,
		);
	});
	return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

/** Own-account binding only. Clock creation/advancement is never a member/model tool. */
export async function bindSimulationClock(actor: SimulationActor) {
	requireSimulationScope(actor, simulationScopes.payments);
	clockEnvironment(actor);
	const binding = await createdClock(actor);
	const account = await ensureCustomerAccount(actor.user.id, {
		runId: actor.run.id,
		clockId: binding.id,
	});
	// ensureCustomerAccount atomically stores the provider-verified account and
	// immutable clock binding. Do not write a weaker, separate legacy marker here.
	// The account ID is not a credential; do not expose contact, requirements, or payment method data.
	return {
		runId: actor.run.id,
		clockId: binding.id,
		actorId: actor.user.id,
		accountId: account.stripeAccountId,
		livemode: false,
	};
}
