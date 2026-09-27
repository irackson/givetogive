import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

export type SessionIdentity = {
	id: string;
	role: 'member' | 'admin';
	sessionVersion: number;
	frozenAt: Date | null;
	emailVerified: Date | null;
};

/** A freeze revokes old sessions; only a new verified login gets billing-only access. */
export function refreshIdentityToken(
	token: JWT,
	current: SessionIdentity | undefined,
	freshSignIn: boolean,
) {
	if (!current || (current.frozenAt && !current.emailVerified)) return null;
	if (!freshSignIn) {
		if (
			token.sub !== current.id ||
			(token['sessionVersion'] ?? 0) !== current.sessionVersion
		)
			return null;
		// Never convert a formerly active session into a frozen billing identity,
		// or silently upgrade a billing-only identity after an unfreeze.
		if (Boolean(current.frozenAt) !== (token['access'] === 'billing_only'))
			return null;
	}
	return {
		...token,
		sub: current.id,
		...(freshSignIn ?
			{
				sessionVersion: current.sessionVersion,
				authenticatedAt: Date.now(),
			}
		:	{}),
		access: current.frozenAt ? 'billing_only' : 'active',
		// A restricted identity must not even advertise administrator privileges.
		role: current.frozenAt ? 'member' : current.role,
	};
}

/** Public personalization and ordinary protected APIs only receive active identities. */
export function activeSession(session: Session | null) {
	return session?.access === 'billing_only' ? null : session;
}

export function sessionContexts(session: Session | null) {
	return { session: activeSession(session), billingSession: session };
}
