import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { type Stripe } from 'stripe';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import { asks } from '@/server/db/schema';
import {
	paymentAccounts,
	paymentCases,
	paymentSubscriptions,
	payments,
	communityFunds,
	supporterPaidCoverage,
} from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import { paymentConfiguration } from './config';
import {
	cumulativeRefund,
	quotePayment,
	selectPaidSubscriptionLine,
} from './math';
import { postJournal } from './ledger';
import { updateFundingStatus } from './checkout';
import { stripeClient, stripeId } from './stripe';
import { reclaimFundTransfers } from './funds';
import { refreshSupporterEntitlement } from './entitlements';
import { recordPaidCoverage } from './coverage';
import { verifiedSupporterLines } from './coverage-policy';
import { appliedSupporterInvoiceLines } from './supporter-application-evidence';
import {
	destinationRefundSnapshot,
	journalDestinationRefunds,
} from './destination-refunds';

async function knownCheckout(session: Stripe.Checkout.Session) {
	const config = paymentConfiguration();
	if (session.livemode !== config.livemode)
		throw new Error('Checkout environment mismatch.');
	const [known] = await db
		.select()
		.from(payments)
		.where(eq(payments.checkoutId, session.id));
	if (known) return known;
	// A webhook can beat persistence of the create response. Link only a pre-existing
	// reserved operation after validating its first-class Stripe account and amount.
	if (
		!session.client_reference_id ||
		!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
			session.client_reference_id,
		)
	)
		return null;
	const [pending] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, session.client_reference_id));
	if (!pending || pending.checkoutId || pending.livemode !== config.livemode)
		return null;
	const [account] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, pending.actorId),
				eq(paymentAccounts.livemode, config.livemode),
			),
		);
	if (
		account?.stripeAccountId !== session.customer_account ||
		session.amount_total !== pending.grossAmount
	)
		throw new Error('Checkout ownership or amount mismatch.');
	const [linked] = await db
		.update(payments)
		.set({ checkoutId: session.id, checkoutUrl: session.url })
		.where(
			and(
				eq(payments.id, pending.id),
				sql`${payments.checkoutId} IS NULL`,
			),
		)
		.returning();
	return linked ?? pending;
}

export async function reconcileCheckout(sessionId: string) {
	const session = await stripeClient().checkout.sessions.retrieve(sessionId);
	const payment = await knownCheckout(session);
	if (!payment) return;
	const subscriptionId = stripeId(session.subscription);
	if (subscriptionId) {
		await db
			.update(payments)
			.set({ subscriptionId })
			.where(eq(payments.id, payment.id));
		await synchronizeSubscription(subscriptionId, payment.id);
		const subscription =
			await stripeClient().subscriptions.retrieve(subscriptionId);
		const invoiceId = stripeId(subscription.latest_invoice);
		if (invoiceId) await reconcileInvoice(invoiceId);
		return;
	}
	const intentId = stripeId(session.payment_intent);
	if (intentId) {
		await db
			.update(payments)
			.set({ paymentIntentId: intentId })
			.where(eq(payments.id, payment.id));
		await reconcilePaymentIntent(intentId);
	} else if (session.status === 'expired') {
		await db.transaction(async (tx) => {
			if (payment.askId)
				await tx
					.select()
					.from(asks)
					.where(eq(asks.id, payment.askId))
					.for('update');
			await tx
				.update(payments)
				.set({ status: 'expired' })
				.where(
					and(
						eq(payments.id, payment.id),
						inArray(payments.status, [
							'reserved',
							'checkout_open',
							'pending',
						]),
					),
				);
			if (payment.askId) await updateFundingStatus(tx, payment.askId);
		});
	}
}

export async function findPaymentByIntent(intentId: string) {
	const [payment] = await db
		.select()
		.from(payments)
		.where(eq(payments.paymentIntentId, intentId));
	if (payment) return payment;
	const sessions = await stripeClient().checkout.sessions.list({
		payment_intent: intentId,
		limit: 1,
	});
	if (sessions.data[0]) {
		const linked = await knownCheckout(sessions.data[0]);
		if (linked) {
			await db
				.update(payments)
				.set({ paymentIntentId: intentId })
				.where(eq(payments.id, linked.id));
			return linked;
		}
	}
	return null;
}

