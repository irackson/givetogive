/** Adversarial real-Postgres tests. Synthetic reservations only, never provider-payment claims. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import {
	paymentAskSettings,
	payments,
} from '../../src/server/db/payments-schema.ts';
import {
	fundingTotals,
	lockAskCapacity,
	updateFundingStatus,
} from '../../src/server/payments/checkout.ts';
import { syncPaymentAskGoal } from '../../src/server/payments/ask-funding.ts';
import { askRouter } from '../../src/server/api/routers/ask.ts';

const ownerId = randomUUID();
const donors = Array.from({ length: 6 }, () => randomUUID());
let askId: number;
let ready = false;
const rollback = new Error('Intentional CI rollback');
before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	assert.equal(
		new URL(process.env['DATABASE_URL']!).pathname,
		'/givetogive_ci_20260926',
	);
	const target = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(target[0]?.name, 'givetogive_ci_20260926');
	assert.equal(target[0]?.role, 'givetogive_ci_20260926');
	await db.transaction(async (tx) => {
		await tx.insert(users).values(
			[ownerId, ...donors].map((id) => ({
				id,
				name: 'CI payment race fixture',
				email: `${id}@example.invalid`,
				emailVerified: new Date(),
				isSynthetic: true,
			})),
		);
		const [ask] = await tx
			.insert(asks)
			.values({
				createdById: ownerId,
				title: 'CI payment race',
				slug: `ci-payment-race-${randomUUID()}`,
				description: 'Disposable isolated CI fixture',
				type: 'money',
				currency: 'USD',
				goalAmount: 2000,
				difficulty: 1,
				estimatedMinutesToComplete: 1,
			})
			.returning();
		askId = ask!.id;
		await tx.insert(paymentAskSettings).values({ askId, goalAmount: 2000 });
	});
	ready = true;
});
after(async () => {
	try {
		if (ready)
			await db.transaction(async (tx) => {
				await tx.delete(payments).where(eq(payments.askId, askId));
				await tx
					.delete(paymentAskSettings)
					.where(eq(paymentAskSettings.askId, askId));
				await tx.delete(asks).where(eq(asks.id, askId));
				await tx
					.delete(users)
					.where(inArray(users.id, [ownerId, ...donors]));
			});
	} finally {
		await db.$client.end();
	}
});

async function reserve(donor: string) {
	return db.transaction(async (tx) => {
		await lockAskCapacity(tx, askId, 891);
		const [payment] = await tx
			.insert(payments)
			.values({
				id: randomUUID(),
				actorId: donor,
				kind: 'ask',
				askId,
				livemode: false,
				requestHash: 'CI-only-reservation',
				grossAmount: 1000,
				platformFee: 50,
				processingEstimate: 59,
				recipientAmount: 891,
				feeSnapshot: {
					version: 'ci',
					platformBps: 500,
					processingBps: 290,
					processingFixed: 30,
				},
				expiresAt: new Date(Date.now() + 60000),
			})
			.returning();
		await updateFundingStatus(tx, askId);
		return payment!;
	});
}

test('six simultaneous donors cannot oversubscribe one Ask', async () => {
	const results = await Promise.allSettled(donors.map(reserve));
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
	for (const result of results)
		if (result.status === 'rejected')
			assert.match(String(result.reason), /remaining unreserved goal/);
	assert.deepEqual(await fundingTotals(db, askId), {
		paidAmount: 0,
		pendingAmount: 1782,
	});
});

test('goal reduction racing a new reservation preserves the paid-plus-pending capacity invariant', async () => {
	await db.delete(payments).where(eq(payments.askId, askId));
	await db.transaction(async (tx) => {
		await tx.select().from(asks).where(eq(asks.id, askId)).for('update');
		await syncPaymentAskGoal(tx, askId, 2000);
	});
	const results = await Promise.allSettled([
		reserve(donors[0]!),
		reserve(donors[1]!),
		db.transaction(async (tx) => {
			await tx
				.select()
				.from(asks)
				.where(eq(asks.id, askId))
				.for('update');
			await syncPaymentAskGoal(tx, askId, 900);
		}),
	]);
	assert.ok(results.some((r) => r.status === 'rejected'));
	const [ask] = await db.select().from(asks).where(eq(asks.id, askId));
	const [settings] = await db
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	const progress = await fundingTotals(db, askId);
	assert.equal(ask?.goalAmount, settings?.goalAmount);
	assert.ok(
		progress.paidAmount + progress.pendingAmount <= settings!.goalAmount,
	);
});

test('actual Ask API rejects manual payment pledges, forged currency/type edits, and outsider edits', async () => {
	await assert.rejects(
		db.transaction(async (tx) => {
			const caller = (id: string) =>
				askRouter.createCaller({
					db: tx,
					headers: new Headers(),
					session: {
						user: {
							id,
							role: 'member',
							sessionVersion: 0,
							authenticatedAt: Date.now(),
						},
						expires: new Date(Date.now() + 60000).toISOString(),
					},
				});
			await assert.rejects(
				caller(donors[0]!).createContribution({ askId, amount: 1 }),
				/verified payments/,
			);
			await assert.rejects(
				caller(donors[0]!).updateAsk({ askId, title: 'Outsider edit' }),
				/Only the Ask owner/,
			);
			// Raw API JSON must reject forbidden keys, not silently accept a mixed edit.
			await assert.rejects(
				caller(ownerId).updateAsk({
					askId,
					title: 'Forged type',
					type: 'task',
				} as Parameters<ReturnType<typeof caller>['updateAsk']>[0]),
				/Unrecognized key/,
			);
			await assert.rejects(
				caller(ownerId).updateAsk({
					askId,
					title: 'Forged currency',
					currency: 'EUR',
				} as Parameters<ReturnType<typeof caller>['updateAsk']>[0]),
				/Unrecognized key/,
			);
			const detail = await caller(ownerId).getAsk({ id: askId });
			assert.equal(detail.paymentEnabled, true);
			assert.equal(detail.contributedAmount, 0);
			assert.ok(detail.pendingFundingAmount > 0);
			const index = await caller(ownerId).getAsks({
				filter: { createdById: ownerId },
			});
			assert.equal(index[0]?.paymentEnabled, true);
			assert.equal(index[0]?.contributedAmount, 0);
			await caller(ownerId).updateAsk({ askId, goalAmount: 50 });
			const [settings] = await tx
				.select()
				.from(paymentAskSettings)
				.where(eq(paymentAskSettings.askId, askId));
			assert.equal(settings?.goalAmount, 5000);
			throw rollback;
		}),
		(error) => error === rollback,
	);
});
