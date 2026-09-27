import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { askContributions, asks, users } from '@/server/db/schema';
import {
	communityFunds,
	fundAllocations,
	paymentAskSettings,
	payments,
	paymentSubscriptions,
} from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import {
	ensureCustomerAccount,
	requirePaymentMember,
	requireReadyRecipient,
} from './accounts';
import { paymentConfiguration, requirePaymentFeature } from './config';
import { netVerifiedFunding, quotePayment, SUPPORTER_TIERS } from './math';
import { paymentErrorCode, stripeClient } from './stripe';
import type { PaymentTransaction } from './ledger';

export const checkoutInput = z
	.object({
		operationId: z.uuid(),
		kind: z.enum(['ask', 'fund', 'supporter']),
		askId: z.number().int().positive().optional(),
		fundId: z.uuid().optional(),
		tier: z.enum(['supporter', 'sustainer']).optional(),
		grossAmount: z.number().int().min(100).max(100_000_000).optional(),
		recurring: z.boolean().default(false),
		quoteVersion: z.string().max(100).optional(),
	})
	.superRefine((value, ctx) => {
		if (
			value.kind === 'ask' &&
			(!value.askId ||
				!value.grossAmount ||
				value.recurring ||
				value.fundId ||
				value.tier)
		)
			ctx.addIssue({
				code: 'custom',
				message: 'An Ask payment needs an Ask and one-time amount.',
			});
		if (
			value.kind === 'fund' &&
			(!value.fundId || !value.grossAmount || value.askId || value.tier)
		)
			ctx.addIssue({
				code: 'custom',
				message: 'A fund donation needs a fund and amount.',
			});
		if (
			value.kind === 'supporter' &&
			(!value.tier || value.askId || value.fundId || value.grossAmount)
		)
			ctx.addIssue({
				code: 'custom',
				message: 'Choose a supporter tier without an Ask or fund.',
			});
	});

export async function fundingTotals(
	tx: PaymentTransaction | typeof db,
	askId: number,
) {
	const rows = await tx
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.askId, askId),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	const allocations = await tx
		.select()
		.from(fundAllocations)
		.where(
			and(
				eq(fundAllocations.askId, askId),
				eq(fundAllocations.livemode, paymentConfiguration().livemode),
			),
		);
	const paidAmount =
		rows.reduce((sum, p) => sum + netVerifiedFunding(p), 0) +
		allocations
			.filter((a) => a.status === 'completed')
			.reduce((sum, a) => sum + a.amount - a.reversedAmount, 0);
	// Expiry time alone is insufficient: Stripe must first confirm terminal state.
	const pendingAmount =
		rows.reduce((sum, p) => sum + p.disputePendingAmount, 0) +
		rows
			.filter((p) =>
				['reserved', 'checkout_open', 'pending'].includes(p.status),
			)
			.reduce((sum, p) => sum + p.recipientAmount, 0) +
		allocations
			.filter((a) =>
				['reserved', 'processing', 'recovery_required'].includes(
					a.status,
				),
			)
			.reduce((sum, a) => sum + a.amount - a.reversedAmount, 0);
	return { paidAmount, pendingAmount };
}

export async function updateFundingStatus(
	tx: PaymentTransaction,
	askId: number,
) {
	const [settings] = await tx
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	if (!settings) return;
	const totals = await fundingTotals(tx, askId);
	await tx
		.update(asks)
		.set({
			status:
				totals.paidAmount >= settings.goalAmount ? 'complete'
				: totals.paidAmount + totals.pendingAmount > 0 ? 'in_progress'
				: 'not_started',
		})
		.where(eq(asks.id, askId));
}

/** The reservation insert must share this transaction; the Ask lock prevents overfunding. */
export async function lockAskCapacity(
	tx: PaymentTransaction,
	askId: number,
	recipientAmount: number,
) {
	const [ask] = await tx
		.select()
		.from(asks)
		.where(eq(asks.id, askId))
		.for('update');
	const [settings] = await tx
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	if (
		!ask ||
		ask.type !== 'money' ||
		ask.currency?.toLowerCase() !== 'usd' ||
		!settings ||
		settings.pausedAt
	)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'This Ask is not accepting verified payments.',
		});
	const totals = await fundingTotals(tx, askId);
	if (
		recipientAmount + totals.paidAmount + totals.pendingAmount >
		settings.goalAmount
	)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'That exceeds the remaining unreserved goal. Choose a smaller contribution.',
		});
}