export async function reconcilePaymentIntent(intentId: string) {
	const payment = await findPaymentByIntent(intentId);
	if (!payment) return;
	const intent = await stripeClient().paymentIntents.retrieve(intentId, {
		expand: ['latest_charge.balance_transaction'],
	});
	if (
		intent.livemode !== payment.livemode ||
		intent.currency !== payment.currency ||
		intent.amount !== payment.grossAmount
	)
		throw new Error('Payment integrity mismatch.');
	if (intent.status === 'succeeded') {
		const charge =
			typeof intent.latest_charge === 'object' ?
				intent.latest_charge
			:	null;
		if (!charge || intent.amount_received !== payment.grossAmount)
			throw new Error('Payment settlement is incomplete.');
		await reconcileCharge(payment.id, charge);
	} else {
		const expired = payment.expiresAt <= new Date();
		// Requires-payment-method after a decline is retryable while Checkout remains open.
		let status: 'pending' | 'checkout_open' | 'expired' | 'failed' =
			intent.status === 'processing' ? 'pending' : 'checkout_open';
		if (intent.status === 'canceled') status = 'expired';
		if (
			(expired || intent.status === 'requires_payment_method') &&
			payment.checkoutId &&
			intent.status !== 'processing'
		) {
			const session = await stripeClient().checkout.sessions.retrieve(
				payment.checkoutId,
			);
			if (session.status === 'expired') status = 'expired';
			if (
				session.status === 'complete' &&
				session.payment_status === 'unpaid' &&
				intent.status === 'requires_payment_method'
			)
				status = 'failed';
		}
		await db.transaction(async (tx) => {
			if (payment.askId)
				await tx
					.select()
					.from(asks)
					.where(eq(asks.id, payment.askId))
					.for('update');
			await tx
				.update(payments)
				.set({ status })
				.where(
					and(
						eq(payments.id, payment.id),
						inArray(payments.status, [
							'reserved',
							'checkout_open',
							'pending',
						]),
					),
				);
			if (payment.askId) await updateFundingStatus(tx, payment.askId);
		});
	}
}

