/** Real PostgreSQL tests with synthetic financial fixtures; NOT Stripe sandbox verification. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import {
	paymentAskSettings,
	paymentLedger,
	payments,
	paymentWebhookInbox,
	paymentSubscriptions,
	supporterPaidCoverage,
} from '../../src/server/db/payments-schema.ts';
import {
	fundingTotals,
	lockAskCapacity,
	updateFundingStatus,
} from '../../src/server/payments/checkout.ts';
import {
	postJournal,
	type PaymentTransaction,
} from '../../src/server/payments/ledger.ts';
import {
	askPaymentProgress,
	assertLegacyContributionsAllowed,
	syncPaymentAskGoal,
} from '../../src/server/payments/ask-funding.ts';
import { refreshSupporterEntitlement } from '../../src/server/payments/entitlements.ts';
import { journalDestinationRefunds } from '../../src/server/payments/destination-refunds.ts';
import { claimRecoveryBatch } from '../../src/server/payments/recovery.ts';
import { paymentOperationsSummary } from '../../src/server/payments/queries.ts';

const rollback = new Error('Intentional test rollback');
const originalSupporterPrice = process.env['STRIPE_SUPPORTER_PRICE_ID'];
const originalSustainerPrice = process.env['STRIPE_SUSTAINER_PRICE_ID'];
function databaseMessage(error: unknown): string {
	if (!(error instanceof Error)) return '';
	return error.cause instanceof Error ?
			databaseMessage(error.cause)
		:	error.message;
}
async function rolledBack(run: (tx: PaymentTransaction) => Promise<void>) {
	await assert.rejects(
		db.transaction(async (tx) => {
			await run(tx);
			throw rollback;
		}),
		(error) => error === rollback,
	);
}

before(async () => {
	assert.equal(
		process.env['APP_ENV'],
		'test',
		'Only the dedicated CI environment is allowed.',
	);
	const target = new URL(process.env['DATABASE_URL'] ?? '');
	assert.equal(
		decodeURIComponent(target.pathname.slice(1)),
		'givetogive_ci_20260926',
	);
	const result = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(result[0]?.name, 'givetogive_ci_20260926');
	assert.equal(result[0]?.role, 'givetogive_ci_20260926');
	process.env['STRIPE_SUPPORTER_PRICE_ID'] = 'price_ci_supporter';
	process.env['STRIPE_SUSTAINER_PRICE_ID'] = 'price_ci_sustainer';
});

after(async () => {
	if (originalSupporterPrice === undefined)
		delete process.env['STRIPE_SUPPORTER_PRICE_ID'];
	else process.env['STRIPE_SUPPORTER_PRICE_ID'] = originalSupporterPrice;
	if (originalSustainerPrice === undefined)
		delete process.env['STRIPE_SUSTAINER_PRICE_ID'];
	else process.env['STRIPE_SUSTAINER_PRICE_ID'] = originalSustainerPrice;
	await db.$client.end();
});

async function fixture(tx: PaymentTransaction) {
	const ownerId = randomUUID();
	const donorId = randomUUID();
	await tx.insert(users).values([
		{
			id: ownerId,
			name: 'CI recipient',
			email: `${ownerId}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
		},
		{
			id: donorId,
			name: 'CI donor',
			email: `${donorId}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
		},
	]);
	const [ask] = await tx
		.insert(asks)
		.values({
			slug: `ci-${randomUUID()}`,
			title: 'CI payment goal',
			description: 'Synthetic fixture within a rolled back transaction.',
			difficulty: 1,
			estimatedMinutesToComplete: 1,
			type: 'money',
			currency: 'USD',
			goalAmount: 2000,
			createdById: ownerId,
		})
		.returning();
	await tx
		.insert(paymentAskSettings)
		.values({ askId: ask!.id, goalAmount: 2000 });
	return { donorId, askId: ask!.id };
}

function paymentValues(donorId: string, askId: number) {
	return {
		id: randomUUID(),
		actorId: donorId,
		askId,
		kind: 'ask' as const,
		livemode: false,
		requestHash: 'ci-fixture-not-stripe',
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
		expiresAt: new Date(Date.now() - 10_000),
	};
}

test('operations metrics exclude supporter giving and retain only active noncanceling paid MRR in the correct mode', async () =>
	rolledBack(async (tx) => {
		await tx.execute(sql`set transaction isolation level repeatable read`);
		// Clock policy is separately tested. These uncommitted synthetic fixtures
		// use a fixed server wall-time provider, never a caller-controlled API field.
		const fixtureTime = async () => ({
			status: 'ready' as const,
			asOf: new Date(),
			source: 'wall' as const,
		});
		const baseline = await paymentOperationsSummary(tx, fixtureTime);
		const productionSummary = async () => {
			const previous = process.env['APP_ENV'];
			process.env['APP_ENV'] = 'production';
			try {
				return await paymentOperationsSummary(tx, fixtureTime);
			} finally {
				if (previous === undefined) delete process.env['APP_ENV'];
				else process.env['APP_ENV'] = previous;
			}
		};
		const liveBaseline = await productionSummary();
		const { donorId, askId } = await fixture(tx);
		const paidAt = new Date();
		await tx.insert(payments).values([
			{
				...paymentValues(donorId, askId),
				status: 'disputed',
				paidAt,
				refundedAmount: 100,
				refundedRecipientAmount: 89,
				disputedAmount: 200,
			},
			{
				...paymentValues(donorId, askId),
				kind: 'fund',
				askId: null,
				status: 'succeeded',
				paidAt,
			},
			{ ...paymentValues(donorId, askId), status: 'pending', paidAt },
			{
				...paymentValues(donorId, askId),
				status: 'succeeded',
				paidAt: null,
			},
			// Synthetic mode-isolation fixture only, rolled back with everything else.
			{
				...paymentValues(donorId, askId),
				livemode: true,
				status: 'succeeded',
				paidAt,
			},
		]);
		const subscriptions: Array<{
			tier: 'supporter' | 'sustainer';
			status: string;
			kind: 'supporter' | 'fund';
			cancelAtPeriodEnd?: boolean;
			expired?: boolean;
			livemode?: boolean;
		}> = [
			{ tier: 'supporter', status: 'active', kind: 'supporter' },
			{ tier: 'sustainer', status: 'active', kind: 'supporter' },
			{
				tier: 'sustainer',
				status: 'active',
				kind: 'supporter',
				cancelAtPeriodEnd: true,
			},
			{ tier: 'sustainer', status: 'past_due', kind: 'supporter' },
			{
				tier: 'sustainer',
				status: 'active',
				kind: 'supporter',
				expired: true,
			},
			{ tier: 'sustainer', status: 'active', kind: 'fund' },
			{
				tier: 'sustainer',
				status: 'active',
				kind: 'supporter',
				livemode: true,
			},
		];
		for (const input of subscriptions) {
			const actorId = randomUUID();
			await tx.insert(users).values({
				id: actorId,
				name: 'CI metrics fixture',
				email: `${actorId}@example.invalid`,
				isSynthetic: true,
			});
			const subscriptionId = `sub_ci_${randomUUID()}`;
			const invoiceId = `in_ci_${randomUUID()}`;
			const priceId =
				input.tier === 'sustainer' ?
					'price_ci_sustainer'
				:	'price_ci_supporter';
			const periodEnd = new Date(
				Date.now() + (input.expired ? -86_400_000 : 86_400_000),
			);
			const payment = {
				...paymentValues(actorId, askId),
				subscriptionId,
				invoiceId,
				kind: 'supporter' as const,
				askId: null,
				status: 'succeeded' as const,
				paidAt,
				livemode: input.livemode ?? false,
			};
			await tx.insert(payments).values(payment);
			await tx.insert(paymentSubscriptions).values({
				id: subscriptionId,
				actorId,
				accountId: `ci_${randomUUID()}`,
				priceId,
				livemode: input.livemode ?? false,
				kind: input.kind,
				tier: input.tier,
				status: input.status,
				cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
				paidThrough: new Date(
					Date.now() + (input.expired ? -86_400_000 : 86_400_000),
				),
				feeSnapshot: payment.feeSnapshot,
				initialPaymentId: payment.id,
			});
			await tx.insert(supporterPaidCoverage).values({
				invoiceLineId: `il_ci_${randomUUID()}`,
				itemId: 'si_ci_metrics_fixture',
				invoiceId,
				subscriptionId,
				paymentId: payment.id,
				livemode: payment.livemode,
				priceId,
				tier: input.tier,
				periodStart: new Date(Date.now() - 2 * 86_400_000),
				periodEnd,
				proration: false,
				appliedAt: paidAt,
			});
		}
		const current = await paymentOperationsSummary(tx, fixtureTime);
		assert.equal(current.totals.count - baseline.totals.count, 3);
		assert.equal(current.totals.gross - baseline.totals.gross, 3000);
		assert.equal(current.totals.refunds - baseline.totals.refunds, 100);
		assert.equal(
			current.totals.recipient - baseline.totals.recipient,
			1493,
		);
		assert.equal(current.supporterMrr - baseline.supporterMrr, 2000);
		const live = await productionSummary();
		assert.equal(live.totals.count - liveBaseline.totals.count, 1);
		assert.equal(live.totals.gross - liveBaseline.totals.gross, 1000);
		assert.equal(
			live.totals.recipient - liveBaseline.totals.recipient,
			891,
		);
		assert.equal(live.supporterMrr - liveBaseline.supporterMrr, 1500);
	}));

test('expired wall-clock reservations still occupy capacity until Stripe confirms terminal state', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		await tx.insert(payments).values({
			...paymentValues(donorId, askId),
			status: 'checkout_open',
		});
		assert.deepEqual(await fundingTotals(tx, askId), {
			paidAmount: 0,
			pendingAmount: 891,
		});
		await tx
			.update(payments)
			.set({ status: 'expired' })
			.where(eq(payments.askId, askId));
		assert.deepEqual(await fundingTotals(tx, askId), {
			paidAmount: 0,
			pendingAmount: 0,
		});
	}));

test('verified Ask progress uses recipient net after refunds and disputes and reopens a goal', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		await tx
			.update(paymentAskSettings)
			.set({ goalAmount: 891 })
			.where(eq(paymentAskSettings.askId, askId));
		const payment = paymentValues(donorId, askId);
		await tx.insert(payments).values({ ...payment, status: 'succeeded' });
		await updateFundingStatus(tx, askId);
		let [ask] = await tx.select().from(asks).where(eq(asks.id, askId));
		assert.equal(ask?.status, 'complete');
		await tx
			.update(payments)
			.set({
				status: 'disputed',
				refundedAmount: 100,
				refundedRecipientAmount: 89,
				disputedAmount: 200,
			})
			.where(eq(payments.id, payment.id));
		assert.deepEqual(await fundingTotals(tx, askId), {
			paidAmount: 602,
			pendingAmount: 0,
		});
		await updateFundingStatus(tx, askId);
		[ask] = await tx.select().from(asks).where(eq(asks.id, askId));
		assert.equal(ask?.status, 'in_progress');
	}));

test('webhook inbox deduplicates an event within its Stripe account and mode', async () =>
	rolledBack(async (tx) => {
		const event = {
			stripeEventId: `evt_ci_${randomUUID()}`,
			stripeAccountId: 'acct_ci',
			livemode: false,
			type: 'checkout.session.completed',
			objectId: 'cs_ci',
		};
		await tx
			.insert(paymentWebhookInbox)
			.values(event)
			.onConflictDoNothing();
		await tx
			.insert(paymentWebhookInbox)
			.values(event)
			.onConflictDoNothing();
		const rows = await tx
			.select()
			.from(paymentWebhookInbox)
			.where(eq(paymentWebhookInbox.stripeEventId, event.stripeEventId));
		assert.equal(rows.length, 1);
	}));

test('journal replay is idempotent and conflicting financial content is rejected', async () =>
	rolledBack(async (tx) => {
		const journal = {
			operationKey: `ci:${randomUUID()}`,
			livemode: false,
			lines: [
				{ account: 'stripe_cash', amount: 100 },
				{ account: 'platform_revenue', amount: -100 },
			],
		};
		await postJournal(tx, journal);
		await postJournal(tx, journal);
		const rows = await tx
			.select()
			.from(paymentLedger)
			.where(eq(paymentLedger.operationKey, journal.operationKey));
		assert.equal(rows.length, 1);
		await assert.rejects(
			postJournal(tx, {
				...journal,
				lines: [
					{ account: 'stripe_cash', amount: 200 },
					{ account: 'platform_revenue', amount: -200 },
				],
			}),
			/idempotency conflict/,
		);
	}));

test('database rejects an unbalanced ledger even when application validation is bypassed', async () => {
	await assert.rejects(
		db.transaction(async (tx) => {
			await tx.insert(paymentLedger).values({
				operationKey: `ci-unbalanced:${randomUUID()}`,
				livemode: false,
				lines: [
					{ account: 'cash', amount: 100 },
					{ account: 'revenue', amount: -99 },
				],
			});
		}),
		(error) => /balanced|balance|journal/i.test(databaseMessage(error)),
	);
});

test('database prohibits updates to existing immutable financial journals', async () => {
	await assert.rejects(
		db.transaction(async (tx) => {
			const operationKey = `ci-immutable:${randomUUID()}`;
			await postJournal(tx, {
				operationKey,
				livemode: false,
				lines: [
					{ account: 'cash', amount: 100 },
					{ account: 'revenue', amount: -100 },
				],
			});
			await tx
				.update(paymentLedger)
				.set({ currency: 'eur' })
				.where(eq(paymentLedger.operationKey, operationKey));
		}),
		(error) => /immutable|append.only/i.test(databaseMessage(error)),
	);
});

test('payment quote accounting is protected by a database amount check', async () => {
	await assert.rejects(
		db.transaction(async (tx) => {
			const { donorId, askId } = await fixture(tx);
			await tx.insert(payments).values({
				...paymentValues(donorId, askId),
				recipientAmount: 900,
			});
		}),
		(error) => /payment_amounts_valid/.test(databaseMessage(error)),
	);
});

test('payment Ask guard forbids manual pledges and owner goals cannot erase pending capacity', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		await assert.rejects(
			assertLegacyContributionsAllowed(tx, askId),
			/verified payments/,
		);
		await tx.insert(payments).values(paymentValues(donorId, askId));
		await assert.rejects(
			syncPaymentAskGoal(tx, askId, 890),
			/pending payment reservations/,
		);
		await syncPaymentAskGoal(tx, askId, 891);
		const [ask] = await tx.select().from(asks).where(eq(asks.id, askId));
		const [settings] = await tx
			.select()
			.from(paymentAskSettings)
			.where(eq(paymentAskSettings.askId, askId));
		assert.equal(ask?.goalAmount, 891);
		assert.equal(settings?.goalAmount, 891);
		assert.equal(ask?.status, 'in_progress');
		assert.deepEqual((await askPaymentProgress(tx, [askId])).get(askId), {
			paymentEnabled: true,
			verifiedFundingAmount: 0,
			pendingFundingAmount: 891,
			goalAmount: 891,
		});
	}));

test('refunded or disputed supporter invoices lose coverage and cannot regain it by replaying the entitlement projection', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		const periodEnd = new Date('2026-10-26T12:00:00Z');
		const initial = {
			...paymentValues(donorId, askId),
			askId: null,
			kind: 'supporter' as const,
			grossAmount: 500,
			platformFee: 500,
			processingEstimate: 0,
			recipientAmount: 0,
			tier: 'supporter' as const,
			subscriptionId: `sub_ci_${randomUUID()}`,
			invoiceId: `in_ci_${randomUUID()}`,
			entitlementPeriodEnd: periodEnd,
			paidAt: new Date(),
			status: 'succeeded' as const,
		};
		await tx.insert(payments).values(initial);
		await tx.insert(paymentSubscriptions).values({
			id: initial.subscriptionId,
			actorId: donorId,
			accountId: 'acct_ci',
			kind: 'supporter',
			tier: 'supporter',
			status: 'active',
			livemode: false,
			initialPaymentId: initial.id,
			feeSnapshot: initial.feeSnapshot,
		});
		await tx.insert(supporterPaidCoverage).values({
			invoiceLineId: `il_ci_${randomUUID()}`,
			itemId: 'si_ci_refund_fixture',
			invoiceId: initial.invoiceId,
			subscriptionId: initial.subscriptionId,
			paymentId: initial.id,
			livemode: false,
			priceId: 'price_ci_supporter',
			tier: 'supporter',
			periodStart: new Date('2026-09-26T12:00:00Z'),
			periodEnd,
			proration: false,
			appliedAt: new Date(),
		});
		const read = async () =>
			(
				await tx
					.select()
					.from(paymentSubscriptions)
					.where(eq(paymentSubscriptions.id, initial.subscriptionId))
			)[0]!;
		await refreshSupporterEntitlement(tx, initial.subscriptionId);
		assert.equal(
			(await read()).paidThrough?.toISOString(),
			periodEnd.toISOString(),
		);
		await tx
			.update(payments)
			.set({ status: 'refunded', refundedAmount: 500 })
			.where(eq(payments.id, initial.id));
		await refreshSupporterEntitlement(tx, initial.subscriptionId);
		await refreshSupporterEntitlement(tx, initial.subscriptionId);
		assert.equal((await read()).paidThrough, null);
		await tx
			.update(payments)
			.set({ status: 'disputed', refundedAmount: 0 })
			.where(eq(payments.id, initial.id));
		await refreshSupporterEntitlement(tx, initial.subscriptionId);
		assert.equal((await read()).paidThrough, null);
		await tx
			.update(payments)
			.set({ status: 'partially_refunded', refundedAmount: 100 })
			.where(eq(payments.id, initial.id));
		await refreshSupporterEntitlement(tx, initial.subscriptionId);
		assert.equal(
			(await read()).paidThrough?.toISOString(),
			periodEnd.toISOString(),
		);
	}));

test('destination refund recovery uses cumulative actual provider movements without rounding drift or replay duplication', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		const [payment] = await tx
			.insert(payments)
			.values({
				...paymentValues(donorId, askId),
				destinationAccountId: 'acct_ci',
				status: 'succeeded',
			})
			.returning();
		const snapshot = {
			chargeId: `ch_ci_${randomUUID()}`,
			refundedGross: 5,
			reversedGross: 5,
			feeReturned: 1,
		};
		await journalDestinationRefunds(tx, payment!, snapshot);
		await journalDestinationRefunds(tx, payment!, {
			...snapshot,
			refundedGross: 10,
			reversedGross: 10,
		});
		await journalDestinationRefunds(tx, payment!, {
			...snapshot,
			refundedGross: 10,
			reversedGross: 10,
		});
		await journalDestinationRefunds(tx, payment!, snapshot);
		const journals = await tx
			.select()
			.from(paymentLedger)
			.where(eq(paymentLedger.paymentId, payment!.id));
		assert.equal(journals.length, 2);
		const account = (name: string) =>
			journals
				.flatMap((journal) => journal.lines)
				.filter((line) => line.account === name)
				.reduce((sum, line) => sum + line.amount, 0);
		assert.equal(account('stripe_cash'), 9);
		assert.equal(account('recipient_refund_receivable'), -9);
		assert.equal(account('refund_rounding_variance'), 0);
	}));

test('open disputes keep reversible goal capacity reserved until a win or terminal loss', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		await tx
			.update(paymentAskSettings)
			.set({ goalAmount: 891 })
			.where(eq(paymentAskSettings.askId, askId));
		const value = paymentValues(donorId, askId);
		await tx.insert(payments).values({
			...value,
			status: 'disputed',
			disputedAmount: 891,
			disputePendingAmount: 891,
		});
		assert.deepEqual(await fundingTotals(tx, askId), {
			paidAmount: 0,
			pendingAmount: 891,
		});
		await assert.rejects(
			lockAskCapacity(tx, askId, 891),
			/remaining unreserved goal/,
		);
		await assert.rejects(
			syncPaymentAskGoal(tx, askId, 890),
			/pending payment reservations/,
		);
		await tx
			.update(payments)
			.set({
				status: 'succeeded',
				disputedAmount: 0,
				disputePendingAmount: 0,
			})
			.where(eq(payments.id, value.id));
		assert.deepEqual(await fundingTotals(tx, askId), {
			paidAmount: 891,
			pendingAmount: 0,
		});
		await tx
			.update(payments)
			.set({
				status: 'disputed',
				disputedAmount: 891,
				disputePendingAmount: 0,
			})
			.where(eq(payments.id, value.id));
		await assert.doesNotReject(lockAskCapacity(tx, askId, 891));
	}));

test('more than a page of poison reservations and webhooks cannot starve newer recovery work', async () =>
	rolledBack(async (tx) => {
		const { donorId, askId } = await fixture(tx);
		const paymentIds: string[] = Array.from({ length: 37 }, () =>
			randomUUID(),
		);
		const webhookIds: string[] = Array.from({ length: 37 }, () =>
			randomUUID(),
		);
		const old = new Date('1971-01-01T00:00:00Z');
		await tx.insert(payments).values(
			paymentIds.map((id) => ({
				...paymentValues(donorId, askId),
				id,
				updatedAt: old,
			})),
		);
		await tx.insert(paymentWebhookInbox).values(
			webhookIds.map((id) => ({
				id,
				stripeEventId: `evt_ci_poison_${id}`,
				stripeAccountId: 'acct_ci',
				livemode: false,
				type: 'payment_intent.succeeded',
				objectId: `pi_ci_${id}`,
				status: 'failed' as const,
				attempts: 99,
				updatedAt: old,
			})),
		);
		const first = await claimRecoveryBatch(tx);
		assert.equal(
			first.paymentIds.filter((id) => paymentIds.includes(id)).length,
			30,
		);
		assert.equal(
			first.webhookIds.filter((id) => webhookIds.includes(id)).length,
			30,
		);
		const second = await claimRecoveryBatch(tx);
		assert.equal(
			second.paymentIds.filter((id) => paymentIds.includes(id)).length,
			7,
		);
		assert.equal(
			second.webhookIds.filter((id) => webhookIds.includes(id)).length,
			7,
		);
		assert.equal(
			new Set(
				[...first.paymentIds, ...second.paymentIds].filter((id) =>
					paymentIds.includes(id),
				),
			).size,
			37,
		);
	}));
