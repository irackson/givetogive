import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import { operationEvents } from '../../src/server/db/operations-schema.ts';
import {
	paymentAskSettings,
	paymentCases,
} from '../../src/server/db/payments-schema.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';
import { recordCaseReview } from '../../src/server/payments/cases.ts';
import { recordAskPaymentPause } from '../../src/server/payments/controls.ts';
import { lockAskCapacity } from '../../src/server/payments/checkout.ts';
import type { PaymentTransaction } from '../../src/server/payments/ledger.ts';

before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
});
after(async () => {
	await db.$client.end();
});
const rollback = new Error('Intentional isolated fixture rollback');
async function fixture(
	run: (
		tx: PaymentTransaction,
		adminId: string,
		caseId: string,
	) => Promise<void>,
) {
	await assert.rejects(
		db.transaction(async (tx) => {
			const adminId = randomUUID();
			await tx.insert(users).values({
				id: adminId,
				name: 'CI case reviewer',
				email: `${adminId}@example.invalid`,
				role: 'admin',
				emailVerified: new Date(),
				isSynthetic: true,
			});
			const [item] = await tx
				.insert(paymentCases)
				.values({
					key: `ci-case-${randomUUID()}`,
					category: 'financial_hold',
					summary: 'Synthetic unresolved financial case.',
				})
				.returning();
			await run(tx, adminId, item!.id);
			throw rollback;
		}),
		(error) => error === rollback,
	);
}

test('acknowledgement and escalation append sanitized history without resolving financial holds', async () => {
	await fixture(async (tx, adminId, caseId) => {
		await recordCaseReview(tx, adminId, {
			caseId,
			operationId: randomUUID(),
			decision: 'acknowledge',
			note: 'Reviewed provider status; awaiting authoritative reconciliation.',
		});
		await recordCaseReview(tx, adminId, {
			caseId,
			operationId: randomUUID(),
			decision: 'escalate',
			note: 'Escalated at https://private.invalid/path; secret sk_test_syntheticexamplevalue.',
		});
		const [item] = await tx
			.select()
			.from(paymentCases)
			.where(eq(paymentCases.id, caseId));
		assert.equal(item?.resolvedAt, null);
		const history = await tx
			.select()
			.from(operationEvents)
			.where(eq(operationEvents.entityId, caseId));
		assert.equal(history.length, 2);
		assert.ok(
			history.every(
				(event) => event.details['financialStatusChanged'] === false,
			),
		);
		assert.ok(
			history.every(
				(event) =>
					!event.summary?.includes('https://') &&
					!event.summary?.includes('sk_test_'),
			),
		);
	});
});

test('case review retries keep one event and conflicting operation reuse is rejected', async () => {
	await fixture(async (tx, adminId, caseId) => {
		const input = {
			caseId,
			operationId: randomUUID(),
			decision: 'acknowledge' as const,
			note: 'Reviewed and retained for provider reconciliation.',
		};
		const first = await recordCaseReview(tx, adminId, input);
		assert.deepEqual(await recordCaseReview(tx, adminId, input), first);
		await assert.rejects(
			recordCaseReview(tx, adminId, { ...input, decision: 'escalate' }),
			/already used/,
		);
		const history = await tx
			.select()
			.from(operationEvents)
			.where(eq(operationEvents.entityId, caseId));
		assert.equal(history.length, 1);
	});
});

test('inactive or nonadmin reviewers and forged financial-resolution decisions are rejected', async () => {
	await fixture(async (tx, adminId, caseId) => {
		const input = {
			caseId,
			operationId: randomUUID(),
			decision: 'acknowledge' as const,
			note: 'This must not bypass the reviewer authorization.',
		};
		await tx
			.update(users)
			.set({ role: 'member' })
			.where(eq(users.id, adminId));
		await assert.rejects(recordCaseReview(tx, adminId, input));
		await tx
			.update(users)
			.set({ role: 'admin', frozenAt: new Date() })
			.where(eq(users.id, adminId));
		await assert.rejects(recordCaseReview(tx, adminId, input));
		await tx
			.update(users)
			.set({ frozenAt: null, emailVerified: null })
			.where(eq(users.id, adminId));
		await assert.rejects(recordCaseReview(tx, adminId, input));
		await tx
			.update(users)
			.set({ emailVerified: new Date() })
			.where(eq(users.id, adminId));
		await assert.rejects(
			recordCaseReview(tx, adminId, {
				...input,
				decision: 'resolve' as 'acknowledge',
			}),
		);
		await assert.rejects(
			recordCaseReview(tx, adminId, { ...input, caseId: randomUUID() }),
		);
	});
});

test('audited Ask pause blocks new reservations, supports idempotent retry and refuses stale resumes', async () => {
	await fixture(async (tx, adminId) => {
		const [ask] = await tx
			.insert(asks)
			.values({
				createdById: adminId,
				title: 'CI operator pause',
				slug: `ci-pause-${randomUUID()}`,
				description: 'Rolled-back synthetic operator control fixture.',
				type: 'money',
				currency: 'USD',
				goalAmount: 10000,
				difficulty: 1,
				estimatedMinutesToComplete: 1,
			})
			.returning();
		await tx
			.insert(paymentAskSettings)
			.values({ askId: ask!.id, goalAmount: 10000 });
		await lockAskCapacity(tx, ask!.id, 100);
		const input = {
			askId: ask!.id,
			operationId: randomUUID(),
			paused: true,
			expectedPaused: false,
			expectedRevision: 0,
			reason: 'Pause new reservations while reviewing recipient readiness.',
		};
		const first = await recordAskPaymentPause(tx, adminId, input);
		assert.equal(first.paused, true);
		assert.deepEqual(
			await recordAskPaymentPause(tx, adminId, input),
			first,
		);
		await assert.rejects(
			lockAskCapacity(tx, ask!.id, 100),
			/not accepting/,
		);
		await assert.rejects(
			recordAskPaymentPause(tx, adminId, {
				...input,
				operationId: randomUUID(),
				paused: false,
				expectedPaused: false,
			}),
			/another administrator/,
		);
		const resumed = await recordAskPaymentPause(tx, adminId, {
			...input,
			operationId: randomUUID(),
			paused: false,
			expectedPaused: true,
			expectedRevision: first.eventId,
			reason: 'Recipient review completed; permit new reservations again.',
		});
		assert.equal(resumed.paused, false);
		await lockAskCapacity(tx, ask!.id, 100);
		// ABA regression: an older paused=true view must not clear a later hold.
		const nextPause = await recordAskPaymentPause(tx, adminId, {
			...input,
			operationId: randomUUID(),
			expectedRevision: resumed.eventId,
		});
		await assert.rejects(
			recordAskPaymentPause(tx, adminId, {
				...input,
				operationId: randomUUID(),
				paused: false,
				expectedPaused: true,
				expectedRevision: first.eventId,
			}),
			/another administrator/,
		);
		await assert.rejects(
			lockAskCapacity(tx, ask!.id, 100),
			/not accepting/,
		);
		await recordAskPaymentPause(tx, adminId, {
			...input,
			operationId: randomUUID(),
			paused: false,
			expectedPaused: true,
			expectedRevision: nextPause.eventId,
		});
		const events = await tx
			.select()
			.from(operationEvents)
			.where(eq(operationEvents.entityId, String(ask!.id)));
		assert.equal(events.length, 4);
		await tx
			.update(users)
			.set({ role: 'member' })
			.where(eq(users.id, adminId));
		await assert.rejects(
			recordAskPaymentPause(tx, adminId, {
				...input,
				operationId: randomUUID(),
			}),
		);
	});
});
