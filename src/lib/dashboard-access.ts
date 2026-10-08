import type { ApplicationEnvironment } from './environment.ts';

export const dashboardOwnerEmail = 'inasusr@gmail.com';

type DashboardIdentity = {
	email: string | null;
	emailVerified: Date | null;
	frozenAt: Date | null;
	isSynthetic: boolean;
	role: 'member' | 'admin';
};

/** Use a current database identity, never request fields or an email-only session claim. */
export function dashboardAccessAllowed(
	user: DashboardIdentity,
	environment: ApplicationEnvironment,
): boolean {
	if (!user.emailVerified || user.frozenAt) return false;
	if (!user.isSynthetic)
		return user.email?.toLowerCase() === dashboardOwnerEmail;
	// Existing synthetic operators are for isolated tests, not production or a
	// generic development server that may use the production-like root env.
	return (
		(environment === 'staging' || environment === 'test') &&
		user.role === 'admin'
	);
}
