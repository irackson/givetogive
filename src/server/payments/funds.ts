import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { asks } from '@/server/db/schema';
import {
	communityFunds,
	fundAllocations,
	fundAllocationSources,
	paymentAskSettings,
	paymentCases,
	paymentOperations,
	payments,
} from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import { requireReadyRecipient } from './accounts';
import { requirePaymentFeature, paymentConfiguration } from './config';
import { fundingTotals, updateFundingStatus } from './checkout';
import { netVerifiedFunding } from './math';
import { postJournal } from './ledger';
import { paymentErrorCode, stripeClient } from './stripe';
import { financialOperationId } from './operation-id';
import { type Stripe } from 'stripe';

export const createFundInput = z.object({
	slug: z
		.string()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.max(160),
	name: z.string().trim().min(3).max(160),
	description: z.string().trim().min(20).max(10_000),
});
export const allocateInput = z.object({
	operationId: z.uuid(),
	fundId: z.uuid(),
	askId: z.number().int().positive(),
	amount: z.number().int().positive().max(100_000_000),
	reason: z.string().trim().min(10).max(2000),
});

export async function createFund(
	userId: string,
	raw: z.input<typeof createFundInput>,
) {
	const input = createFundInput.parse(raw);
	requirePaymentFeature('fund');
	const [fund] = await db
		.insert(communityFunds)
		.values({ ...input, createdById: userId })
		.returning();
	await recordEvent({
		actorId: userId,
		entityType: 'fund',
		entityId: fund!.id,
		action: 'fund.created',
		outcome: 'success',
	});
	return fund!;
}

export async function reserveAllocation(
	userId: string,
	raw: z.input<typeof allocateInput>,
) {
	const input = allocateInput.parse(raw);
	const config = requirePaymentFeature('fund');
	const [ask] = await db.select().from(asks).where(eq(asks.id, input.askId));
	if (!ask) throw new TRPCError({ code: 'NOT_FOUND' });
	if (ask.createdById === userId)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Administrators cannot award funds to their own Asks.',
		});
	const recipient = await requireReadyRecipient(ask.createdById);
	return db.transaction(async (tx) => {
		await tx
			.select()
			.from(communityFunds)
			.where(eq(communityFunds.id, input.fundId))
			.for('update');
		await tx
			.select()
			.from(asks)
			.where(eq(asks.id, input.askId))
			.for('update');
		const [existing] = await tx
			.select()
			.from(fundAllocations)
			.where(eq(fundAllocations.id, input.operationId));
		if (existing) {
			if (
				existing.approvedById !== userId ||
				existing.fundId !== input.fundId ||
				existing.askId !== input.askId ||
				existing.amount !== input.amount ||
				existing.reason !== input.reason
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Allocation identifier reused.',
				});
			return existing;
		}
		const [settings] = await tx
			.select()
			.from(paymentAskSettings)
			.where(eq(paymentAskSettings.askId, input.askId));
		if (!settings || settings.pausedAt)
			throw new TRPCError({
				code: 'PRECONDITION_FAILED',
				message: 'Choose an eligible payment-enabled Ask.',
			});
		const funding = await fundingTotals(tx, input.askId);
		if (
			input.amount + funding.paidAmount + funding.pendingAmount >
			settings.goalAmount
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'The allocation exceeds the remaining Ask goal.',
			});
		const sources = await tx
			.select()
			.from(payments)
			.where(
				and(
					eq(payments.fundId, input.fundId),
					eq(payments.livemode, config.livemode),
					inArray(payments.status, [
						'succeeded',
						'partially_refunded',
					]),
					lte(payments.availableAt, new Date()),
					sql`NOT EXISTS (SELECT 1 FROM ${paymentOperations} WHERE ${paymentOperations.paymentId} = ${payments.id} AND ${paymentOperations.kind} = 'refund' AND ${paymentOperations.status} IN ('pending','recovery_required'))`,
					sql`NOT EXISTS (SELECT 1 FROM ${paymentCases} WHERE ${paymentCases.paymentId} = ${payments.id} AND ${paymentCases.category} = 'financial_hold' AND ${paymentCases.resolvedAt} IS NULL)`,
				),
			)
			.orderBy(asc(payments.createdAt))
			.for('update');
		const available = sources.reduce(
			(sum, p) =>
				sum + Math.max(0, netVerifiedFunding(p) - p.allocatedAmount),
			0,
		);
		if (available < input.amount)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'The fund does not have enough settled, unallocated money.',
			});
		const [allocation] = await tx
			.insert(fundAllocations)
			.values({
				id: input.operationId,
				fundId: input.fundId,
				askId: input.askId,
				amount: input.amount,
				reason: input.reason,
				approvedById: userId,
				destinationAccountId: recipient.stripeAccountId,
				livemode: config.livemode,
			})
			.returning();
		let remaining = input.amount;
		for (const p of sources) {
			const amount = Math.min(
				remaining,
				Math.max(0, netVerifiedFunding(p) - p.allocatedAmount),
			);
			if (!amount) continue;
			await tx.insert(fundAllocationSources).values({
				allocationId: allocation!.id,
				paymentId: p.id,
				amount,
			});
			await tx
				.update(payments)
				.set({ allocatedAmount: p.allocatedAmount + amount })
				.where(eq(payments.id, p.id));
			remaining -= amount;
			if (!remaining) break;
		}
		await recordEvent(
			{
				actorId: userId,
				entityType: 'fund_allocation',
				entityId: allocation!.id,
				action: 'allocation.reserved',
				outcome: 'success',
				correlationId: allocation!.id,
				details: {
					fundId: input.fundId,
					askId: input.askId,
					amount: input.amount,
				},
			},
			tx,
		);
		await updateFundingStatus(tx, input.askId);
		return allocation!;
	});
}