export async function enableAskPayments(userId: string, askId: number) {
	requirePaymentFeature('ask');
	await requireReadyRecipient(userId);
	await db.transaction(async (tx) => {
		const [ask] = await tx
			.select()
			.from(asks)
			.where(eq(asks.id, askId))
			.for('update');
		if (!ask || ask.createdById !== userId)
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Only the Ask owner can enable payments.',
			});
		if (ask.type !== 'money' || ask.currency?.toLowerCase() !== 'usd')
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Payments require a USD money Ask.',
			});
		const [legacy] = await tx
			.select({ id: askContributions.id })
			.from(askContributions)
			.where(eq(askContributions.askId, askId))
			.limit(1);
		if (legacy)
			throw new TRPCError({
				code: 'PRECONDITION_FAILED',
				message:
					'This Ask has legacy pledges. Create a new money Ask to receive verified payments.',
			});
		await tx
			.insert(paymentAskSettings)
			.values({ askId, goalAmount: ask.goalAmount })
			.onConflictDoNothing();
		await recordEvent(
			{
				actorId: userId,
				entityType: 'ask',
				entityId: String(askId),
				action: 'payments.enabled',
				outcome: 'success',
			},
			tx,
		);
	});
	return { enabled: true };
}

export async function createCheckout(
	userId: string,
	rawInput: z.input<typeof checkoutInput>,
) {
	const input = checkoutInput.parse(rawInput);
	const config = requirePaymentFeature(input.kind);
	await requirePaymentMember(userId);
	const [priorOperation] = await db
		.select({ id: payments.id })
		.from(payments)
		.where(
			and(
				eq(payments.id, input.operationId),
				eq(payments.actorId, userId),
				eq(payments.livemode, config.livemode),
			),
		);
	const amount =
		input.kind === 'supporter' ?
			SUPPORTER_TIERS[input.tier!].amount
		:	input.grossAmount!;
	const quote =
		input.kind === 'supporter' ?
			{
				grossAmount: amount,
				platformFee: amount,
				processingEstimate: 0,
				recipientAmount: 0,
			}
		:	quotePayment(amount, config.feePolicy);
	if (
		input.kind !== 'supporter' &&
		!priorOperation &&
		input.quoteVersion !== config.feePolicy.version
	)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'Refresh and review the current fee quote before continuing.',
		});
	const requestHash = createHash('sha256')
		.update(JSON.stringify({ ...input, userId }))
		.digest('hex');
	const account = await ensureCustomerAccount(userId);
	let destination: string | undefined;
	if (input.kind === 'ask') {
		const [ask] = await db
			.select()
			.from(asks)
			.where(eq(asks.id, input.askId!));
		if (!ask) throw new TRPCError({ code: 'NOT_FOUND' });
		if (ask.createdById === userId)
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'You cannot contribute to your own Ask.',
			});
		destination = (await requireReadyRecipient(ask.createdById))
			.stripeAccountId;
	}
	const reserved = await db.transaction(async (tx) => {
		// Serialize checkout creation per member and synchronize the single-subscription check.
		await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, userId))
			.for('update');
		const [existing] = await tx
			.select()
			.from(payments)
			.where(eq(payments.id, input.operationId));
		if (existing) {
			if (
				existing.actorId !== userId ||
				existing.requestHash !== requestHash
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'This operation identifier was already used for a different request.',
				});
			return existing;
		}
		if (input.kind === 'ask') {
			await lockAskCapacity(tx, input.askId!, quote.recipientAmount);
		}
		if (input.kind === 'fund') {
			const [fund] = await tx
				.select()
				.from(communityFunds)
				.where(eq(communityFunds.id, input.fundId!));
			if (!fund?.active)
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'This fund is not accepting donations.',
				});
		}
		if (input.kind === 'supporter') {
			const [subscription] = await tx
				.select()
				.from(paymentSubscriptions)
				.where(
					and(
						eq(paymentSubscriptions.actorId, userId),
						eq(paymentSubscriptions.livemode, config.livemode),
						eq(paymentSubscriptions.kind, 'supporter'),
						sql`${paymentSubscriptions.status} NOT IN ('canceled','incomplete_expired')`,
					),
				)
				.limit(1);
			const [pending] = await tx
				.select({ id: payments.id })
				.from(payments)
				.where(
					and(
						eq(payments.actorId, userId),
						eq(payments.kind, 'supporter'),
						eq(payments.livemode, config.livemode),
						inArray(payments.status, [
							'reserved',
							'checkout_open',
							'pending',
						]),
					),
				)
				.limit(1);
			if (subscription || pending)
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'You already have a subscription or pending checkout. Manage it from billing.',
				});
		}
		const [row] = await tx
			.insert(payments)
			.values({
				id: input.operationId,
				actorId: userId,
				kind: input.kind,
				askId: input.askId ?? null,
				fundId: input.fundId ?? null,
				tier: input.tier ?? null,
				recurring: input.kind === 'supporter' || input.recurring,
				livemode: config.livemode,
				requestHash,
				...quote,
				feeSnapshot: config.feePolicy,
				destinationAccountId: destination ?? null,
				expiresAt: new Date(Date.now() + 35 * 60_000),
			})
			.returning();
		if (input.kind === 'ask') await updateFundingStatus(tx, input.askId!);
		return row!;
	});
	if (reserved.checkoutUrl && reserved.status === 'checkout_open')
		return {
			id: reserved.checkoutId!,
			url: reserved.checkoutUrl,
			operationId: reserved.id,
		};
	if (
		reserved.status !== 'reserved' ||
		reserved.expiresAt.getTime() < Date.now() + 30 * 60_000
	)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'This checkout needs reconciliation. Review your giving history before trying a new payment.',
		});
	const label =
		reserved.kind === 'ask' ? 'Contribution to a GiveToGive Ask'
		: reserved.kind === 'fund' ? 'GiveToGive community fund donation'
		: SUPPORTER_TIERS[reserved.tier!].name;
	const priceId =
		reserved.tier === 'supporter' ?
			process.env['STRIPE_SUPPORTER_PRICE_ID']
		:	process.env['STRIPE_SUSTAINER_PRICE_ID'];
	try {
		if (reserved.kind === 'supporter') {
			const price = await stripeClient().prices.retrieve(priceId!);
			if (
				!price.active ||
				price.livemode !== config.livemode ||
				price.currency !== 'usd' ||
				price.unit_amount !== reserved.grossAmount ||
				price.recurring?.interval !== 'month' ||
				price.recurring.interval_count !== 1
			)
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message:
						'The configured subscription price does not match the published tier.',
				});
		}
		const session = await stripeClient().checkout.sessions.create(
			{
				mode: reserved.recurring ? 'subscription' : 'payment',
				customer_account: account.stripeAccountId,
				integration_identifier: `givetogive-${Array.from(createHash('sha256').update(reserved.id).digest().subarray(0, 8), (byte) => String.fromCharCode(97 + (byte % 26))).join('')}`,
				client_reference_id: reserved.id,
				success_url: `${config.origin}/giving/${reserved.id}?checkout=returned`,
				cancel_url: `${config.origin}/giving/${reserved.id}?checkout=canceled`,
				expires_at: Math.floor(reserved.expiresAt.getTime() / 1000),
				line_items: [
					reserved.kind === 'supporter' ?
						{ price: priceId!, quantity: 1 }
					:	{
							quantity: 1,
							price_data: {
								currency: 'usd',
								unit_amount: reserved.grossAmount,
								product_data: { name: label },
								...(reserved.recurring ?
									{
										recurring: {
											interval: 'month' as const,
										},
									}
								:	{}),
							},
						},
				],
				...(reserved.recurring ?
					{
						subscription_data: {
							metadata: { operation_id: reserved.id },
						},
					}
				:	{
						payment_intent_data: {
							metadata: { operation_id: reserved.id },
							...(reserved.destinationAccountId ?
								{
									application_fee_amount:
										reserved.platformFee +
										reserved.processingEstimate,
									transfer_data: {
										destination:
											reserved.destinationAccountId,
									},
								}
							:	{ transfer_group: `fund:${reserved.fundId}` }),
						},
					}),
			},
			{ idempotencyKey: `checkout:${reserved.id}` },
		);
		if (!session.url || session.livemode !== config.livemode)
			throw new Error('Invalid checkout response.');
		await db
			.update(payments)
			.set({
				checkoutId: session.id,
				checkoutUrl: session.url,
				lastError: null,
			})
			.where(eq(payments.id, reserved.id));
		await db
			.update(payments)
			.set({ status: 'checkout_open' })
			.where(
				and(
					eq(payments.id, reserved.id),
					eq(payments.status, 'reserved'),
				),
			);
		await recordEvent({
			actorId: userId,
			entityType: 'payment',
			entityId: reserved.id,
			action: 'checkout.created',
			outcome: 'success',
			correlationId: reserved.id,
			details: { kind: reserved.kind, amount: reserved.grossAmount },
		});
		return { id: session.id, url: session.url, operationId: reserved.id };
	} catch (error) {
		// A transport error does not prove Stripe failed. Keep its reservation until reconciliation.
		await db
			.update(payments)
			.set({ lastError: paymentErrorCode(error) })
			.where(eq(payments.id, reserved.id));
		throw error;
	}
}
