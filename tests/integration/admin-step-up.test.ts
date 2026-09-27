/** Production guard semantics against disposable users in the explicitly isolated CI database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { TRPCError } from '@trpc/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import { assertFinancialAdmin } from '../../src/server/security/authorization.ts';
import { sealSecret } from '../../src/server/security/crypto.ts';

const originalEnvironment = process.env['APP_ENV'];
const adminId = randomUUID();
const otherAdminId = randomUUID();
const memberId = randomUUID();
const unverifiedId = randomUUID();
const frozenId = randomUUID();
const fixtureIds = [adminId, otherAdminId, memberId, unverifiedId, frozenId];
const sessionVersion = 7;
let ready = false;

before(async () => {
	assert.equal(originalEnvironment, 'test');
	assert.equal(new URL(process.env['DATABASE_URL']!).pathname, '/givetogive_ci_20260926');
	const target = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(target[0]?.name, 'givetogive_ci_20260926');
	assert.equal(target[0]?.role, 'givetogive_ci_20260926');
	await db.insert(users).values(fixtureIds.map((id) => ({
		id,
		name: 'CI admin step-up fixture',
		email: `${id}@example.invalid`,
		role: id === memberId ? 'member' as const : 'admin' as const,
		emailVerified: id === unverifiedId ? null : new Date(),
		frozenAt: id === frozenId ? new Date() : null,
		sessionVersion,
		isSynthetic: true,
	})));
	ready = true;
});

function restoreEnvironment() {
	if (originalEnvironment === undefined) delete process.env['APP_ENV'];
	else process.env['APP_ENV'] = originalEnvironment;
}

after(async () => {
	restoreEnvironment();
	try {
		if (ready) await db.delete(users).where(inArray(users.id, fixtureIds));
	} finally {
		await db.$client.end();
	}
});

async function inProduction(check: () => Promise<void>) {
	// Only the application policy changes. The established CI connection never does.
	process.env['APP_ENV'] = 'production';
	try {
		await check();
	} finally {
		restoreEnvironment();
	}
}

function elevation(overrides: Record<string, unknown> = {}, purpose = 'admin-elevation') {
	return sealSecret(JSON.stringify({
		userId: adminId,
		expiresAt: Date.now() + 5 * 60_000,
		sessionVersion,
		...overrides,
	}), purpose);
}

function denied(error: unknown) {
	return error instanceof TRPCError && (error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED');
}

test('production financial actions require an elevation token', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(adminId), denied);
}));

test('an encrypted five-minute elevation for the current admin and session is accepted', () => inProduction(async () => {
	await assert.doesNotReject(() => assertFinancialAdmin(adminId, elevation()));
}));

test('expired elevation is rejected', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(adminId, elevation({ expiresAt: Date.now() - 1 })), denied);
}));

test('another admin cannot reuse the elevation', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(otherAdminId, elevation()), denied);
}));

test('a token for a different session version is rejected', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(adminId, elevation({ sessionVersion: sessionVersion - 1 })), denied);
}));

test('revoking sessions invalidates an already issued elevation', () => inProduction(async () => {
	const token = elevation();
	await db.update(users).set({ sessionVersion: sessionVersion + 1 }).where(eq(users.id, adminId));
	try {
		await assert.rejects(() => assertFinancialAdmin(adminId, token), denied);
	} finally {
		await db.update(users).set({ sessionVersion }).where(eq(users.id, adminId));
	}
}));

test('tokens authenticated for another purpose are rejected', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(adminId, elevation({}, 'not-admin-elevation')), denied);
}));

test('malformed or modified ciphertext is rejected', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(adminId, 'invalid'), denied);
	const parts = elevation().split('.');
	const ciphertext = Buffer.from(parts[2]!, 'base64url');
	ciphertext[0] = ciphertext[0]! ^ 1;
	parts[2] = ciphertext.toString('base64url');
	await assert.rejects(() => assertFinancialAdmin(adminId, parts.join('.')), denied);
}));

test('verified members cannot elevate into administrators', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(memberId, elevation({ userId: memberId })), denied);
}));

test('unverified administrators cannot authorize financial actions', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(unverifiedId, elevation({ userId: unverifiedId })), denied);
}));

test('frozen administrators cannot authorize financial actions', () => inProduction(async () => {
	await assert.rejects(() => assertFinancialAdmin(frozenId, elevation({ userId: frozenId })), denied);
}));

test('a nonexistent principal cannot authorize financial actions', () => inProduction(async () => {
	const missingId = randomUUID();
	await assert.rejects(() => assertFinancialAdmin(missingId, elevation({ userId: missingId })), denied);
}));