export async function processAllocation(id: string) {
	const [allocation] = await db
		.select()
		.from(fundAllocations)
		.where(eq(fundAllocations.id, id));
	if (!allocation || ['completed', 'reversed'].includes(allocation.status))
		return;
	if (allocation.livemode !== paymentConfiguration().livemode)
		throw new Error('Allocation environment mismatch.');
	const [ask] = await db
		.select()
		.from(asks)
		.where(eq(asks.id, allocation.askId));
	await db
		.update(fundAllocations)
		.set({ status: 'processing' })
		.where(eq(fundAllocations.id, id));
	const sources = await db
		.select({ source: fundAllocationSources, payment: payments })
		.from(fundAllocationSources)
		.innerJoin(payments, eq(payments.id, fundAllocationSources.paymentId))
		.where(eq(fundAllocationSources.allocationId, id));
	try {
		for (const { source, payment } of sources) {
			if (source.transferId) continue;
			if (!payment.chargeId)
				throw new Error('Funding charge is missing.');
			let recovered: Stripe.Transfer | undefined;
			for await (const previous of stripeClient().transfers.list({
				transfer_group: `allocation:${id}`,
				limit: 100,
			})) {
				if (previous.source_transaction === payment.chargeId) {
					recovered = previous;
					break;
				}
			}
			if (
				recovered &&
				(recovered.amount !== source.amount ||
					recovered.destination !== allocation.destinationAccountId)
			)
				throw new Error(
					'Recovered allocation transfer does not match its reservation.',
				);
			if (!recovered) {
				// Recover a previous transfer before rejecting a now-invalid source;
				// otherwise a lost create response could never be reclaimed.
				const [current] = await db
					.select()
					.from(payments)
					.where(eq(payments.id, payment.id));
				const [hold] = await db
					.select({ id: paymentCases.id })
					.from(paymentCases)
					.where(
						and(
							eq(paymentCases.paymentId, payment.id),
							eq(paymentCases.category, 'financial_hold'),
							sql`${paymentCases.resolvedAt} IS NULL`,
						),
					)
					.limit(1);
				if (
					!current ||
					hold ||
					netVerifiedFunding(current) < current.allocatedAmount
				)
					throw new Error(
						'Funding source is no longer available; financial reconciliation required.',
					);
				await requireReadyRecipient(ask!.createdById);
			}
			const transfer =
				recovered ??
				(await stripeClient().transfers.create(
					{
						amount: source.amount,
						currency: 'usd',
						destination: allocation.destinationAccountId,
						source_transaction: payment.chargeId,
						transfer_group: `allocation:${id}`,
						metadata: { allocation_id: id },
					},
					{ idempotencyKey: `allocate:${id}:${payment.id}` },
				));
			await db.transaction(async (tx) => {
				await tx
					.update(fundAllocationSources)
					.set({ transferId: transfer.id })
					.where(
						and(
							eq(fundAllocationSources.allocationId, id),
							eq(fundAllocationSources.paymentId, payment.id),
						),
					);
				await postJournal(tx, {
					operationKey: `allocation:${id}:${payment.id}`,
					paymentId: payment.id,
					fundId: allocation.fundId,
					livemode: allocation.livemode,
					lines: [
						{
							account: `fund:${allocation.fundId}`,
							amount: source.amount,
						},
						{ account: 'stripe_cash', amount: -source.amount },
					],
				});
			});
		}
		await db.transaction(async (tx) => {
			await tx
				.select()
				.from(communityFunds)
				.where(eq(communityFunds.id, allocation.fundId))
				.for('update');
			await tx
				.select()
				.from(asks)
				.where(eq(asks.id, allocation.askId))
				.for('update');
			const currentSources = await tx
				.select({ payment: payments })
				.from(fundAllocationSources)
				.innerJoin(
					payments,
					eq(payments.id, fundAllocationSources.paymentId),
				)
				.where(eq(fundAllocationSources.allocationId, id))
				.for('update', { of: payments });
			for (const { payment } of currentSources) {
				const [hold] = await tx
					.select({ id: paymentCases.id })
					.from(paymentCases)
					.where(
						and(
							eq(paymentCases.paymentId, payment.id),
							eq(paymentCases.category, 'financial_hold'),
							sql`${paymentCases.resolvedAt} IS NULL`,
						),
					)
					.limit(1);
				if (
					hold ||
					netVerifiedFunding(payment) < payment.allocatedAmount
				)
					throw new Error(
						'Allocation source changed during transfer. Financial reconciliation is required before completing this allocation.',
					);
			}
			await tx
				.update(fundAllocations)
				.set({ status: 'completed' })
				.where(eq(fundAllocations.id, id));
			await tx
				.update(paymentCases)
				.set({ resolvedAt: new Date() })
				.where(eq(paymentCases.key, `allocation:${id}`));
			await updateFundingStatus(tx, allocation.askId);
			await recordEvent(
				{
					actorId: allocation.approvedById,
					entityType: 'fund_allocation',
					entityId: id,
					action: 'allocation.completed',
					outcome: 'success',
					correlationId: id,
				},
				tx,
			);
		});
	} catch (error) {
		await db
			.update(fundAllocations)
			.set({ status: 'recovery_required' })
			.where(eq(fundAllocations.id, id));
		await db
			.insert(paymentCases)
			.values({
				key: `allocation:${id}`,
				category: 'allocation_recovery',
				summary:
					'Allocation requires retry or financial review; reservation retained.',
			})
			.onConflictDoNothing();
		await recordEvent({
			entityType: 'fund_allocation',
			entityId: id,
			action: 'allocation.failed',
			outcome: 'error',
			correlationId: id,
			details: { code: paymentErrorCode(error) },
		});
		throw error;
	}
}