export async function reconcileCharge(
	paymentId: string,
	charge: Stripe.Charge,
) {
	const [existing] = await db
		.select()
		.from(payments)
		.where(eq(payments.id, paymentId));
	if (!existing) return;
	if (
		charge.livemode !== existing.livemode ||
		charge.amount !== existing.grossAmount ||
		charge.currency !== existing.currency ||
		!charge.paid
	)
		throw new Error('Charge integrity mismatch.');
	const balanceId = stripeId(charge.balance_transaction);
	const balance =
		typeof charge.balance_transaction === 'object' ?
			charge.balance_transaction
		: balanceId ?
			await stripeClient().balanceTransactions.retrieve(balanceId)
		:	null;
	if (!balance) throw new Error('Waiting for Stripe balance transaction.');
	const transferId = stripeId(charge.transfer);
	if (
		existing.destinationAccountId &&
		!transferId &&
		charge.amount_refunded !== charge.amount
	) {
		await db.transaction(async (tx) => {
			await tx
				.update(payments)
				.set({
					chargeId: charge.id,
					lastError: 'recipient_transfer_unavailable',
					status: 'pending',
				})
				.where(
					and(
						eq(payments.id, paymentId),
						inArray(payments.status, [
							'reserved',
							'checkout_open',
							'pending',
						]),
					),
				);
			await tx
				.insert(paymentCases)
				.values({
					key: `skipped-transfer:${charge.id}`,
					paymentId,
					category: 'recipient_transfer_skipped',
					summary:
						'Donor charge settled but recipient transfer is missing. Keep goal capacity reserved. Resolve Stripe account restrictions or approve a full refund; do not mark recipient paid.',
					stripeObjectId: charge.id,
				})
				.onConflictDoNothing();
		});
		throw new Error(
			'Destination transfer unavailable; full-refund or recipient recovery required.',
		);
	}
	const destinationRefunds =
		existing.destinationAccountId ?
			await destinationRefundSnapshot(charge)
		:	null;
	if (existing.fundId && charge.amount_refunded > existing.refundedAmount) {
		await db.transaction(async (tx) => {
			await tx
				.select()
				.from(communityFunds)
				.where(eq(communityFunds.id, existing.fundId!))
				.for('update');
			await tx
				.insert(paymentCases)
				.values({
					key: `fund-refund-hold:${charge.id}`,
					paymentId,
					category: 'financial_hold',
					summary:
						'Fund source paused while a provider refund is reconciled.',
					stripeObjectId: charge.id,
				})
				.onConflictDoUpdate({
					target: paymentCases.key,
					set: { resolvedAt: null },
				});
		});
		const target = cumulativeRefund(existing, charge.amount_refunded);
		await reclaimFundTransfers(
			existing.id,
			target.recipientAmount,
			`charge-refund:${charge.id}:${charge.amount_refunded}`,
		);
	}
	await db.transaction(async (tx) => {
		if (existing.askId)
			await tx
				.select()
				.from(asks)
				.where(eq(asks.id, existing.askId))
				.for('update');
		const [payment] = await tx
			.select()
			.from(payments)
			.where(eq(payments.id, paymentId))
			.for('update');
		if (!payment) return;
		// Two concurrent event handlers can have fetched different charge snapshots.
		// Refund amounts never move backwards; ignore an older read instead of undoing it.
		if (charge.amount_refunded < payment.refundedAmount) return;
		const recipientAccount =
			payment.kind === 'fund' ?
				`fund:${payment.fundId}`
			:	`recipient:${payment.destinationAccountId}`;
		await postJournal(tx, {
			operationKey: `payment:${charge.id}`,
			paymentId,
			...(payment.fundId ? { fundId: payment.fundId } : {}),
			livemode: payment.livemode,
			lines: [
				{ account: 'stripe_cash', amount: payment.grossAmount },
				{ account: 'platform_revenue', amount: -payment.platformFee },
				{
					account: 'processing_reserve',
					amount: -payment.processingEstimate,
				},
				{ account: recipientAccount, amount: -payment.recipientAmount },
			],
		});
		await postJournal(tx, {
			operationKey: `processing:${balance.id}`,
			paymentId,
			livemode: payment.livemode,
			lines: [
				{
					account: 'processing_reserve',
					amount: payment.processingEstimate,
				},
				{
					account: 'processing_fee_variance',
					amount: balance.fee - payment.processingEstimate,
				},
				{ account: 'stripe_cash', amount: -balance.fee },
			],
		});
		if (transferId)
			await postJournal(tx, {
				operationKey: `destination:${transferId}`,
				paymentId,
				livemode: payment.livemode,
				lines: [
					{
						account: recipientAccount,
						amount: payment.recipientAmount,
					},
					{
						account: 'stripe_cash',
						amount: -payment.recipientAmount,
					},
				],
			});
		const refunded = cumulativeRefund(payment, charge.amount_refunded);
		if (charge.amount_refunded > payment.refundedAmount) {
			const gross = charge.amount_refunded - payment.refundedAmount;
			const old = cumulativeRefund(payment, payment.refundedAmount);
			const recipient = refunded.recipientAmount - old.recipientAmount;
			const platform = refunded.platformFee - old.platformFee;
			const processing = gross - recipient - platform;
			await postJournal(tx, {
				operationKey: `refund-total:${charge.id}:${charge.amount_refunded}`,
				paymentId,
				...(payment.fundId ? { fundId: payment.fundId } : {}),
				livemode: payment.livemode,
				lines: [
					{ account: 'stripe_cash', amount: -gross },
					{
						account:
							payment.kind === 'fund' ? `fund:${payment.fundId}`
							: payment.destinationAccountId && !transferId ?
								recipientAccount
							:	'recipient_refund_receivable',
						amount: recipient,
					},
					{ account: 'platform_revenue', amount: platform },
					{
						account: 'nonrecoverable_processing_expense',
						amount: processing,
					},
				],
			});
		}
		const status =
			payment.status === 'disputed' ? 'disputed'
			: charge.amount_refunded === payment.grossAmount ? 'refunded'
			: charge.amount_refunded > 0 ? 'partially_refunded'
			: 'succeeded';
		if (destinationRefunds)
			await journalDestinationRefunds(tx, payment, destinationRefunds);
		await tx
			.update(payments)
			.set({
				status,
				chargeId: charge.id,
				transferId,
				actualProcessingFee: balance.fee,
				receiptUrl: charge.receipt_url,
				availableAt:
					balance.status === 'available' ?
						new Date(balance.available_on * 1000)
					:	null,
				refundedAmount: charge.amount_refunded,
				refundedRecipientAmount: refunded.recipientAmount,
				paidAt: payment.paidAt ?? new Date(charge.created * 1000),
				lastError: null,
			})
			.where(eq(payments.id, paymentId));
		if (payment.askId) await updateFundingStatus(tx, payment.askId);
		if (payment.kind === 'supporter' && payment.subscriptionId)
			await refreshSupporterEntitlement(tx, payment.subscriptionId);
		if (payment.fundId)
			await tx
				.update(paymentCases)
				.set({ resolvedAt: new Date() })
				.where(eq(paymentCases.key, `fund-refund-hold:${charge.id}`));
		if (transferId || charge.amount_refunded === charge.amount)
			await tx
				.update(paymentCases)
				.set({ resolvedAt: new Date() })
				.where(eq(paymentCases.key, `skipped-transfer:${charge.id}`));
		if (!payment.paidAt)
			await recordEvent(
				{
					actorId: payment.actorId,
					entityType: 'payment',
					entityId: paymentId,
					action: 'payment.succeeded',
					outcome: 'success',
					correlationId: paymentId,
					details: {
						grossAmount: payment.grossAmount,
						recipientAmount: payment.recipientAmount,
						kind: payment.kind,
					},
				},
				tx,
			);
	});
}

