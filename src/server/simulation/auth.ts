import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import {
	apiTokens,
	simulationAgents,
	simulationRuns,
} from '@/server/db/operations-schema';
import { users } from '@/server/db/schema';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import { assertSimulationEnvironment } from './guard';
import { bearerToken, hashSimulationToken } from './policy';

export async function authenticateSimulation(
	request: Request,
	kind: 'agent' | 'runner',
) {
	const target = await assertSimulationEnvironment();
	return resolveSimulationCredentials(request, kind, target);
}

/** Internal credential layer; HTTP handlers must use authenticateSimulation for the DB/environment guard. */
export async function resolveSimulationCredentials(
	request: Request,
	kind: 'agent' | 'runner',
	target: Awaited<ReturnType<typeof assertSimulationEnvironment>>,
) {
	const origin = request.headers.get('origin');
	if (origin && origin !== target.origin)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Cross-origin simulation requests are forbidden.',
		});
	if (new URL(request.url).origin !== target.origin)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Incorrect simulation origin.',
		});
	let token: string;
	try {
		token = bearerToken(request.headers);
	} catch {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	const [entry] = await db
		.select({
			token: apiTokens,
			user: {
				id: users.id,
				name: users.name,
				email: users.email,
				role: users.role,
				sessionVersion: users.sessionVersion,
				frozenAt: users.frozenAt,
				emailVerified: users.emailVerified,
				isSynthetic: users.isSynthetic,
			},
			run: simulationRuns,
		})
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.innerJoin(simulationRuns, eq(simulationRuns.id, apiTokens.runId))
		.where(
			and(
				eq(apiTokens.tokenHash, hashSimulationToken(token)),
				eq(apiTokens.kind, kind),
				eq(apiTokens.environment, 'staging'),
				isNull(apiTokens.revokedAt),
				gt(apiTokens.expiresAt, new Date()),
			),
		)
		.limit(1);
	if (
		!entry ||
		entry.user.frozenAt ||
		!entry.user.emailVerified ||
		entry.user.sessionVersion !== entry.token.sessionVersion ||
		entry.run.environment !== 'staging' ||
		entry.run.databaseIdentity !== target.databaseIdentity
	)
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (
		kind === 'runner' &&
		(entry.user.role !== 'admin' || entry.run.createdById !== entry.user.id)
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	if (kind === 'agent') {
		const member = await db.query.simulationAgents.findFirst({
			where: and(
				eq(simulationAgents.runId, entry.run.id),
				eq(simulationAgents.userId, entry.user.id),
			),
		});
		if (
			!member ||
			!entry.user.isSynthetic ||
			['stopped', 'completed', 'cancelled'].includes(entry.run.status)
		)
			throw new TRPCError({ code: 'FORBIDDEN' });
	}
	// Per-token fixed server identity: spoofed client IP headers cannot reset the limit.
	if (
		!(await recordRateLimitAttempt(
			`simulation-${kind}`,
			entry.token.id,
			new Headers(),
			kind === 'runner' ? 5000 : 1200,
		))
	)
		throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
	return { ...entry, target };
}
export type SimulationActor = Awaited<
	ReturnType<typeof authenticateSimulation>
>;
export function requireSimulationScope(actor: SimulationActor, scope: string) {
	if (!actor.token.scopes.includes(scope))
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'This token does not grant the required scope.',
		});
}
export function simulationError(error: unknown) {
	const message = error instanceof Error ? error.message : '';
	const statuses: Partial<Record<TRPCError['code'], number>> = {
		UNAUTHORIZED: 401,
		FORBIDDEN: 403,
		TOO_MANY_REQUESTS: 429,
		NOT_FOUND: 404,
		BAD_REQUEST: 400,
	};
	const status =
		message === 'BODY_TOO_LARGE' ? 413
		: message === 'JSON_REQUIRED' || error instanceof SyntaxError ? 400
		: error instanceof TRPCError ? (statuses[error.code] ?? 503)
		: 503;
	return Response.json(
		{
			error:
				status === 401 ? 'Authentication required.'
				: status === 413 ? 'Request body is too large.'
				: status === 429 ? 'Rate limit exceeded.'
				: 'Simulation request is unavailable or invalid.',
		},
		{
			status,
			headers: {
				'Cache-Control': 'no-store',
				...(status === 401 ?
					{ 'WWW-Authenticate': 'Bearer realm="GiveToGive staging"' }
				:	{}),
			},
		},
	);
}
