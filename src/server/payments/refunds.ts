import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { asks } from '@/server/db/schema';
import {
	paymentCases,
	paymentOperations,
	payments,
	communityFunds,
} from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import { paymentConfiguration } from './config';
import { cumulativeRefund } from './math';
import { reclaimFundTransfers } from './funds';
import { findPaymentByIntent, reconcileCharge } from './reconcile';
import { postJournal } from './ledger';
import { updateFundingStatus } from './checkout';
import { paymentErrorCode, stripeClient, stripeId } from './stripe';
import { refreshSupporterEntitlement } from './entitlements';

export const refundInput = z.object({
	operationId: z.uuid(),
	paymentId: z.uuid(),
	amount: z.number().int().positive().max(100_000_000),
	reason: z.string().trim().min(10).max(2000),
});

export async function reserveRefund(
	userId: string,
	raw: z.input<typeof refundInput>,
) {
	const input = refundInput.parse(raw);
	const [reference] = await db
		.select({ fundId: payments.fundId })
		.from(payments)
		.where(eq(payments.id, input.paymentId));
	return db.transaction(async (tx) => {
		if (reference?.fundId)
			await tx
				.select()
				.from(communityFunds)
				.where(eq(communityFunds.id, reference.fundId))
				.for('update');
		const [payment] = await tx
			.select()
			.from(payments)
			.where(
				and(
					eq(payments.id, input.paymentId),
					eq(payments.livemode, paymentConfiguration().livemode),
				),
			)
			.for('update');
		if (!payment?.chargeId)
			throw new TRPCError({
				code: 'NOT_FOUND',
				message: 'No settled payment to refund.',
			});
		const [existing] = await tx
			.select()
			.from(paymentOperations)
			.where(eq(paymentOperations.id, input.operationId));
		if (existing) {
			if (
				existing.actorId !== userId ||
				existing.kind !== 'refund' ||
				existing.paymentId !== input.paymentId ||
				existing.amount !== input.amount ||
				existing.reason !== input.reason
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Refund operation identifier reused.',
				});
			return existing;
		}
		const [pending] = await tx
			.select()
			.from(paymentOperations)
			.where(
				and(
					eq(paymentOperations.paymentId, payment.id),
					eq(paymentOperations.kind, 'refund'),
					sql`${paymentOperations.status} IN ('pending','recovery_required')`,
				),
			)
			.limit(1);
		if (pending)
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'Resolve the existing refund before creating another.',
			});
		if (
			payment.status === 'disputed' ||
			input.amount + payment.refundedAmount > payment.grossAmount
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'The amount exceeds refundable funds or an active dispute prevents this refund.',
			});
		if (
			payment.destinationAccountId &&
			!payment.transferId &&
			input.amount !== payment.grossAmount - payment.refundedAmount
		)
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'A skipped recipient transfer requires a full remaining refund.',
			});
		const [operation] = await tx
			.insert(paymentOperations)
			.values({
				id: input.operationId,
				kind: 'refund',
				actorId: userId,
				paymentId: input.paymentId,
				amount: input.amount,
				reason: input.reason,
			})
			.returning();
		await recordEvent(
			{
				actorId: userId,
				entityType: 'payment',
				entityId: payment.id,
				action: 'refund.requested',
				outcome: 'success',
				correlationId: input.operationId,
				details: { amount: input.amount },
			},
			tx,
		);
		return operation!;
	});
}