export async function synchronizeSubscription(
	id: string,
	initialPaymentId?: string,
) {
	const config = paymentConfiguration();
	let [known] = await db
		.select()
		.from(paymentSubscriptions)
		.where(eq(paymentSubscriptions.id, id));
	if (!known) {
		const sub = await stripeClient().subscriptions.retrieve(id);
		if (sub.id !== id || sub.livemode !== config.livemode)
			throw new Error('Subscription environment mismatch.');
		if (!initialPaymentId) {
			const sessions = await stripeClient().checkout.sessions.list({
				subscription: id,
				limit: 1,
			});
			if (sessions.data[0])
				initialPaymentId = (await knownCheckout(sessions.data[0]))?.id;
		}
		if (!initialPaymentId) return null;
		const [initial] = await db
			.select()
			.from(payments)
			.where(eq(payments.id, initialPaymentId));
		if (!initial || initial.kind === 'ask') return null;
		const [account] = await db
			.select()
			.from(paymentAccounts)
			.where(
				and(
					eq(paymentAccounts.userId, initial.actorId),
					eq(paymentAccounts.livemode, config.livemode),
				),
			);
		if (account?.stripeAccountId !== sub.customer_account)
			throw new Error('Subscription ownership mismatch.');
		await db
			.insert(paymentSubscriptions)
			.values({
				id,
				actorId: initial.actorId,
				accountId: account.stripeAccountId,
				livemode: config.livemode,
				kind: initial.kind,
				fundId: initial.fundId,
				tier: initial.tier,
				priceId: sub.items.data[0]?.price.id ?? null,
				status: sub.status,
				initialPaymentId: initial.id,
				feeSnapshot: initial.feeSnapshot,
				cancelAtPeriodEnd: sub.cancel_at_period_end,
			})
			.onConflictDoNothing();
		await db
			.update(payments)
			.set({ subscriptionId: id })
			.where(eq(payments.id, initial.id));
		[known] = await db
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, id));
	}
	if (!known || known.livemode !== config.livemode)
		throw new Error('Subscription environment mismatch.');
	// Claim in an autocommitted statement, then fetch outside any transaction.
	// Database time controls expiry and a monotonic fence invalidates a slow old
	// response after a new worker acquires the lease. Host clocks are not ordering.
	const [lease] = await db
		.update(paymentSubscriptions)
		.set({
			providerReadRevision: sql`${paymentSubscriptions.providerReadRevision} + 1`,
			providerReadLeaseUntil: sql`now() + interval '90 seconds'`,
		})
		.where(
			and(
				eq(paymentSubscriptions.id, id),
				eq(paymentSubscriptions.livemode, config.livemode),
				sql`(${paymentSubscriptions.providerReadLeaseUntil} IS NULL OR ${paymentSubscriptions.providerReadLeaseUntil} <= now())`,
			),
		)
		.returning({ revision: paymentSubscriptions.providerReadRevision });
	if (!lease)
		throw new Error(
			'Subscription observation is already in progress; retry reconciliation.',
		);
	try {
		const sub = await stripeClient().subscriptions.retrieve(id);
		if (sub.id !== id || sub.livemode !== config.livemode)
			throw new Error('Subscription environment mismatch.');
		return await applySubscriptionObservation(sub, lease.revision);
	} finally {
		await db
			.update(paymentSubscriptions)
			.set({ providerReadLeaseUntil: null })
			.where(
				and(
					eq(paymentSubscriptions.id, id),
					eq(
						paymentSubscriptions.providerReadRevision,
						lease.revision,
					),
				),
			);
	}
}

