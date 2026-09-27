/** Real isolated PostgreSQL + explicitly stubbed Stripe transport. NOT sandbox-provider evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, mock } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import {
	communityFunds,
	fundAllocations,
	fundAllocationSources,
	paymentAskSettings,
	paymentLedger,
	payments,
	paymentAccounts,
	paymentCases,
} from '../../src/server/db/payments-schema.ts';
import {
	reclaimFundTransfers,
	processAllocation,
} from '../../src/server/payments/funds.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import { reconcileCharge } from '../../src/server/payments/reconcile.ts';
import { fundingTotals } from '../../src/server/payments/checkout.ts';
import { type Stripe } from 'stripe';

const memberIds: string[] = [];
const fundIds: string[] = [];
const reversals = new Map<
	string,
	{
		id: string;
		amount: number;
		metadata: { operation_id: string };
		transfer: string;
	}
>();
let loseNextResponse = false;
let createCalls = 0;
before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	assert.equal(
		new URL(process.env['DATABASE_URL']!).pathname,
		'/givetogive_ci_20260926',
	);
	const target = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name,current_user as role`,
	);
	assert.equal(target[0]?.name, 'givetogive_ci_20260926');
	assert.equal(target[0]?.role, 'givetogive_ci_20260926');
	process.env['STRIPE_SECRET_KEY'] = [
		'sk',
		'test',
		'synthetic_contract_only',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ci_contract';
	process.env['APP_URL'] = 'https://ci.example.invalid';
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	const stripe = stripeClient();
	mock.method(
		stripe.v2.core.accounts,
		'retrieve',
		async function (id: string) {
			return {
				id,
				livemode: false,
				configuration: {
					recipient: {
						capabilities: {
							stripe_balance: {
								stripe_transfers: { status: 'active' },
								payouts: { status: 'active' },
							},
						},
					},
				},
				requirements: { entries: [] },
			};
		},
	);
	mock.method(stripe.transfers, 'listReversals', function (transfer: string) {
		return (async function* () {
			for (const reversal of reversals.values())
				if (reversal.transfer === transfer) yield reversal;
		})();
	});
	mock.method(
		stripe.transfers,
		'createReversal',
		async function (
			transfer: string,
			input: { amount: number; metadata: { operation_id: string } },
			options: { idempotencyKey: string },
		) {
			createCalls++;
			let reversal = reversals.get(options.idempotencyKey);
			if (!reversal) {
				reversal = {
					id: `trr_ci_${randomUUID()}`,
					amount: input.amount,
					metadata: input.metadata,
					transfer,
				};
				reversals.set(options.idempotencyKey, reversal);
			}
			await new Promise((resolve) => setTimeout(resolve, 15));
			if (loseNextResponse) {
				loseNextResponse = false;
				throw new Error(
					'Simulated response lost after provider commit',
				);
			}
			return reversal;
		},
	);
	mock.method(
		stripe.transfers,
		'retrieveReversal',
		async function (__transfer: string, id: string) {
			return [...reversals.values()].find(
				(reversal) => reversal.id === id,
			)!;
		},
	);
});
after(async () => {
	try {
		// Immutable financial evidence retains its synthetic principals; retire only
		// this test's exact fixtures instead of deleting audit/ledger history.
		if (memberIds.length)
			await db
				.update(users)
				.set({ frozenAt: new Date() })
				.where(inArray(users.id, memberIds));
		if (fundIds.length)
			await db
				.update(communityFunds)
				.set({ active: false })
				.where(inArray(communityFunds.id, fundIds));
	} finally {
		mock.restoreAll();
		await db.$client.end();
	}
});
async function fixture() {
	return db.transaction(async (tx) => {
		const donor = randomUUID(),
			owner = randomUUID();
		await tx.insert(users).values(
			[donor, owner].map((id) => ({
				id,
				name: 'CI recovery contract fixture',
				email: `${id}@example.invalid`,
				emailVerified: new Date(),
				isSynthetic: true,
			})),
		);
		memberIds.push(donor, owner);
		const [fund] = await tx
			.insert(communityFunds)
			.values({
				slug: `ci-recovery-${randomUUID()}`,
				name: 'CI recovery contract fund',
				description:
					'Synthetic test evidence; not a Stripe sandbox payment.',
				createdById: donor,
			})
			.returning();
		fundIds.push(fund!.id);
		const [ask] = await tx
			.insert(asks)
			.values({
				slug: `ci-recovery-${randomUUID()}`,
				title: 'CI recovery contract Ask',
				description:
					'Synthetic isolated CI fixture, not provider payment evidence.',
				createdById: owner,
				type: 'money',
				currency: 'USD',
				goalAmount: 2000,
				difficulty: 1,
				estimatedMinutesToComplete: 1,
			})
			.returning();
		await tx
			.insert(paymentAskSettings)
			.values({ askId: ask!.id, goalAmount: 2000 });
		const [payment] = await tx
			.insert(payments)
			.values({
				id: randomUUID(),
				actorId: donor,
				fundId: fund!.id,
				kind: 'fund',
				livemode: false,
				requestHash: 'CI-provider-contract-fixture',
				grossAmount: 1000,
				recipientAmount: 891,
				platformFee: 50,
				processingEstimate: 59,
				allocatedAmount: 800,
				status: 'succeeded',
				feeSnapshot: {
					version: 'ci',
					platformBps: 500,
					processingBps: 290,
					processingFixed: 30,
				},
				expiresAt: new Date(),
			})
			.returning();
		const [allocation] = await tx
			.insert(fundAllocations)
			.values({
				id: randomUUID(),
				fundId: fund!.id,
				askId: ask!.id,
				approvedById: donor,
				amount: 800,
				reason: 'CI synthetic contract test allocation',
				livemode: false,
				status: 'completed',
				destinationAccountId: 'acct_ci_recipient',
			})
			.returning();
		const transferId = `tr_ci_${randomUUID()}`;
		await tx.insert(fundAllocationSources).values({
			allocationId: allocation!.id,
			paymentId: payment!.id,
			amount: 800,
			transferId,
		});
		return {
			payment: payment!,
			allocation: allocation!,
			transferId,
			ownerId: owner,
		};
	});
}
test('competing refund and dispute recovery targets share frozen reversal operations and never double-reclaim', async () => {
	const value = await fixture();
	await Promise.all([
		reclaimFundTransfers(value.payment.id, 500, 'ci-refund'),
		reclaimFundTransfers(value.payment.id, 600, 'ci-dispute'),
		reclaimFundTransfers(value.payment.id, 600, 'ci-retry'),
	]);
	const moved = [...reversals.values()]
		.filter((row) => row.transfer === value.transferId)
		.reduce((sum, row) => sum + row.amount, 0);
	assert.equal(moved, 509);
	const [payment] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, value.payment.id));
	assert.equal(payment?.allocatedAmount, 291);
	const [source] = await db
		.select()
		.from(fundAllocationSources)
		.where(eq(fundAllocationSources.allocationId, value.allocation.id));
	assert.equal(source?.reversedAmount, 509);
	const journals = await db
		.select()
		.from(paymentLedger)
		.where(eq(paymentLedger.paymentId, value.payment.id));
	assert.equal(
		journals
			.flatMap((j) => j.lines)
			.filter((line) => line.account === 'stripe_cash')
			.reduce((sum, line) => sum + line.amount, 0),
		509,
	);
});
test('a provider response lost after executing is found by durable operation identity on retry', async () => {
	const value = await fixture();
	loseNextResponse = true;
	const beforeCalls = createCalls;
	await assert.rejects(
		reclaimFundTransfers(value.payment.id, 500, 'ci-lost'),
		/response lost/,
	);
	await reclaimFundTransfers(value.payment.id, 500, 'ci-lost-retry');
	assert.equal(createCalls - beforeCalls, 1);
	const moved = [...reversals.values()]
		.filter((row) => row.transfer === value.transferId)
		.reduce((sum, row) => sum + row.amount, 0);
	assert.equal(moved, 409);
	const [source] = await db
		.select()
		.from(fundAllocationSources)
		.where(eq(fundAllocationSources.allocationId, value.allocation.id));
	assert.equal(source?.reversedAmount, 409);
});

test('skipped destination transfer retains goal reservation and full-refund reconciliation never invents recipient delivery', async () => {
	const { payment, askId } = await db.transaction(async (tx) => {
		const donor = randomUUID(),
			owner = randomUUID();
		memberIds.push(donor, owner);
		await tx.insert(users).values(
			[donor, owner].map((id) => ({
				id,
				name: 'CI skipped transfer fixture',
				email: `${id}@example.invalid`,
				emailVerified: new Date(),
				isSynthetic: true,
			})),
		);
		const [ask] = await tx
			.insert(asks)
			.values({
				slug: `ci-skipped-${randomUUID()}`,
				title: 'CI skipped transfer Ask',
				description:
					'Synthetic provider contract fixture, not real Stripe verification.',
				createdById: owner,
				type: 'money',
				currency: 'USD',
				goalAmount: 891,
				difficulty: 1,
				estimatedMinutesToComplete: 1,
			})
			.returning();
		await tx
			.insert(paymentAskSettings)
			.values({ askId: ask!.id, goalAmount: 891 });
		const [payment] = await tx
			.insert(payments)
			.values({
				id: randomUUID(),
				actorId: donor,
				askId: ask!.id,
				kind: 'ask',
				livemode: false,
				destinationAccountId: 'acct_ci_unavailable',
				requestHash: 'CI-skipped-transfer-fixture',
				grossAmount: 1000,
				recipientAmount: 891,
				platformFee: 50,
				processingEstimate: 59,
				status: 'pending',
				feeSnapshot: {
					version: 'ci',
					platformBps: 500,
					processingBps: 290,
					processingFixed: 30,
				},
				expiresAt: new Date(),
			})
			.returning();
		return { payment: payment!, askId: ask!.id };
	});
	const now = Math.floor(Date.now() / 1000);
	const charge = {
		id: `ch_ci_${randomUUID()}`,
		livemode: false,
		amount: 1000,
		currency: 'usd',
		paid: true,
		amount_refunded: 0,
		created: now,
		transfer: null,
		application_fee: null,
		receipt_url: null,
		balance_transaction: {
			id: `txn_ci_${randomUUID()}`,
			fee: 59,
			status: 'available',
			available_on: now,
		},
	} as unknown as Stripe.Charge;
	await assert.rejects(
		reconcileCharge(payment.id, charge),
		/Destination transfer unavailable/,
	);
	let [current] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, payment.id));
	assert.equal(current?.status, 'pending');
	assert.equal(current?.paidAt, null);
	assert.equal(current?.chargeId, charge.id);
	assert.deepEqual(await fundingTotals(db, askId), {
		paidAmount: 0,
		pendingAmount: 891,
	});
	await reconcileCharge(payment.id, { ...charge, amount_refunded: 1000 });
	[current] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, payment.id));
	assert.equal(current?.status, 'refunded');
	assert.equal(current?.transferId, null);
	assert.deepEqual(await fundingTotals(db, askId), {
		paidAmount: 0,
		pendingAmount: 0,
	});
	const journals = await db
		.select()
		.from(paymentLedger)
		.where(eq(paymentLedger.paymentId, payment.id));
	assert.ok(
		journals.every(
			(journal) => !journal.operationKey.startsWith('destination:'),
		),
	);
});

test('fund refund reclaims an interrupted-but-transferred allocation, clears its hold, and allows finalization', async () => {
	const value = await fixture();
	await db
		.update(fundAllocations)
		.set({ status: 'recovery_required' })
		.where(eq(fundAllocations.id, value.allocation.id));
	await db
		.insert(paymentAccounts)
		.values({
			userId: value.ownerId,
			stripeAccountId: `acct_ci_${randomUUID()}`,
			livemode: false,
			recipientRequested: true,
			transfersActive: true,
			payoutsActive: true,
		});
	const now = Math.floor(Date.now() / 1000);
	const charge = {
		id: `ch_ci_${randomUUID()}`,
		livemode: false,
		amount: 1000,
		currency: 'usd',
		paid: true,
		amount_refunded: 500,
		created: now,
		transfer: null,
		application_fee: null,
		receipt_url: null,
		balance_transaction: {
			id: `txn_ci_${randomUUID()}`,
			fee: 59,
			status: 'available',
			available_on: now,
		},
	} as unknown as Stripe.Charge;
	await reconcileCharge(value.payment.id, charge);
	const [hold] = await db
		.select()
		.from(paymentCases)
		.where(eq(paymentCases.key, `fund-refund-hold:${charge.id}`));
	assert.ok(hold?.resolvedAt);
	const [source] = await db
		.select()
		.from(fundAllocationSources)
		.where(eq(fundAllocationSources.allocationId, value.allocation.id));
	assert.equal(source?.reversedAmount, 355);
	await processAllocation(value.allocation.id);
	const [allocation] = await db
		.select()
		.from(fundAllocations)
		.where(eq(fundAllocations.id, value.allocation.id));
	assert.equal(allocation?.status, 'completed');
	assert.ok(allocation);
	assert.equal(allocation.amount - allocation.reversedAmount, 445);
});
