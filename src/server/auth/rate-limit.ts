import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/server/db';
import { authRateLimits } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function createRateLimitKey(
	scope: string,
	identifier: string,
	headers: Headers,
) {
	const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	const address = forwardedFor ?? headers.get('x-real-ip') ?? 'local';
	return createHash('sha256')
		.update(`${scope}:${identifier.trim().toLowerCase()}:${address}`)
		.digest('hex');
}

export async function isRateLimited(
	scope: string,
	identifier: string,
	headers: Headers,
) {
	const key = createRateLimitKey(scope, identifier, headers);
	const [record] = await db
		.select()
		.from(authRateLimits)
		.where(eq(authRateLimits.key, key))
		.limit(1);

	return Boolean(record?.blockedUntil && record.blockedUntil > new Date());
}

export async function recordRateLimitAttempt(
	scope: string,
	identifier: string,
	headers: Headers,
	limit = 5,
) {
	const key = createRateLimitKey(scope, identifier, headers);
	const now = new Date();
	const [existing] = await db
		.select()
		.from(authRateLimits)
		.where(eq(authRateLimits.key, key))
		.limit(1);

	if (existing?.blockedUntil && existing.blockedUntil > now) return false;

	const isNewWindow =
		!existing ||
		now.getTime() - existing.windowStartedAt.getTime() >= WINDOW_MS;
	const attempts = isNewWindow ? 1 : existing.attempts + 1;
	const blockedUntil =
		attempts >= limit ? new Date(now.getTime() + BLOCK_MS) : null;

	await db
		.insert(authRateLimits)
		.values({
			key,
			attempts,
			windowStartedAt: isNewWindow ? now : existing.windowStartedAt,
			blockedUntil,
		})
		.onConflictDoUpdate({
			target: authRateLimits.key,
			set: {
				attempts,
				windowStartedAt: isNewWindow ? now : existing.windowStartedAt,
				blockedUntil,
			},
		});

	return attempts < limit;
}

export async function clearRateLimit(
	scope: string,
	identifier: string,
	headers: Headers,
) {
	const key = createRateLimitKey(scope, identifier, headers);
	await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}