async function applySubscriptionObservation(
	sub: Stripe.Subscription,
	revision: number,
) {
	const id = sub.id;
	const item = sub.items.data.length === 1 ? sub.items.data[0] : undefined;
	const snapshot = {
		status: sub.status,
		cancelAtPeriodEnd: sub.cancel_at_period_end,
		priceId: item?.price.id ?? null,
		itemId: item?.id ?? null,
		periodStart: item ? new Date(item.current_period_start * 1000) : null,
		periodEnd: item ? new Date(item.current_period_end * 1000) : null,
		scheduleId: stripeId(sub.schedule),
		latestInvoiceId: stripeId(sub.latest_invoice),
		pendingUpdateExpiresAt:
			sub.pending_update ?
				new Date(sub.pending_update.expires_at * 1000)
			:	null,
	};
	const updated = await db.transaction(async (tx) => {
		const [previous] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, id))
			.for('update');
		if (!previous) return null;
		if (
			sub.customer_account !== previous.accountId ||
			sub.livemode !== previous.livemode
		)
			throw new Error('Subscription ownership mismatch.');
		if (
			previous.providerReadRevision !== revision ||
			!previous.providerReadLeaseUntil
		)
			throw new Error(
				'Subscription observation lease was superseded; retry reconciliation.',
			);
		const changed = Object.entries(snapshot).some(([key, value]) => {
			const prior = previous[key as keyof typeof snapshot];
			return (
				(prior instanceof Date ? prior.getTime() : prior) !==
				(value instanceof Date ? value.getTime() : value)
			);
		});
		const [updated] = await tx
			.update(paymentSubscriptions)
			.set({
				...snapshot,
				providerObservedAt: sql`now()`,
				changeRevision: previous.changeRevision + (changed ? 1 : 0),
			})
			.where(eq(paymentSubscriptions.id, id))
			.returning();
		if (previous.status !== sub.status)
			await recordEvent(
				{
					actorId: previous.actorId,
					entityType: 'subscription',
					entityId: id,
					action:
						sub.status === 'canceled' ?
							'subscription.ended'
						:	'subscription.status_changed',
					outcome: 'success',
					details: {
						oldStatus: previous.status,
						newStatus: sub.status,
						tier: previous.tier,
						kind: previous.kind,
					},
				},
				tx,
			);
		return updated ?? null;
	});
	// A paid proration is recognition only after observing that exact invoice's
	// subscription update applied. Never hold the subscription lock while touching
	// coverage rows: refund handlers acquire payment then subscription locks.
	if (updated && item && !sub.pending_update && snapshot.latestInvoiceId) {
		const applied = await db
			.update(supporterPaidCoverage)
			.set({ appliedAt: new Date() })
			.where(
				and(
					eq(supporterPaidCoverage.subscriptionId, id),
					eq(
						supporterPaidCoverage.invoiceId,
						snapshot.latestInvoiceId,
					),
					eq(supporterPaidCoverage.priceId, item.price.id),
					eq(supporterPaidCoverage.itemId, item.id),
					eq(supporterPaidCoverage.livemode, sub.livemode),
					eq(supporterPaidCoverage.proration, true),
					gte(
						supporterPaidCoverage.periodStart,
						new Date(item.current_period_start * 1000),
					),
					eq(
						supporterPaidCoverage.periodEnd,
						new Date(item.current_period_end * 1000),
					),
					isNull(supporterPaidCoverage.appliedAt),
				),
			)
			.returning({ id: supporterPaidCoverage.invoiceLineId });
		if (applied.length)
			await db.transaction((tx) => refreshSupporterEntitlement(tx, id));
	}
	return updated;
}

