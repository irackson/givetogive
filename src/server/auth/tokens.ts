import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { db } from '@/server/db';
import { authTokens } from '@/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export type AuthTokenPurpose = 'email_verification' | 'password_reset';

export function hashAuthToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

export async function createAuthToken(
	userId: string,
	purpose: AuthTokenPurpose,
) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(
		Date.now() +
			(purpose === 'email_verification' ? 24 * 60 : 30) * 60 * 1000,
	);

	await db.transaction(async (transaction) => {
		// Serialize even first issuance (there may be no token row to lock).
		// A purpose-scoped transaction lock avoids reversing verification's
		// token-then-user row lock order. It releases automatically on rollback.
		await transaction.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-token:${userId}:${purpose}`}, 0))`,
		);
		await transaction
			.delete(authTokens)
			.where(
				and(
					eq(authTokens.userId, userId),
					eq(authTokens.purpose, purpose),
				),
			);
		await transaction.insert(authTokens).values({
			userId,
			purpose,
			tokenHash: hashAuthToken(token),
			expiresAt,
		});
	});

	return { token, expiresAt };
}
