import 'server-only';
import { and, eq, gt, isNull, isNotNull, notInArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import {
	apiTokens,
	toolOperations,
	simulationRuns,
} from '@/server/db/operations-schema';
import { users } from '@/server/db/schema';
import { payments } from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import type { SimulationActor } from '@/server/simulation/auth';
import { stableInputHash } from '@/server/simulation/policy';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function serializableResult(value: unknown): Record<string, unknown> {
	const data: unknown = JSON.parse(JSON.stringify(value ?? {}));
	return data && typeof data === 'object' && !Array.isArray(data) ?
			(data as Record<string, unknown>)
		:	{ items: data };
}
async function lockAuthorization(tx: Transaction, actor: SimulationActor) {
	const [token] = await tx
		.select({ id: apiTokens.id, scopes: apiTokens.scopes })
		.from(apiTokens)
		.where(
			and(
				eq(apiTokens.id, actor.token.id),
				eq(apiTokens.userId, actor.user.id),
				eq(apiTokens.runId, actor.run.id),
				eq(apiTokens.kind, 'agent'),
				eq(apiTokens.sessionVersion, actor.token.sessionVersion),
				isNull(apiTokens.revokedAt),
				gt(apiTokens.expiresAt, new Date()),
			),
		)
		.for('share');
	const [user] = await tx
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.id, actor.user.id),
				eq(users.sessionVersion, actor.token.sessionVersion),
				eq(users.isSynthetic, true),
				isNotNull(users.emailVerified),
				isNull(users.frozenAt),
			),
		)
		.for('share');
	const [run] = await tx
		.select({ id: simulationRuns.id })
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.id, actor.run.id),
				notInArray(simulationRuns.status, [
					'stopped',
					'completed',
					'cancelled',
				]),
			),
		)
		.for('share');
	if (
		!token ||
		!user ||
		!run ||
		!actor.token.scopes.every((scope) => token.scopes.includes(scope))
	)
		throw new TRPCError({ code: 'UNAUTHORIZED' });
}
function keyWhere(actorId: string, correlationId: string) {
	return and(
		eq(toolOperations.actorId, actorId),
		eq(toolOperations.correlationId, correlationId),
	);
}

export async function atomicToolOperation(
	actor: SimulationActor,
	tool: string,
	correlationId: string,
	input: unknown,
	execute: (tx: Transaction) => Promise<unknown>,
) {
	const hash = stableInputHash(input);
	const completed = await db.transaction(async (tx) => {
		await lockAuthorization(tx, actor);
		await tx
			.insert(toolOperations)
			.values({
				actorId: actor.user.id,
				correlationId,
				tool,
				inputHash: hash,
			})
			.onConflictDoNothing();
		const [operation] = await tx
			.select()
			.from(toolOperations)
			.where(keyWhere(actor.user.id, correlationId))
			.for('update');
		if (
			!operation ||
			operation.tool !== tool ||
			operation.inputHash !== hash
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'The operation ID was already used with different inputs.',
			});
		if (operation.status === 'completed' || operation.status === 'failed')
			return operation;
		let result: Record<string, unknown>;
		let status: 'completed' | 'failed';
		try {
			result = serializableResult(
				await tx.transaction((savepoint) => execute(savepoint)),
			);
			status = 'completed';
		} catch (error) {
			// Roll back all domain effects to the savepoint, but durably retain a definite failed result.
			result = {
				error:
					(
						error instanceof TRPCError &&
						error.code !== 'INTERNAL_SERVER_ERROR'
					) ?
						error.message
					:	'The action could not be completed.',
				code:
					error instanceof TRPCError ?
						error.code
					:	'INTERNAL_SERVER_ERROR',
			};
			status = 'failed';
		}
		await tx
			.update(toolOperations)
			.set({ status, result, updatedAt: new Date() })
			.where(keyWhere(actor.user.id, correlationId));
		await recordEvent(
			{
				actorId: actor.user.id,
				entityType: 'mcp_operation',
				entityId: correlationId,
				action: tool,
				outcome: status,
				correlationId,
				runId: actor.run.id,
				summary: `${tool} ${status}`,
				details: { transport: 'mcp' },
			},
			tx,
		);
		return { status, result };
	});
	if (completed.status === 'failed')
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: String(
				completed.result?.['error'] ?? 'The prior action failed.',
			),
		});
	return completed.result ?? {};
}

export async function externalToolOperation(
	actor: SimulationActor,
	tool: string,
	correlationId: string,
	input: unknown,
	execute: () => Promise<unknown>,
) {
	const inputHash = stableInputHash(input);
	const prior = await db.transaction(async (tx) => {
		await lockAuthorization(tx, actor);
		await tx
			.insert(toolOperations)
			.values({ actorId: actor.user.id, correlationId, tool, inputHash })
			.onConflictDoNothing();
		const [operation] = await tx
			.select()
			.from(toolOperations)
			.where(keyWhere(actor.user.id, correlationId))
			.for('update');
		if (
			!operation ||
			operation.tool !== tool ||
			operation.inputHash !== inputHash
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'The operation ID was already used with different inputs.',
			});
		return operation;
	});
	if (prior.status === 'completed') return prior.result ?? {};
	// Network outside the transaction. The payment service independently enforces the SAME operation UUID and input hash.
	const result = serializableResult(await execute());
	await db.transaction(async (tx) => {
		await tx
			.update(toolOperations)
			.set({ status: 'completed', result, updatedAt: new Date() })
			.where(keyWhere(actor.user.id, correlationId));
		await recordEvent(
			{
				externalId: `mcp:${actor.user.id}:${correlationId}`,
				actorId: actor.user.id,
				entityType: 'mcp_operation',
				entityId: correlationId,
				action: tool,
				outcome: 'completed',
				correlationId,
				runId: actor.run.id,
				summary: `${tool} prepared; payment still requires Stripe confirmation.`,
				details: { transport: 'mcp' },
			},
			tx,
		);
	});
	return result;
}

export async function operationStatus(actorId: string, correlationId: string) {
	const operation = await db.query.toolOperations.findFirst({
		where: keyWhere(actorId, correlationId),
	});
	if (!operation) return { status: 'not_found' };
	if (
		operation.status === 'pending' &&
		operation.tool === 'prepare_checkout'
	) {
		const [payment] = await db
			.select({
				id: payments.id,
				actorId: payments.actorId,
				status: payments.status,
				checkoutId: payments.checkoutId,
				checkoutUrl: payments.checkoutUrl,
			})
			.from(payments)
			.where(
				and(
					eq(payments.id, correlationId),
					eq(payments.actorId, actorId),
					eq(payments.livemode, false),
				),
			);
		if (payment?.checkoutId && payment.checkoutUrl)
			return {
				status: 'completed',
				result: {
					id: payment.checkoutId,
					operationId: payment.id,
					url: payment.checkoutUrl,
				},
			};
		if (payment && ['failed', 'expired'].includes(payment.status))
			return { status: 'failed' };
	}
	return { status: operation.status, result: operation.result };
}
