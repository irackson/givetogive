import 'server-only';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { applicationEnvironment } from '@/lib/environment';
import { dashboardAccessAllowed } from '@/lib/dashboard-access';
import { openSecret } from './crypto';

export async function requireActiveUser(
	userId: string,
	sessionVersion?: number,
	executor: Pick<typeof db, 'query'> = db,
) {
	const user = await executor.query.users.findFirst({
		where: eq(users.id, userId),
		columns: {
			id: true,
			email: true,
			role: true,
			sessionVersion: true,
			frozenAt: true,
			emailVerified: true,
			isSynthetic: true,
		},
	});
	if (
		!user ||
		user.frozenAt ||
		(sessionVersion !== undefined && sessionVersion !== user.sessionVersion)
	) {
		throw new TRPCError({
			code: 'UNAUTHORIZED',
			message: 'Your session is no longer active. Please sign in again.',
		});
	}
	return user;
}
/** Identity only. Its caller must expose a narrow own-billing operation, never general authority. */
export async function requireBillingIdentity(
	userId: string,
	sessionVersion: number,
	access: 'active' | 'billing_only' | undefined,
	executor: Pick<typeof db, 'query'> = db,
) {
	const user = await executor.query.users.findFirst({
		where: eq(users.id, userId),
		columns: {
			id: true,
			sessionVersion: true,
			frozenAt: true,
			emailVerified: true,
		},
	});
	if (
		!user?.emailVerified ||
		!Number.isInteger(sessionVersion) ||
		sessionVersion !== user.sessionVersion ||
		Boolean(user.frozenAt) !== (access === 'billing_only')
	) {
		throw new TRPCError({
			code: 'UNAUTHORIZED',
			message: 'Sign in again to manage your own billing.',
		});
	}
	return user;
}
export async function hasAdminDashboardAccess(
	userId: string,
): Promise<boolean> {
	try {
		const user = await requireActiveUser(userId);
		return dashboardAccessAllowed(user, applicationEnvironment());
	} catch (error) {
		// A revoked identity must hide navigation, not fail the public layout.
		// Infrastructure failures still propagate instead of masquerading as denial.
		if (error instanceof TRPCError && error.code === 'UNAUTHORIZED')
			return false;
		throw error;
	}
}
export async function assertAdmin(userId: string): Promise<void> {
	const user = await requireActiveUser(userId);
	if (!dashboardAccessAllowed(user, applicationEnvironment()))
		throw new TRPCError({ code: 'FORBIDDEN' });
}
export async function assertFinancialAdmin(
	userId: string,
	elevationToken?: string,
): Promise<void> {
	await assertAdmin(userId);
	// Dashboard access is not a grant of financial authority. Personal MFA
	// enrollment is deferred; existing production step-up remains mandatory.
	const administrator = await requireActiveUser(userId);
	if (administrator.role !== 'admin')
		throw new TRPCError({ code: 'FORBIDDEN' });
	if (applicationEnvironment() !== 'production') return;
	try {
		if (!elevationToken) throw new Error('Missing token');
		const payload: unknown = JSON.parse(
			openSecret(elevationToken, 'admin-elevation'),
		);
		const user = await requireActiveUser(userId);
		if (
			user.role !== 'admin' ||
			!payload ||
			typeof payload !== 'object' ||
			!('userId' in payload) ||
			payload.userId !== userId ||
			!('expiresAt' in payload) ||
			typeof payload.expiresAt !== 'number' ||
			payload.expiresAt <= Date.now() ||
			!('sessionVersion' in payload) ||
			payload.sessionVersion !== user.sessionVersion
		)
			throw new Error('Expired token');
	} catch {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message:
				'Confirm recent sign-in and your authenticator code before this financial action.',
		});
	}
}
