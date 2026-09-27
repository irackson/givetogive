/** Real separate-transaction CI races. No Stripe calls or real payment claims. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import { operationEvents } from '../../src/server/db/operations-schema.ts';
import {
	paymentAskSettings,
	payments,
} from '../../src/server/db/payments-schema.ts';
import {
	recordAskPaymentPause,
	listPaymentAsks,
} from '../../src/server/payments/controls.ts';
import {
	fundingTotals,
	lockAskCapacity,
} from '../../src/server/payments/checkout.ts';
import { recordEvent } from '../../src/server/observability/events.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';
import type { PaymentTransaction } from '../../src/server/payments/ledger.ts';

const fixtureId = randomUUID();
const administrators = [randomUUID(), randomUUID()] as const;
const donorId = randomUUID();
const actorIds = [...administrators, donorId];
const askIds: number[] = [];
let ready = false;

before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	await db.transaction(async (tx) => {
		await tx.insert(users).values(
			actorIds.map((id, index) => ({
				id,
				name: `CI control race ${fixtureId}`,
				email: `${id}@example.invalid`,
				emailVerified: new Date(),
				isSynthetic: true,
				role: index < 2 ? ('admin' as const) : ('member' as const),
			})),
		);
		for (let i = 0; i < 3; i++) {
			const [ask] = await tx
				.insert(asks)
				.values({
					createdById: administrators[0],
					title: `CI control race ${fixtureId} ${i}`,
					slug: `ci-control-race-${fixtureId}-${i}`,
					description:
						'Synthetic isolated CI concurrency fixture. No real funds or Stripe session.',
					type: 'money',
					currency: 'USD',
					goalAmount: 2000,
					difficulty: 1,
					estimatedMinutesToComplete: 1,
				})
				.returning({ id: asks.id });
			askIds.push(ask!.id);
			await tx
				.insert(paymentAskSettings)
				.values({ askId: ask!.id, goalAmount: 2000 });
		}
	});
	ready = true;
});

after(async () => {
	try {
		if (ready) {
			await verifyIsolatedTarget(
				db.$client,
				isolatedConfiguration(process.env, 'test'),
			);
			await db.transaction(async (tx) => {
				const owned = await tx
					.select()
					.from(users)
					.where(inArray(users.id, actorIds));
				assert.equal(owned.length, actorIds.length);
				assert.ok(
					owned.every(
						(user) =>
							user.isSynthetic &&
							user.name === `CI control race ${fixtureId}`,
					),
				);
				const reservations = await tx
					.select()
					.from(payments)
					.where(inArray(payments.askId, askIds));
				assert.ok(
					reservations.every(
						(payment) =>
							payment.actorId === donorId &&
							!payment.livemode &&
							!payment.checkoutId &&
							!payment.paymentIntentId &&
							payment.requestHash ===
								`ci-control-race:${fixtureId}`,
					),
				);
				// These are explicitly synthetic, never-sent reservations; preserve them as expired evidence.
				if (reservations.length)
					await tx
						.update(payments)
						.set({ status: 'expired', expiresAt: new Date() })
						.where(
							inArray(
								payments.id,
								reservations.map((payment) => payment.id),
							),
						);
				await tx
					.update(users)
					.set({
						frozenAt: new Date(),
						sessionVersion: sql`${users.sessionVersion} + 1`,
					})
					.where(inArray(users.id, actorIds));
				await recordEvent(
					{
						externalId: `ci-control-race-retired:${fixtureId}`,
						actorId: administrators[0],
						entityType: 'ci_fixture',
						entityId: fixtureId,
						action: 'ci_control_race_retired',
						outcome: 'completed',
						summary:
							'Exact synthetic actors frozen and unsent reservations expired; immutable race audits retained.',
						details: {
							askCount: askIds.length,
							actorCount: actorIds.length,
						},
					},
					tx,
				);
			});
		}
	} finally {
		await db.$client.end();
	}
});

function rendezvous(participants: number) {
	let arrived = 0;
	let release: () => void;
	let timer: ReturnType<typeof setTimeout>;
	const gate = new Promise<void>((resolve, reject) => {
		release = resolve;
		timer = setTimeout(
			() =>
				reject(
					new Error('CI transaction rendezvous deadline exceeded.'),
				),
			8000,
		);
		timer.unref();
	});
	return async () => {
		if (++arrived === participants) {
			clearTimeout(timer);
			release();
		}
		await gate;
	};
}
async function prepareTransaction(
	tx: PaymentTransaction,
	backendIds: Set<number>,
) {
	await tx.execute(sql`set local lock_timeout = '8s'`);
	await tx.execute(sql`set local statement_timeout = '12s'`);
	const [backend] = await tx.execute<{ pid: number }>(
		sql`select pg_backend_pid() as pid`,
	);
	backendIds.add(backend!.pid);
}
function input(askId: number, expectedRevision = 0, paused = true) {
	return {
		askId,
		operationId: randomUUID(),
		paused,
		expectedPaused: !paused,
		expectedRevision,
		reason: 'Reviewed synthetic concurrency control; do not apply to real payments.',
	};
}
async function audits(askId: number) {
	return db
		.select()
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.environment, 'test'),
				eq(operationEvents.entityType, 'ask'),
				eq(operationEvents.entityId, String(askId)),
				inArray(operationEvents.action, [
					'ask_payments_paused',
					'ask_payments_resumed',
				]),
			),
		)
		.orderBy(operationEvents.id);
}

test(
	'independent administrators contending on one observed revision commit exactly one effect/audit; retries remain stable',
	{ timeout: 25000 },
	async () => {
		const askId = askIds[0]!;
		const initialList = await listPaymentAsks(administrators[0], {
			query: fixtureId,
			limit: 25,
		});
		const initialRevision = initialList.items.find(
			(ask) => ask.id === askId,
		)?.revision;
		assert.equal(typeof initialRevision, 'number');
		assert.equal(initialRevision, 0);
		const requests = [input(askId), input(askId)];
		const wait = rendezvous(2);
		const backends = new Set<number>();
		const results = await Promise.allSettled(
			requests.map((request, index) =>
				db.transaction(async (tx) => {
					await prepareTransaction(tx, backends);
					await wait();
					return recordAskPaymentPause(
						tx,
						administrators[index]!,
						request,
					);
				}),
			),
		);
		assert.equal(
			backends.size,
			2,
			'Each contender must use a separate real Postgres transaction/connection.',
		);
		const winnerIndex = results.findIndex(
			(result) => result.status === 'fulfilled',
		);
		assert.ok(winnerIndex >= 0);
		assert.equal(
			results.filter((result) => result.status === 'fulfilled').length,
			1,
		);
		const loser = results[1 - winnerIndex]!;
		assert.equal(loser.status, 'rejected');
		if (loser.status === 'rejected')
			assert.ok(
				loser.reason instanceof TRPCError &&
					loser.reason.code === 'CONFLICT',
			);
		const winner = results[winnerIndex]!;
		assert.equal(winner.status, 'fulfilled');
		if (winner.status !== 'fulfilled')
			throw new Error('Missing admitted operation.');
		const history = await audits(askId);
		assert.equal(history.length, 1);
		assert.equal(history[0]!.id, winner.value.eventId);
		assert.equal(history[0]!.details['expectedRevision'], 0);
		const retryWait = rendezvous(2);
		const retryBackends = new Set<number>();
		const retries = await Promise.all(
			Array.from({ length: 2 }, () =>
				db.transaction(async (tx) => {
					await prepareTransaction(tx, retryBackends);
					await retryWait();
					return recordAskPaymentPause(
						tx,
						administrators[winnerIndex]!,
						requests[winnerIndex]!,
					);
				}),
			),
		);
		assert.equal(retryBackends.size, 2);
		assert.ok(
			retries.every(
				(result) =>
					result.eventId === winner.value.eventId && result.paused,
			),
		);
		assert.equal((await audits(askId)).length, 1);
		await assert.rejects(
			db.transaction((tx) =>
				recordAskPaymentPause(
					tx,
					administrators[1 - winnerIndex]!,
					requests[1 - winnerIndex]!,
				),
			),
			(error) => error instanceof TRPCError && error.code === 'CONFLICT',
		);
		const listed = await listPaymentAsks(administrators[0], {
			query: fixtureId,
			limit: 25,
		});
		assert.equal(
			typeof listed.items.find((ask) => ask.id === askId)?.revision,
			'number',
		);
		assert.equal(
			listed.items.find((ask) => ask.id === askId)?.revision,
			winner.value.eventId,
		);
	},
);

async function insertReservation(tx: PaymentTransaction, askId: number) {
	await lockAskCapacity(tx, askId, 891);
	await tx.insert(payments).values({
		id: randomUUID(),
		actorId: donorId,
		askId,
		kind: 'ask',
		livemode: false,
		requestHash: `ci-control-race:${fixtureId}`,
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
	});
}

test(
	'a reservation committed before the contending pause is preserved, but no later reservation enters',
	{ timeout: 25000 },
	async () => {
		const askId = askIds[1]!;
		const wait = rendezvous(2);
		const backends = new Set<number>();
		const reservation = db.transaction(async (tx) => {
			await prepareTransaction(tx, backends);
			await insertReservation(tx, askId); // Own the same Ask lock before releasing the other transaction.
			await wait();
		});
		const pause = db.transaction(async (tx) => {
			await prepareTransaction(tx, backends);
			await wait();
			return recordAskPaymentPause(tx, administrators[0], input(askId));
		});
		await Promise.all([reservation, pause]);
		assert.equal(backends.size, 2);
		assert.deepEqual(await fundingTotals(db, askId), {
			paidAmount: 0,
			pendingAmount: 891,
		});
		assert.equal((await audits(askId)).length, 1);
		await assert.rejects(
			db.transaction((tx) => insertReservation(tx, askId)),
			/not accepting/,
		);
		assert.deepEqual(await fundingTotals(db, askId), {
			paidAmount: 0,
			pendingAmount: 891,
		});
	},
);

test(
	'a pause committed ahead of a waiting reservation prevents that reservation from being inserted',
	{ timeout: 25000 },
	async () => {
		const askId = askIds[2]!;
		const wait = rendezvous(2);
		const backends = new Set<number>();
		const pause = db.transaction(async (tx) => {
			await prepareTransaction(tx, backends);
			const result = await recordAskPaymentPause(
				tx,
				administrators[0],
				input(askId),
			);
			await wait();
			return result;
		});
		const reservation = db.transaction(async (tx) => {
			await prepareTransaction(tx, backends);
			await wait();
			return insertReservation(tx, askId);
		});
		const [paused, reserved] = await Promise.allSettled([
			pause,
			reservation,
		]);
		assert.equal(backends.size, 2);
		assert.equal(paused.status, 'fulfilled');
		assert.equal(reserved.status, 'rejected');
		if (reserved.status === 'rejected')
			assert.ok(
				reserved.reason instanceof TRPCError &&
					reserved.reason.code === 'PRECONDITION_FAILED',
			);
		assert.deepEqual(await fundingTotals(db, askId), {
			paidAmount: 0,
			pendingAmount: 0,
		});
		assert.equal((await audits(askId)).length, 1);
	},
);