export async function processRefund(id: string) {
	const [operation] = await db
		.select()
		.from(paymentOperations)
		.where(eq(paymentOperations.id, id));
	if (
		!operation ||
		['succeeded', 'failed'].includes(operation.status) ||
		operation.kind !== 'refund'
	)
		return;
	const [payment] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, operation.paymentId!));
	if (
		!payment?.chargeId ||
		payment.livemode !== paymentConfiguration().livemode
	)
		throw new Error('Refund payment environment mismatch.');
	try {
		let refundId = operation.stripeObjectId;
		if (!refundId) {
			// Recover a response lost after Stripe executed, including beyond its idempotency retention.
			for await (const prior of stripeClient().refunds.list({
				charge: payment.chargeId,
				limit: 100,
			})) {
				if (prior.metadata?.['operation_id'] === id) {
					refundId = prior.id;
					break;
				}
			}
		}
		if (!refundId) {
			const target = cumulativeRefund(
				payment,
				payment.refundedAmount + operation.amount,
			);
			await reclaimFundTransfers(
				payment.id,
				target.recipientAmount,
				`refund-reclaim:${id}`,
			);
			const refund = await stripeClient().refunds.create(
				{
					charge: payment.chargeId,
					amount: operation.amount,
					...(payment.transferId ?
						{ reverse_transfer: true, refund_application_fee: true }
					:	{}),
					metadata: { operation_id: id },
				},
				{ idempotencyKey: `refund:${id}` },
			);
			refundId = refund.id;
			await db
				.update(paymentOperations)
				.set({ stripeObjectId: refundId })
				.where(eq(paymentOperations.id, id));
		}
		const refund = await stripeClient().refunds.retrieve(refundId);
		if (refund.status === 'failed' || refund.status === 'canceled') {
			await db.transaction(async (tx) => {
				await tx
					.update(paymentOperations)
					.set({
						status: 'failed',
						stripeObjectId: refund.id,
						lastError: `refund_${refund.status}`,
					})
					.where(eq(paymentOperations.id, id));
				await tx
					.insert(paymentCases)
					.values({
						key: `refund-failed:${id}`,
						paymentId: payment.id,
						category: 'refund_failed',
						summary:
							'Stripe confirms this refund did not complete. Any recovered fund allocation principal remains in the fund; review before attempting a new refund.',
						stripeObjectId: refund.id,
					})
					.onConflictDoNothing();
				await recordEvent(
					{
						actorId: operation.actorId ?? undefined,
						entityType: 'payment',
						entityId: payment.id,
						action: 'refund.failed',
						outcome: 'error',
						correlationId: id,
						details: { status: refund.status },
					},
					tx,
				);
			});
			return;
		}
		if (refund.status !== 'succeeded')
			throw new Error(
				'Refund pending or failed; wait for provider reconciliation.',
			);
		await reconcileCharge(
			payment.id,
			await stripeClient().charges.retrieve(payment.chargeId, {
				expand: ['balance_transaction'],
			}),
		);
		if (payment.transferId) {
			const reversalId = stripeId(refund.transfer_reversal);
			if (!reversalId)
				throw new Error('Refund transfer reversal is missing.');
		}
		await db
			.update(paymentOperations)
			.set({
				status: 'succeeded',
				stripeObjectId: refundId,
				lastError: null,
			})
			.where(eq(paymentOperations.id, id));
		await db
			.update(paymentCases)
			.set({ resolvedAt: new Date() })
			.where(eq(paymentCases.key, `refund:${id}`));
		await recordEvent({
			actorId: operation.actorId ?? undefined,
			entityType: 'payment',
			entityId: payment.id,
			action: 'refund.completed',
			outcome: 'success',
			correlationId: id,
			details: { amount: operation.amount },
		});
	} catch (error) {
		await db
			.update(paymentOperations)
			.set({
				status: 'recovery_required',
				lastError: paymentErrorCode(error),
			})
			.where(eq(paymentOperations.id, id));
		await db
			.insert(paymentCases)
			.values({
				key: `refund:${id}`,
				paymentId: payment.id,
				category: 'refund_recovery',
				summary:
					'Refund or transfer recovery requires reconciliation. Do not submit a second refund.',
			})
			.onConflictDoNothing();
		throw error;
	}
}

