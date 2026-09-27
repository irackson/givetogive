/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { getBillingAuthSession } from '@/server/auth';
import { activeSession, sessionContexts } from '@/server/auth/session-policy';
import type { Session } from 'next-auth';
import { db } from '@/server/db';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import {
	requireActiveUser,
	requireBillingIdentity,
} from '@/server/security/authorization';
import { recordRequestMetric } from '@/server/observability/metrics';
export type ApplicationDatabase =
	typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
type TRPCContext = {
	db: ApplicationDatabase;
	session: Session | null;
	/** Kept separate so public owner-only projections never see frozen identities. */
	billingSession?: Session | null;
	headers: Headers;
};
export const createTRPCContext = async (opts: {
	headers: Headers;
}): Promise<TRPCContext> => {
	const session = await getBillingAuthSession();

	return {
		db: db as ApplicationDatabase,
		...sessionContexts(session),
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ?
						error.cause.flatten()
					:	null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Measure actual procedure execution without synthetic delay or sensitive inputs.
 */
const timingMiddleware = t.middleware(async ({ next, path, ctx }) => {
	const start = Date.now();

	const result = await next();

	const end = Date.now();
	console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
	// A caller inside a transaction must not wait on a second connection from the
	// same pool. MCP has separate run telemetry; this series covers top-level calls.
	if (ctx.db === db) await recordRequestMetric(path, result.ok, end - start);

	return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
	.use(timingMiddleware)
	.use(({ ctx, next }) =>
		next({ ctx: { session: activeSession(ctx.session) } }),
	);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
	.use(timingMiddleware)
	.use(async ({ ctx, next }) => {
		if (!ctx.session || !ctx.session.user) {
			throw new TRPCError({ code: 'UNAUTHORIZED' });
		}
		await requireActiveUser(
			ctx.session.user.id,
			ctx.session.user.sessionVersion,
			ctx.db,
		);
		return next({
			ctx: {
				// infers the `session` as non-nullable
				session: { ...ctx.session, user: ctx.session.user },
			},
		});
	});

/** Only own billing reads and narrowly checked stop-billing operations may use this. */
export const billingManagementProcedure = t.procedure
	.use(timingMiddleware)
	.use(async ({ ctx, next }) => {
		const identity = ctx.billingSession ?? ctx.session;
		if (!identity?.user?.id) throw new TRPCError({ code: 'UNAUTHORIZED' });
		await requireBillingIdentity(
			identity.user.id,
			identity.user.sessionVersion,
			identity.access,
			ctx.db,
		);
		return next({ ctx: { billingSession: identity } });
	});
