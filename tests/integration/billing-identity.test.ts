/** Real isolated authorization; community fixtures roll back and synthetic identities retire. No provider calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { TRPCError } from '@trpc/server';
import { db } from '../../src/server/db/index.ts';
import {
	users,
	asks,
	askContributions,
	savedAsks,
} from '../../src/server/db/schema.ts';
import { billingRouter } from '../../src/server/api/routers/billing.ts';
import { userRouter } from '../../src/server/api/routers/user.ts';
import { askRouter } from '../../src/server/api/routers/ask.ts';
import { securityRouter } from '../../src/server/api/routers/security.ts';
import {
	requireBillingIdentity,
	assertAdmin,
} from '../../src/server/security/authorization.ts';
import {
	sessionContexts,
	refreshIdentityToken,
} from '../../src/server/auth/session-policy.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const actorId = randomUUID();
const otherId = randomUUID();
const fixtureName = `CI billing identity ${randomUUID()}`;
let ready = false;
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	await db.insert(users).values(
		[actorId, otherId].map((id) => ({
			id,
			name: fixtureName,
			email: `${id}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
			sessionVersion: 7,
			frozenAt: id === actorId ? new Date() : null,
			role: id === actorId ? ('admin' as const) : ('member' as const),
		})),
	);
	ready = true;
});
after(async () => {
	try {
		if (ready)
			await db.transaction(async (tx) => {
				for (const id of [actorId, otherId]) {
					const user = await tx.query.users.findFirst({
						where: eq(users.id, id),
					});
					assert.ok(
						user?.isSynthetic &&
							user.name === fixtureName &&
							user.email === `${id}@example.invalid`,
					);
					await tx
						.update(users)
						.set({
							frozenAt: new Date(),
							sessionVersion: sql`${users.sessionVersion} + 1`,
						})
						.where(eq(users.id, id));
				}
			});
	} finally {
		await db.$client.end();
	}
});
const unauthorized = (error: unknown) =>
	error instanceof TRPCError && error.code === 'UNAUTHORIZED';
async function fixture(
	check: (
		tx: Transaction,
		identity: Session,
		otherId: string,
		askId: number,
	) => Promise<void>,
) {
	const rollback = new Error('Rollback exact billing identity fixture');
	await assert.rejects(
		db.transaction(async (tx) => {
			const [ask] = await tx
				.insert(asks)
				.values({
					slug: `ci-billing-identity-${actorId}`,
					title: 'CI privacy fixture',
					description: 'Rollback-only private coordination test',
					createdById: actorId,
					difficulty: 1,
					estimatedMinutesToComplete: 1,
				})
				.returning({ id: asks.id });
			await tx.insert(askContributions).values({
				askId: ask!.id,
				contributorId: actorId,
				amount: 1,
				status: 'pledged',
				note: 'Private coordination must not leak to billing-only sessions.',
			});
			await tx
				.insert(savedAsks)
				.values({ askId: ask!.id, userId: actorId });
			const identity: Session = {
				access: 'billing_only',
				expires: new Date(Date.now() + 60_000).toISOString(),
				user: {
					id: actorId,
					role: 'member',
					sessionVersion: 7,
					authenticatedAt: Date.now(),
				},
			};
			await check(tx, identity, otherId, ask!.id);
			throw rollback;
		}),
		(error: unknown) => error === rollback,
	);
}
const context = (tx: Transaction, identity: Session) => ({
	db: tx,
	headers: new Headers(),
	...sessionContexts(identity),
});

test('verified billing-only identity reaches own billing reads but not ordinary/admin/payment APIs', () =>
	fixture(async (tx, identity) => {
		const ctx = context(tx, identity);
		const billing = billingRouter.createCaller(ctx);
		assert.deepEqual(await billing.mySubscriptions(), []);
		assert.deepEqual(await billing.listSupporterChanges(), []);
		assert.equal((await billing.myOverview()).completedContributions, 0);
		await assert.rejects(
			billing.payment({ id: randomUUID() }),
			unauthorized,
		);
		await assert.rejects(billing.myPayments(), unauthorized);
		await assert.rejects(billing.myRecipient(), unauthorized);
		await assert.rejects(billing.createPortal(), unauthorized);
		await assert.rejects(billing.createRecipientSession(), unauthorized);
		await assert.rejects(billing.adminOperations(), unauthorized);
		await assert.rejects(
			securityRouter.createCaller(ctx).me(),
			unauthorized,
		);
		await assert.rejects(
			userRouter
				.createCaller(ctx)
				.updateProfile({ name: 'Blocked edit', bio: '', location: '' }),
			unauthorized,
		);
	}));
test('public caller personalization hides saved state, private notes, and owner-only profile history', () =>
	fixture(async (tx, identity, __otherId, askId) => {
		// The production context is already sanitized. Public middleware also defends
		// internal callers that accidentally supply the raw restricted identity.
		const ctx = {
			db: tx,
			headers: new Headers(),
			session: identity,
			billingSession: identity,
		};
		const profile = await userRouter
			.createCaller(ctx)
			.getProfile({ id: identity.user.id });
		assert.equal(profile.isOwner, false);
		assert.equal(profile.history.length, 0);
		assert.equal('pledged' in profile.stats, false);
		assert.equal('ownSupporterTier' in profile, false);
		const ask = await askRouter.createCaller(ctx).getAsk({ id: askId });
		assert.equal(ask.contributions[0]?.note, null);
		await assert.rejects(
			askRouter.createCaller(ctx).getAsks({ savedOnly: true }),
			unauthorized,
		);
		const rows = await askRouter
			.createCaller(ctx)
			.getAsks({ filter: { createdById: identity.user.id } });
		assert.equal(rows.find((row) => row.id === askId)?.saved, false);
	}));
test('fresh billing identity cannot query or confirm an unrelated operation', () =>
	fixture(async (tx, identity) => {
		const billing = billingRouter.createCaller(context(tx, identity));
		const missing = { operationId: randomUUID() };
		const denied = (error: unknown) =>
			error instanceof TRPCError &&
			['NOT_FOUND', 'FORBIDDEN'].includes(error.code);
		// Authentication never manufactures ownership of an arbitrary operation ID.
		await assert.rejects(billing.supporterChangeStatus(missing), denied);
		await assert.rejects(billing.confirmSupporterChange(missing), denied);
	}));
test('current DB version, verification and exact frozen scope are mandatory on every billing request', () =>
	fixture(async (tx, identity, otherId) => {
		const id = identity.user.id;
		await requireBillingIdentity(id, 7, 'billing_only', tx);
		await assert.rejects(
			requireBillingIdentity(id, 7, 'active', tx),
			unauthorized,
		);
		await assert.rejects(
			requireBillingIdentity(otherId, 7, 'billing_only', tx),
			unauthorized,
		);
		await tx
			.update(users)
			.set({ sessionVersion: sql`${users.sessionVersion} + 1` })
			.where(eq(users.id, id));
		await assert.rejects(
			billingRouter.createCaller(context(tx, identity)).myOverview(),
			unauthorized,
		);
		const current = await tx.query.users.findFirst({
			where: eq(users.id, id),
		});
		assert.equal(
			refreshIdentityToken(
				{ sub: id, sessionVersion: 7, access: 'billing_only' },
				current,
				false,
			),
			null,
		);
		assert.equal(
			refreshIdentityToken({}, current, true)?.access,
			'billing_only',
		);
		await tx
			.update(users)
			.set({ emailVerified: null })
			.where(eq(users.id, id));
		await assert.rejects(
			requireBillingIdentity(id, 8, 'billing_only', tx),
			unauthorized,
		);
	}));
test('active verified member retains ordinary protected access; frozen role never grants admin authority', () =>
	fixture(async (tx, identity, otherId) => {
		const active: Session = {
			...identity,
			access: 'active',
			user: { ...identity.user, id: otherId },
		};
		assert.equal(
			(await securityRouter.createCaller(context(tx, active)).me()).role,
			'member',
		);
		await requireBillingIdentity(otherId, 7, 'active', tx);
		// The regular protected middleware also rejects a raw restricted context,
		// not just the sanitized production context.
		await assert.rejects(
			securityRouter
				.createCaller({
					db: tx,
					headers: new Headers(),
					session: identity,
				})
				.me(),
			unauthorized,
		);
		await assert.rejects(assertAdmin(identity.user.id), unauthorized);
	}));