export async function reconcileDispute(disputeId: string) {
	const dispute = await stripeClient().disputes.retrieve(disputeId);
	const intentId = stripeId(dispute.payment_intent);
	if (!intentId) return;
	const payment = await findPaymentByIntent(intentId);
	if (!payment || payment.livemode !== dispute.livemode) return;
	const isWon = ['won', 'warning_closed'].includes(dispute.status);
	let amount =
		isWon ? 0 : (
			cumulativeRefund(
				payment,
				Math.min(dispute.amount, payment.grossAmount),
			).recipientAmount
		);
	let recoveryTarget = 0;
	const applied = await db.transaction(async (tx) => {
		if (payment.askId)
			await tx
				.select()
				.from(asks)
				.where(eq(asks.id, payment.askId))
				.for('update');
		const [current] = await tx
			.select()
			.from(payments)
			.where(eq(payments.id, payment.id))
			.for('update');
		if (!current) return false;
		const [priorCase] = await tx
			.select()
			.from(paymentCases)
			.where(eq(paymentCases.key, `dispute:${disputeId}`));
		// Won disputes are terminal. An older concurrent fetch cannot reopen them.
		if (!isWon && priorCase?.resolvedAt) return false;
		amount = Math.min(
			amount,
			current.recipientAmount - current.refundedRecipientAmount,
		);
		recoveryTarget = current.refundedRecipientAmount + amount;
		await tx
			.update(payments)
			.set({
				disputedAmount: amount,
				disputePendingAmount:
					isWon || dispute.status === 'lost' ? 0 : amount,
				status:
					!isWon ? 'disputed'
					: current.refundedAmount === current.grossAmount ?
						'refunded'
					: current.refundedAmount ? 'partially_refunded'
					: 'succeeded',
			})
			.where(eq(payments.id, payment.id));
		for (const transaction of dispute.balance_transactions)
			await postJournal(tx, {
				operationKey: `dispute:${transaction.id}`,
				paymentId: payment.id,
				livemode: payment.livemode,
				lines: [
					{ account: 'stripe_cash', amount: transaction.net },
					{ account: 'dispute_expense', amount: -transaction.net },
				],
			});
		if (payment.fundId && dispute.status === 'lost')
			await postJournal(tx, {
				operationKey: `dispute-fund-loss:${disputeId}`,
				paymentId: payment.id,
				fundId: payment.fundId,
				livemode: payment.livemode,
				lines: [
					{ account: `fund:${payment.fundId}`, amount },
					{ account: 'dispute_expense', amount: -amount },
				],
			});
		await tx
			.insert(paymentCases)
			.values({
				key: `dispute:${disputeId}`,
				paymentId: payment.id,
				category: 'dispute',
				summary: `Dispute ${dispute.status}. Review evidence deadlines and transfer recovery.`,
				stripeObjectId: disputeId,
				resolvedAt: isWon ? new Date() : null,
			})
			.onConflictDoUpdate({
				target: paymentCases.key,
				set: {
					summary: `Dispute ${dispute.status}. Review evidence deadlines and transfer recovery.`,
					resolvedAt: isWon ? new Date() : null,
				},
			});
		if (payment.askId) await updateFundingStatus(tx, payment.askId);
		if (payment.kind === 'supporter' && payment.subscriptionId)
			await refreshSupporterEntitlement(tx, payment.subscriptionId);
		return true;
	});
	if (!applied) return;
	if (amount && payment.fundId)
		await reclaimFundTransfers(
			payment.id,
			recoveryTarget,
			`dispute-reclaim:${disputeId}`,
		);
	if (amount && payment.transferId) {
		try {
			const latest = await stripeClient().disputes.retrieve(disputeId);
			if (['won', 'warning_closed'].includes(latest.status))
				return reconcileDispute(disputeId);
			const operationId = disputeOperationId('reverse', disputeId);
			await db
				.insert(paymentOperations)
				.values({
					id: operationId,
					kind: 'dispute_reversal',
					paymentId: payment.id,
					amount,
					reason: disputeId,
				})
				.onConflictDoNothing();
			const [operation] = await db
				.select()
				.from(paymentOperations)
				.where(eq(paymentOperations.id, operationId));
			if (!operation)
				throw new Error('Missing frozen dispute reversal operation.');
			let reversalId = operation?.stripeObjectId ?? null;
			if (!reversalId) {
				for await (const prior of stripeClient().transfers.listReversals(
					payment.transferId,
					{ limit: 100 },
				)) {
					if (prior.metadata?.['dispute_id'] === disputeId) {
						reversalId = prior.id;
						break;
					}
				}
			}
			if (!reversalId)
				reversalId = (
					await stripeClient().transfers.createReversal(
						payment.transferId,
						{
							amount: operation.amount,
							metadata: { dispute_id: disputeId },
						},
						{ idempotencyKey: `dispute-reversal:${disputeId}` },
					)
				).id;
			const reversed = await stripeClient().transfers.retrieveReversal(
				payment.transferId,
				reversalId,
			);
			if (reversed.amount !== operation.amount)
				throw new Error('Dispute reversal amount mismatch.');
			await db.transaction(async (tx) => {
				await postJournal(tx, {
					operationKey: `dispute-recovery:${reversalId}`,
					paymentId: payment.id,
					livemode: payment.livemode,
					lines: [
						{ account: 'stripe_cash', amount: operation.amount },
						{
							account: 'dispute_recovery',
							amount: -operation.amount,
						},
					],
				});
				await tx
					.update(paymentOperations)
					.set({ stripeObjectId: reversalId, status: 'succeeded' })
					.where(eq(paymentOperations.id, operationId));
				await tx
					.update(paymentCases)
					.set({ resolvedAt: new Date() })
					.where(
						eq(paymentCases.key, `dispute-reversal:${disputeId}`),
					);
			});
			// A win may race the network reversal. Re-read and restore through the same
			// idempotent operation before declaring this handler finished.
			const afterReversal =
				await stripeClient().disputes.retrieve(disputeId);
			if (['won', 'warning_closed'].includes(afterReversal.status))
				return reconcileDispute(disputeId);
		} catch (error) {
			await db
				.insert(paymentCases)
				.values({
					key: `dispute-reversal:${disputeId}`,
					paymentId: payment.id,
					category: 'transfer_recovery',
					summary:
						'Dispute transfer reversal failed. Platform remains responsible for the loss.',
					stripeObjectId: disputeId,
				})
				.onConflictDoNothing();
			throw error;
		}
	}
	if (isWon && payment.destinationAccountId) {
		const [reversal] = await db
			.select()
			.from(paymentOperations)
			.where(
				eq(
					paymentOperations.id,
					disputeOperationId('reverse', disputeId),
				),
			);
		if (reversal?.status === 'succeeded') {
			const id = disputeOperationId('restore', disputeId);
			await db
				.insert(paymentOperations)
				.values({
					id,
					kind: 'dispute_restoration',
					paymentId: payment.id,
					amount: reversal.amount,
					reason: disputeId,
				})
				.onConflictDoNothing();
			const [operation] = await db
				.select()
				.from(paymentOperations)
				.where(eq(paymentOperations.id, id));
			if (operation?.status !== 'succeeded') {
				try {
					const transfers = await stripeClient().transfers.list({
						transfer_group: `dispute-restore:${disputeId}`,
						limit: 100,
					});
					const transfer =
						transfers.data[0] ??
						(await stripeClient().transfers.create(
							{
								amount: reversal.amount,
								currency: payment.currency,
								destination: payment.destinationAccountId,
								transfer_group: `dispute-restore:${disputeId}`,
								metadata: { dispute_id: disputeId },
							},
							{ idempotencyKey: `dispute-restore:${disputeId}` },
						));
					await db.transaction(async (tx) => {
						await postJournal(tx, {
							operationKey: `dispute-restored:${transfer.id}`,
							paymentId: payment.id,
							livemode: payment.livemode,
							lines: [
								{
									account: 'dispute_recovery',
									amount: reversal.amount,
								},
								{
									account: 'stripe_cash',
									amount: -reversal.amount,
								},
							],
						});
						await tx
							.update(paymentOperations)
							.set({
								stripeObjectId: transfer.id,
								status: 'succeeded',
								lastError: null,
							})
							.where(eq(paymentOperations.id, id));
						await tx
							.update(paymentCases)
							.set({ resolvedAt: new Date() })
							.where(
								eq(
									paymentCases.key,
									`dispute-restore:${disputeId}`,
								),
							);
					});
				} catch (error) {
					await db
						.update(paymentOperations)
						.set({
							status: 'recovery_required',
							lastError: paymentErrorCode(error),
						})
						.where(eq(paymentOperations.id, id));
					await db
						.insert(paymentCases)
						.values({
							key: `dispute-restore:${disputeId}`,
							paymentId: payment.id,
							category: 'transfer_restoration',
							summary:
								'Dispute was won but recovered recipient funds still require retransferring.',
							stripeObjectId: disputeId,
						})
						.onConflictDoNothing();
					throw error;
				}
			}
		}
	}
}

function disputeOperationId(action: string, disputeId: string) {
	const hash = createHash('sha256')
		.update(`${action}:${disputeId}`)
		.digest('hex')
		.slice(0, 32);
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
