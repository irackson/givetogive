/** Real isolated SQL/router regressions; not mailbox or hosted-browser acceptance. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';
import { db } from '../../src/server/db/index.ts';
import { authTokens, users } from '../../src/server/db/schema.ts';
import {
	createAuthToken,
	hashAuthToken,
} from '../../src/server/auth/tokens.ts';
import { userRouter } from '../../src/server/api/routers/user.ts';

const ids: string[] = [];
let ready = false;
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	ready = true;
});
after(async () => {
	try {
		if (ready && ids.length)
			await db.delete(users).where(inArray(users.id, ids));
	} finally {
		await db.$client.end();
	}
});
async function member() {
	const id = randomUUID();
	ids.push(id);
	await db
		.insert(users)
		.values({
			id,
			email: `auth-token-${id}@example.invalid`,
			name: 'Disposable CI auth-token fixture',
		});
	return id;
}
const caller = () =>
	userRouter.createCaller({ db, headers: new Headers(), session: null });
const invalid = (error: unknown) =>
	error instanceof TRPCError && error.code === 'BAD_REQUEST';

test('concurrent replacements leave exactly one active token per purpose', async () => {
	const id = await member();
	const attempts = await Promise.all(
		Array.from({ length: 12 }, () =>
			createAuthToken(id, 'email_verification'),
		),
	);
	const rows = await db
		.select()
		.from(authTokens)
		.where(eq(authTokens.userId, id));
	assert.equal(rows.length, 1);
	assert(
		attempts.some(
			(attempt) => hashAuthToken(attempt.token) === rows[0]!.tokenHash,
		),
	);
	const reset = await createAuthToken(id, 'password_reset');
	const both = await db
		.select()
		.from(authTokens)
		.where(eq(authTokens.userId, id));
	assert.equal(both.length, 2);
	assert(both.some((row) => row.tokenHash === hashAuthToken(reset.token)));
});

test('concurrent verification has one winner, and reuse cannot change verified time', async () => {
	const id = await member();
	const { token } = await createAuthToken(id, 'email_verification');
	const results = await Promise.allSettled([
		caller().verifyEmail({ token }),
		caller().verifyEmail({ token }),
	]);
	assert.equal(
		results.filter((result) => result.status === 'fulfilled').length,
		1,
	);
	const rejected = results.find((result) => result.status === 'rejected');
	assert(rejected?.status === 'rejected' && invalid(rejected.reason));
	const [verified] = await db.select().from(users).where(eq(users.id, id));
	assert(verified?.emailVerified);
	await assert.rejects(caller().verifyEmail({ token }), invalid);
	const [unchanged] = await db.select().from(users).where(eq(users.id, id));
	assert.equal(
		unchanged!.emailVerified!.getTime(),
		verified.emailVerified.getTime(),
	);
	assert.equal(
		(await db.select().from(authTokens).where(eq(authTokens.userId, id)))
			.length,
		0,
	);
});

test('expired and wrong-purpose fixtures never verify a member or consume another purpose', async () => {
	const id = await member();
	const expired = randomBytes(32).toString('base64url');
	// Only this disposable CI fixture has a constructed past expiration.
	// The real AgentMail natural-expiry fixture is never edited by these tests.
	await db
		.insert(authTokens)
		.values({
			userId: id,
			purpose: 'email_verification',
			tokenHash: hashAuthToken(expired),
			expiresAt: new Date(Date.now() - 60_000),
		});
	const reset = await createAuthToken(id, 'password_reset');
	await assert.rejects(caller().verifyEmail({ token: expired }), invalid);
	await assert.rejects(caller().verifyEmail({ token: reset.token }), invalid);
	const [unchanged] = await db.select().from(users).where(eq(users.id, id));
	assert.equal(unchanged!.emailVerified, null);
	assert.equal(
		(await db.select().from(authTokens).where(eq(authTokens.userId, id)))
			.length,
		2,
	);
});
