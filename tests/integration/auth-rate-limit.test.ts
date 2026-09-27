import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { authRateLimits } from '../../src/server/db/schema.ts';
import {
	clearRateLimit,
	isRateLimited,
	recordRateLimitAttempt,
} from '../../src/server/auth/rate-limit.ts';

const headers = new Headers({ 'x-forwarded-for': '192.0.2.10' });
before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	assert.equal(
		new URL(process.env['DATABASE_URL'] ?? '').pathname,
		'/givetogive_ci_20260926',
	);
	const [identity] = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
});
after(async () => {
	await db.$client.end();
});

test('concurrent sign-ins consume exactly the allowed attempts atomically', async () => {
	const identifier = `${randomUUID()}@example.invalid`;
	try {
		const results = await Promise.all(
			Array.from({ length: 30 }, () =>
				recordRateLimitAttempt('ci-sign-in', identifier, headers, 11),
			),
		);
		assert.equal(results.filter(Boolean).length, 10);
		assert.equal(
			await isRateLimited('ci-sign-in', identifier, headers),
			true,
		);
		assert.equal(
			await recordRateLimitAttempt('ci-sign-in', identifier, headers, 11),
			false,
		);
		assert.equal(
			await recordRateLimitAttempt(
				'ci-other-scope',
				identifier,
				headers,
				11,
			),
			true,
		);
	} finally {
		await clearRateLimit('ci-sign-in', identifier, headers);
		await clearRateLimit('ci-other-scope', identifier, headers);
	}
});

test('expired windows reset atomically and active blocks do not reset early', async () => {
	const identifier = `${randomUUID()}@example.invalid`;
	try {
		await recordRateLimitAttempt('ci-expiry', identifier, headers, 3);
		const { createHash } = await import('node:crypto');
		const key = createHash('sha256')
			.update(`ci-expiry:${identifier}:192.0.2.10`)
			.digest('hex');
		await db
			.update(authRateLimits)
			.set({
				windowStartedAt: new Date(Date.now() - 20 * 60_000),
				blockedUntil: new Date(Date.now() + 60_000),
				attempts: 3,
			})
			.where(eq(authRateLimits.key, key));
		assert.equal(
			await recordRateLimitAttempt('ci-expiry', identifier, headers, 3),
			false,
		);
		await db
			.update(authRateLimits)
			.set({ blockedUntil: new Date(Date.now() - 1_000) })
			.where(eq(authRateLimits.key, key));
		assert.equal(
			await recordRateLimitAttempt('ci-expiry', identifier, headers, 3),
			true,
		);
		const [record] = await db
			.select()
			.from(authRateLimits)
			.where(eq(authRateLimits.key, key));
		assert.equal(record?.attempts, 1);
		assert.equal(record?.blockedUntil, null);
	} finally {
		await clearRateLimit('ci-expiry', identifier, headers);
	}
});