/** Reclaim only the needed previously allocated principal before a refund. */
export async function reclaimFundTransfers(
	paymentId: string,
	targetRefundedRecipient: number,
	operationKey: string,
) {
	// Claim a frozen operation while holding DB locks, call Stripe outside the
	// transaction, then apply exactly once. Competing refund/dispute handlers use
	// the same operation even if their target amounts differ.
	for (let attempt = 0; attempt < 100; attempt++) {
		const claim = await db.transaction(async (tx) => {
			const [payment] = await tx
				.select()
				.from(payments)
				.where(eq(payments.id, paymentId))
				.for('update');
			if (!payment?.fundId) return null;
			const required = Math.max(
				0,
				payment.allocatedAmount -
					(payment.recipientAmount - targetRefundedRecipient),
			);
			if (!required) return null;
			const candidates = await tx
				.select({
					source: fundAllocationSources,
					allocation: fundAllocations,
				})
				.from(fundAllocationSources)
				.innerJoin(
					fundAllocations,
					eq(fundAllocations.id, fundAllocationSources.allocationId),
				)
				.where(
					and(
						eq(fundAllocationSources.paymentId, paymentId),
						sql`${fundAllocationSources.reversedAmount} < ${fundAllocationSources.amount}`,
					),
				)
				.orderBy(asc(fundAllocationSources.createdAt));
			const candidate = candidates[0];
			if (
				!candidate ||
				!candidate.source.transferId ||
				!['completed', 'processing', 'recovery_required'].includes(
					candidate.allocation.status,
				)
			)
				throw new Error(
					'Pending allocation must be resolved before reclaiming funds.',
				);
			const { source, allocation } = candidate;
			const id = financialOperationId(
				`allocation-reversal:${source.allocationId}:${paymentId}:${source.reversedAmount}`,
			);
			await tx
				.insert(paymentOperations)
				.values({
					id,
					kind: 'allocation_reversal',
					paymentId,
					amount: Math.min(
						required,
						source.amount - source.reversedAmount,
					),
					reason: `${source.allocationId}:${operationKey}`,
				})
				.onConflictDoNothing();
			const [operation] = await tx
				.select()
				.from(paymentOperations)
				.where(eq(paymentOperations.id, id));
			return { payment, source, allocation, operation: operation! };
		});
		if (!claim) return;
		const { payment, source, allocation, operation } = claim;
		let reversalId = operation.stripeObjectId;
		if (!reversalId) {
			for await (const prior of stripeClient().transfers.listReversals(
				source.transferId!,
				{ limit: 100 },
			)) {
				if (prior.metadata?.['operation_id'] === operation.id) {
					reversalId = prior.id;
					break;
				}
			}
		}
		if (!reversalId)
			reversalId = (
				await stripeClient().transfers.createReversal(
					source.transferId!,
					{
						amount: operation.amount,
						metadata: { operation_id: operation.id },
					},
					{ idempotencyKey: `allocation-reversal:${operation.id}` },
				)
			).id;
		const reversal = await stripeClient().transfers.retrieveReversal(
			source.transferId!,
			reversalId,
		);
		if (reversal.amount !== operation.amount)
			throw new Error('Allocation reversal amount mismatch.');
		await db.transaction(async (tx) => {
			// Match the global Ask -> payment order; the claim transaction never waits for an Ask.
			await tx
				.select()
				.from(asks)
				.where(eq(asks.id, allocation.askId))
				.for('update');
			await tx
				.select()
				.from(payments)
				.where(eq(payments.id, paymentId))
				.for('update');
			const [current] = await tx
				.select()
				.from(paymentOperations)
				.where(eq(paymentOperations.id, operation.id))
				.for('update');
			if (current?.status === 'succeeded') return;
			await tx
				.update(fundAllocationSources)
				.set({
					reversedAmount: sql`${fundAllocationSources.reversedAmount} + ${operation.amount}`,
				})
				.where(
					and(
						eq(
							fundAllocationSources.allocationId,
							source.allocationId,
						),
						eq(fundAllocationSources.paymentId, paymentId),
					),
				);
			await tx
				.update(fundAllocations)
				.set({
					reversedAmount: sql`${fundAllocations.reversedAmount} + ${operation.amount}`,
				})
				.where(eq(fundAllocations.id, source.allocationId));
			await tx
				.update(payments)
				.set({
					allocatedAmount: sql`${payments.allocatedAmount} - ${operation.amount}`,
				})
				.where(eq(payments.id, paymentId));
			await postJournal(tx, {
				operationKey: `transfer-reversal:${reversal.id}`,
				paymentId,
				fundId: payment.fundId!,
				livemode: payment.livemode,
				lines: [
					{ account: 'stripe_cash', amount: operation.amount },
					{
						account: `fund:${payment.fundId}`,
						amount: -operation.amount,
					},
				],
			});
			await tx
				.update(paymentOperations)
				.set({ status: 'succeeded', stripeObjectId: reversal.id })
				.where(eq(paymentOperations.id, operation.id));
			await updateFundingStatus(tx, allocation.askId);
		});
	}
	throw new Error(
		'Fund recovery batch limit reached; continue through the recovery queue.',
	);
}
