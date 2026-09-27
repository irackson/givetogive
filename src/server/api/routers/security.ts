import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { generateSecret, generateURI, verify } from 'otplib';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { apiTokens, userSecurity } from '@/server/db/operations-schema';
import { openSecret, sealSecret } from '@/server/security/crypto';
import { verifyPassword } from '@/server/auth/password';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import { recordEvent } from '@/server/observability/events';
import { applicationEnvironment } from '@/lib/environment';

async function recentAuth(userId: string, authenticatedAt: number, password: string | undefined, headers: Headers) {
	if (!(await recordRateLimitAttempt('security', userId, headers, 16))) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
	if (authenticatedAt > Date.now() - 10 * 60_000) return;
	const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { hashedPassword: true } });
	if (!password || !user?.hashedPassword || !(await verifyPassword(password, user.hashedPassword))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in again, or confirm your current password.' });
	}
}
const confirmation = z.object({ code: z.string().regex(/^\d{6}$/), password: z.string().max(256).optional() });

export const securityRouter = createTRPCRouter({
	me: protectedProcedure.query(async ({ ctx }) => {
		const security = await db.query.userSecurity.findFirst({ where: eq(userSecurity.userId, ctx.session.user.id) });
		return { role: ctx.session.user.role, totpEnabled: Boolean(security?.totpEnabledAt),
			recentAuthentication: ctx.session.user.authenticatedAt > Date.now() - 10 * 60_000, environment: applicationEnvironment() };
	}),
	beginTotp: protectedProcedure.input(z.object({ password: z.string().max(256).optional() })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		await recentAuth(userId, ctx.session.user.authenticatedAt, input.password, ctx.headers);
		const secret = generateSecret();
		await db.transaction(async (tx) => {
			await tx.insert(userSecurity).values({ userId }).onConflictDoNothing();
			const [current] = await tx.select().from(userSecurity).where(eq(userSecurity.userId, userId)).for('update');
			if (current?.totpEnabledAt) throw new TRPCError({ code: 'CONFLICT', message: 'An authenticator is already enrolled.' });
			await tx.update(userSecurity).set({ totpPendingCiphertext: sealSecret(secret, `totp:${userId}`), updatedAt: new Date() }).where(eq(userSecurity.userId, userId));
			await recordEvent({ actorId: userId, entityType: 'user', entityId: userId, action: 'totp_enrollment_started', outcome: 'success' }, tx);
		});
		return { secret, uri: generateURI({ issuer: 'GiveToGive', label: ctx.session.user.email ?? userId, secret }) };
	}),
	confirmTotp: protectedProcedure.input(confirmation).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		await recentAuth(userId, ctx.session.user.authenticatedAt, input.password, ctx.headers);
		await db.transaction(async (tx) => {
			const [security] = await tx.select().from(userSecurity).where(eq(userSecurity.userId, userId)).for('update');
			if (!security?.totpPendingCiphertext || security.totpEnabledAt || security.updatedAt < new Date(Date.now() - 10 * 60_000)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Start authenticator enrollment again.' });
			const result = await verify({ secret: openSecret(security.totpPendingCiphertext, `totp:${userId}`), token: input.code, epochTolerance: 30 });
			if (!result.valid || !('timeStep' in result)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid authenticator code.' });
			await tx.update(userSecurity).set({ totpCiphertext: security.totpPendingCiphertext, totpPendingCiphertext: null, totpEnabledAt: new Date(), totpLastStep: result.timeStep, updatedAt: new Date() }).where(eq(userSecurity.userId, userId));
			await recordEvent({ actorId: userId, entityType: 'user', entityId: userId, action: 'totp_enrolled', outcome: 'success' }, tx);
		});
		return { enabled: true as const };
	}),
	elevate: protectedProcedure.input(confirmation).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		if (ctx.session.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
		await recentAuth(userId, ctx.session.user.authenticatedAt, input.password, ctx.headers);
		await db.transaction(async (tx) => {
			const [security] = await tx.select().from(userSecurity).where(eq(userSecurity.userId, userId)).for('update');
			if (!security?.totpCiphertext || !security.totpEnabledAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'Enroll an authenticator first.' });
			const result = await verify({ secret: openSecret(security.totpCiphertext, `totp:${userId}`), token: input.code, epochTolerance: 30,
				...(security.totpLastStep === null ? {} : { afterTimeStep: security.totpLastStep }) });
			if (!result.valid || !('timeStep' in result)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid or already used authenticator code.' });
			await tx.update(userSecurity).set({ totpLastStep: result.timeStep, updatedAt: new Date() }).where(eq(userSecurity.userId, userId));
			await recordEvent({ actorId: userId, entityType: 'user', entityId: userId, action: 'admin_elevated', outcome: 'success' }, tx);
		});
		const expiresAt = new Date(Date.now() + 5 * 60_000);
		return { token: sealSecret(JSON.stringify({ userId, expiresAt: expiresAt.getTime(), sessionVersion: ctx.session.user.sessionVersion }), 'admin-elevation'), expiresAt };
	}),
	revokeSessions: protectedProcedure.mutation(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		await db.transaction(async (tx) => {
			await tx.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
			await tx.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.userId, userId), sql`${apiTokens.revokedAt} is null`));
			await recordEvent({ actorId: userId, entityType: 'user', entityId: userId, action: 'sessions_revoked', outcome: 'success' }, tx);
		});
		return { revoked: true as const };
	}),
});
