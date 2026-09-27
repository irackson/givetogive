import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/server/db';
import { authRateLimits } from '@/server/db/schema';
import { eq, sql } from 'drizzle-orm';

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
	// Raw SQL parameters bypass Drizzle's timestamp column encoder. postgres-js
	// needs serialized timestamps here, not JavaScript Date objects.
	const nowIso = now.toISOString();
	const expired = sql`${authRateLimits.windowStartedAt} <= ${new Date(now.getTime() - WINDOW_MS).toISOString()}::timestamptz`;
	const blocked = sql`${authRateLimits.blockedUntil} > ${nowIso}::timestamptz`;
	const nextAttempts = sql`case when ${blocked} then ${authRateLimits.attempts} when ${expired} then 1 else ${authRateLimits.attempts} + 1 end`;
	const [record] = await db
		.insert(authRateLimits)
		.values({
			key,
			attempts: 1,
			windowStartedAt: now,
			blockedUntil:
				limit <= 1 ? new Date(now.getTime() + BLOCK_MS) : null,
		})
		.onConflictDoUpdate({
			target: authRateLimits.key,
			set: {
				attempts: nextAttempts,
				windowStartedAt: sql`case when ${expired} and not coalesce(${blocked}, false) then ${nowIso}::timestamptz else ${authRateLimits.windowStartedAt} end`,
				blockedUntil: sql`case when ${blocked} then ${authRateLimits.blockedUntil} when ${nextAttempts} >= ${limit} then ${new Date(now.getTime() + BLOCK_MS).toISOString()}::timestamptz else null end`,
			},
		})
		.returning({
			attempts: authRateLimits.attempts,
			blockedUntil: authRateLimits.blockedUntil,
		});

	return Boolean(
		record &&
		record.attempts < limit &&
		(!record.blockedUntil || record.blockedUntil <= now),
	);
}

export async function clearRateLimit(
	scope: string,
	identifier: string,
	headers: Headers,
) {
	const key = createRateLimitKey(scope, identifier, headers);
	await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}