export async function reconcileInvoice(invoiceId: string) {
	const invoice = await stripeClient().invoices.retrieve(invoiceId);
	if (invoice.livemode !== paymentConfiguration().livemode)
		throw new Error('Invoice environment mismatch.');
	const subscriptionId = stripeId(
		invoice.parent?.subscription_details?.subscription,
	);
	if (!subscriptionId) return;
	const subscription = await synchronizeSubscription(subscriptionId);
	if (!subscription || invoice.customer_account !== subscription.accountId)
		return;
	if (invoice.status !== 'paid') return;
	const lines: Stripe.InvoiceLineItem[] = [];
	for await (const line of stripeClient().invoices.listLineItems(invoiceId, {
		limit: 100,
	}))
		lines.push(line);
	const coverage =
		subscription.kind === 'supporter' && invoice.amount_paid > 0 ?
			verifiedSupporterLines(lines, {
				invoiceId,
				subscriptionId,
				livemode: invoice.livemode,
				supporterPriceId: process.env['STRIPE_SUPPORTER_PRICE_ID'],
				sustainerPriceId: process.env['STRIPE_SUSTAINER_PRICE_ID'],
			})
		:	[];
	const item = selectPaidSubscriptionLine(
		lines,
		subscription.kind === 'fund' ? subscription.priceId : null,
	);
	if (!item && invoice.amount_paid > 0)
		throw new Error('No positive subscription coverage line found.');
	const priceId = stripeId(item?.pricing?.price_details?.price);
	const tier =
		coverage.some((line) => line.tier === 'sustainer') ? 'sustainer'
		: coverage.some((line) => line.tier === 'supporter') ? 'supporter'
		: priceId === process.env['STRIPE_SUSTAINER_PRICE_ID'] ? 'sustainer'
		: priceId === process.env['STRIPE_SUPPORTER_PRICE_ID'] ? 'supporter'
		: subscription.tier;
	if (invoice.amount_paid <= 0) {
		// Customer-balance credits can originate outside verified payments. They need
		// financial review, never an automatic free entitlement from a paid-status flag.
		await db
			.insert(paymentCases)
			.values({
				key: `invoice-credit:${invoiceId}`,
				category: 'invoice_reconciliation',
				summary:
					'Zero-payment or customer-credit invoice needs entitlement review; no paid access was granted.',
				stripeObjectId: invoiceId,
			})
			.onConflictDoNothing();
		return;
	}
	const invoicePayments = await stripeClient().invoicePayments.list({
		invoice: invoiceId,
		status: 'paid',
		limit: 10,
	});
	const invoicePayment = invoicePayments.data.find(
		(p) => p.payment.type === 'payment_intent',
	);
	const intentId = stripeId(invoicePayment?.payment.payment_intent);
	if (
		!intentId ||
		invoicePayments.has_more ||
		invoicePayments.data.length !== 1 ||
		invoicePayment?.amount_paid !== invoice.amount_paid
	) {
		await db
			.insert(paymentCases)
			.values({
				key: `invoice:${invoiceId}`,
				category: 'invoice_reconciliation',
				summary:
					'Invoice uses an unsupported split or non-Stripe payment; manual financial reconciliation required.',
				stripeObjectId: invoiceId,
			})
			.onConflictDoNothing();
		return;
	}
	let [payment] = await db
		.select()
		.from(payments)
		.where(eq(payments.invoiceId, invoiceId));
	if (!payment) {
		const [initial] = await db
			.select()
			.from(payments)
			.where(eq(payments.id, subscription.initialPaymentId));
		if (!initial) throw new Error('Missing subscription checkout.');
		if (
			!initial.invoiceId &&
			invoice.billing_reason === 'subscription_create'
		) {
			await db
				.update(payments)
				.set({ invoiceId, paymentIntentId: intentId, subscriptionId })
				.where(eq(payments.id, initial.id));
			payment = initial;
		} else {
			const quote =
				subscription.kind === 'fund' ?
					quotePayment(invoice.amount_paid, subscription.feeSnapshot)
				:	{
						grossAmount: invoice.amount_paid,
						platformFee: invoice.amount_paid,
						processingEstimate: 0,
						recipientAmount: 0,
					};
			await db
				.insert(payments)
				.values({
					id: randomUUID(),
					actorId: subscription.actorId,
					kind: subscription.kind,
					fundId: subscription.fundId,
					tier,
					recurring: true,
					livemode: invoice.livemode,
					requestHash: 'recurring-invoice',
					...quote,
					feeSnapshot: subscription.feeSnapshot,
					invoiceId,
					paymentIntentId: intentId,
					subscriptionId,
					expiresAt: new Date(),
					status: 'pending',
				})
				.onConflictDoNothing({ target: payments.invoiceId });
			[payment] = await db
				.select()
				.from(payments)
				.where(eq(payments.invoiceId, invoiceId));
		}
	}
	await reconcilePaymentIntent(intentId);
	if (subscription.kind === 'supporter') {
		if (!payment) throw new Error('Missing settled invoice payment.');
		const provenLines = await appliedSupporterInvoiceLines({
			subscriptionId,
			accountId: subscription.accountId,
			invoiceId,
			livemode: subscription.livemode,
			lines: coverage,
		});
		await db.transaction(async (tx) => {
			await recordPaidCoverage(
				tx,
				payment.id,
				coverage,
				(line) =>
					!line.proration ||
					provenLines.has(line.invoiceLineId) ||
					(!subscription.pendingUpdateExpiresAt &&
						subscription.latestInvoiceId === invoiceId &&
						subscription.itemId === line.itemId &&
						subscription.priceId === line.priceId &&
						Boolean(
							subscription.periodStart &&
							line.periodStart >= subscription.periodStart,
						) &&
						subscription.periodEnd?.getTime() ===
							line.periodEnd.getTime()),
			);
			await refreshSupporterEntitlement(tx, subscriptionId);
		});
	}
}

export async function cancelCheckout(userId: string, id: string) {
	const [payment] = await db
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.id, id),
				eq(payments.actorId, userId),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	if (!payment) throw new TRPCError({ code: 'NOT_FOUND' });
	if (!payment.checkoutId)
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'Checkout creation is being reconciled.',
		});
	const session = await stripeClient().checkout.sessions.retrieve(
		payment.checkoutId,
	);
	if (session.status === 'open')
		await stripeClient().checkout.sessions.expire(
			session.id,
			{},
			{ idempotencyKey: `expire:${session.id}` },
		);
	await reconcileCheckout(payment.checkoutId);
	return { canceled: session.status !== 'complete' };
}
