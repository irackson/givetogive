import { and, eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/server/db';
import {
	paymentAccounts,
	paymentCases,
	paymentWebhookInbox,
	payments,
	paymentSubscriptions,
	supporterChanges,
} from '@/server/db/payments-schema';
import { refreshRecipientAccount } from './accounts';
import { paymentConfiguration } from './config';
import {
	reconcileCheckout,
	reconcileInvoice,
	reconcilePaymentIntent,
	reconcileCharge,
	synchronizeSubscription,
} from './reconcile';
import { processRefund, reconcileDispute } from './refunds';
import { paymentErrorCode, stripeClient, stripeId } from './stripe';
import { reconcileSupporterChangesForSubscription } from './recovery';

const SUPPORTED_PREFIXES = [
	'checkout.session.',
	'payment_intent.',
	'customer.subscription.',
	'subscription_schedule.',
	'invoice.',
	'charge.refunded',
	'charge.updated',
	'charge.dispute.',
	'refund.',
	'payout.failed',
	'account.updated',
	'v2.core.account.',
	'v2.core.account[',
];

/** Derive billing ownership from Stripe's object graph and existing local mappings.
 * Schedule cancellation can clear subscription; only a previously persisted exact
 * schedule mapping may recover that case. Metadata never establishes ownership.
 */
export async function supporterWebhookSubscription(
	family: 'invoice' | 'schedule',
	objectId: string,
	livemode: boolean,
	executor: Pick<typeof db, 'select' | 'selectDistinct'> = db,
) {
	let subscriptionId: string | null;
	let accountId: string | null;
	if (family === 'invoice') {
		const invoice = await stripeClient().invoices.retrieve(objectId);
		if (invoice.id !== objectId || invoice.livemode !== livemode)
			throw new Error('Invoice event ownership mismatch.');
		subscriptionId = stripeId(
			invoice.parent?.subscription_details?.subscription,
		);
		accountId = invoice.customer_account;
	} else {
		const schedule =
			await stripeClient().subscriptionSchedules.retrieve(objectId);
		if (schedule.id !== objectId || schedule.livemode !== livemode)
			throw new Error('Schedule event ownership mismatch.');
		accountId = schedule.customer_account;
		subscriptionId =
			stripeId(schedule.subscription) ?? schedule.released_subscription;
		if (
			!subscriptionId &&
			['canceled', 'completed'].includes(schedule.status)
		) {
			const known = await executor
				.selectDistinct({
					subscriptionId: supporterChanges.subscriptionId,
				})
				.from(supporterChanges)
				.where(
					and(
						eq(supporterChanges.scheduleId, objectId),
						eq(supporterChanges.livemode, livemode),
					),
				)
				.limit(2);
			if (known.length === 1) subscriptionId = known[0]!.subscriptionId;
		}
	}
	if (!subscriptionId || !accountId) return null;
	const [known] = await executor
		.select({
			id: paymentSubscriptions.id,
			accountId: paymentSubscriptions.accountId,
		})
		.from(paymentSubscriptions)
		.where(
			and(
				eq(paymentSubscriptions.id, subscriptionId),
				eq(paymentSubscriptions.livemode, livemode),
				eq(paymentSubscriptions.kind, 'supporter'),
			),
		)
		.limit(1);
	if (!known) return null;
	if (known.accountId !== accountId)
		throw new Error('Subscription event account mismatch.');
	return known.id;
}

type ApplicationInboxEvent = Pick<
	typeof paymentWebhookInbox.$inferSelect,
	'stripeEventId' | 'stripeAccountId' | 'objectId' | 'type' | 'livemode'
>;
type ApplicationEvidenceServices = {
	getStored: (
		eventId: string,
		subscriptionId: string,
		livemode: boolean,
	) => Promise<{ invoiceId: string } | null>;
	capture: (event: Stripe.Event) => Promise<{ captured: boolean }>;
	retrieve: (eventId: string) => Promise<Stripe.Event>;
};

/** An exact authenticated inbox tuple is the only permission to retrieve an event.
 * Stored, owned evidence remains usable after Stripe's event-retention window.
 */
export async function supporterApplicationInvoice(
	event: ApplicationInboxEvent,
	services?: ApplicationEvidenceServices,
) {
	const config = paymentConfiguration();
	if (
		event.type !== 'customer.subscription.pending_update_applied' ||
		event.livemode !== config.livemode ||
		event.stripeAccountId !== config.platformAccountId
	)
		throw new Error('Stored application event ownership mismatch.');
	if (!services) {
		const { captureSupporterApplication, getStoredSupporterApplication } =
			await import('./supporter-application-evidence');
		services = {
			getStored: getStoredSupporterApplication,
			capture: captureSupporterApplication,
			retrieve: (eventId) => stripeClient().events.retrieve(eventId),
		};
	}
	const args = [event.stripeEventId, event.objectId, event.livemode] as const;
	const stored = await services.getStored(...args);
	if (stored) return stored.invoiceId;
	// Capture may initially precede the Checkout mapping. Retrieve only this known
	// event on retry, never search arbitrary events or trust browser-supplied data.
	const snapshot = await services.retrieve(event.stripeEventId);
	if (
		snapshot.id !== event.stripeEventId ||
		snapshot.type !== event.type ||
		snapshot.livemode !== event.livemode ||
		(snapshot.account ?? config.platformAccountId) !==
			event.stripeAccountId ||
		snapshot.data.object.id !== event.objectId
	)
		throw new Error('Stored application event ownership mismatch.');
	await services.capture(snapshot);
	return (await services.getStored(...args))?.invoiceId ?? null;
}

export async function acceptStripeWebhook(
	payload: string,
	signature: string,
	thin = false,
	connected = false,
) {
	const config = paymentConfiguration();
	if (thin && connected) throw new Error('Webhook source is ambiguous.');
	const secret =
		process.env[
			thin ? 'STRIPE_V2_WEBHOOK_SECRET'
			: connected ? 'STRIPE_CONNECT_WEBHOOK_SECRET'
			: 'STRIPE_WEBHOOK_SECRET'
		];
	if (!secret) throw new Error('Webhook signing secret is missing.');
	let id: string,
		type: string,
		objectId: string,
		accountId: string,
		livemode: boolean;
	let snapshot: Stripe.Event | null = null;
	if (thin) {
		const notification = stripeClient().parseEventNotification(
			payload,
			signature,
			secret,
		);
		const event = await stripeClient().v2.core.events.retrieve(
			notification.id,
		);
		id = event.id;
		type = event.type;
		livemode = event.livemode;
		objectId =
			'related_object' in event ? (event.related_object?.id ?? '') : '';
		accountId = config.platformAccountId;
	} else {
		const event = stripeClient().webhooks.constructEvent(
			payload,
			signature,
			secret,
		);
		snapshot = event;
		id = event.id;
		type = event.type;
		livemode = event.livemode;
		objectId =
			'id' in event.data.object ? String(event.data.object.id) : '';
		if (connected && !event.account)
			throw new Error('Connected webhook requires an account context.');
		accountId = event.account ?? config.platformAccountId;
	}
	if (livemode !== config.livemode)
		throw new Error('Webhook environment mismatch.');
	if (connected && accountId === config.platformAccountId)
		throw new Error('Connected webhook cannot use the platform account.');
	if (accountId !== config.platformAccountId) {
		const [known] = await db
			.select()
			.from(paymentAccounts)
			.where(
				and(
					eq(paymentAccounts.stripeAccountId, accountId),
					eq(paymentAccounts.livemode, livemode),
				),
			);
		if (!known)
			throw new Error(
				'Webhook account is not associated with this application.',
			);
		// Our charges/subscriptions are platform-owned. Connected-account events only
		// update account/payout state; they cannot masquerade as platform payments.
		if (!['payout.failed', 'account.updated'].includes(type)) return null;
	}
	if (
		!objectId ||
		!SUPPORTED_PREFIXES.some((prefix) => type.startsWith(prefix))
	)
		return null;
	if (snapshot?.type === 'customer.subscription.pending_update_applied') {
		// This boundary already verified the HMAC, platform ownership and mode.
		// Retain only immutable, locally owned billing evidence, never full payloads.
		const { captureSupporterApplication } =
			await import('./supporter-application-evidence');
		await captureSupporterApplication(snapshot);
	}
	await db
		.insert(paymentWebhookInbox)
		.values({
			stripeEventId: id,
			stripeAccountId: accountId,
			livemode,
			type,
			objectId,
		})
		.onConflictDoNothing();
	const [row] = await db
		.select()
		.from(paymentWebhookInbox)
		.where(
			and(
				eq(paymentWebhookInbox.stripeEventId, id),
				eq(paymentWebhookInbox.stripeAccountId, accountId),
				eq(paymentWebhookInbox.livemode, livemode),
			),
		);
	return row?.id ?? null;
}

export async function processWebhook(id: string) {
	const [event] = await db
		.select()
		.from(paymentWebhookInbox)
		.where(eq(paymentWebhookInbox.id, id));
	if (!event || ['processed', 'ignored'].includes(event.status)) return;
	if (event.livemode !== paymentConfiguration().livemode)
		throw new Error('Stored webhook environment mismatch.');
	await db
		.update(paymentWebhookInbox)
		.set({ attempts: sql`${paymentWebhookInbox.attempts} + 1` })
		.where(eq(paymentWebhookInbox.id, id));
	try {
		if (event.type.startsWith('checkout.session.'))
			await reconcileCheckout(event.objectId);
		else if (event.type.startsWith('payment_intent.'))
			await reconcilePaymentIntent(event.objectId);
		else if (event.type.startsWith('customer.subscription.')) {
			await synchronizeSubscription(event.objectId);
			if (event.type === 'customer.subscription.pending_update_applied') {
				const invoiceId = await supporterApplicationInvoice(event);
				if (invoiceId) await reconcileInvoice(invoiceId);
			}
			await reconcileSupporterChangesForSubscription(event.objectId);
		} else if (event.type.startsWith('invoice.')) {
			await reconcileInvoice(event.objectId);
			const subscriptionId = await supporterWebhookSubscription(
				'invoice',
				event.objectId,
				event.livemode,
			);
			if (subscriptionId)
				await reconcileSupporterChangesForSubscription(subscriptionId);
		} else if (event.type.startsWith('subscription_schedule.')) {
			const subscriptionId = await supporterWebhookSubscription(
				'schedule',
				event.objectId,
				event.livemode,
			);
			if (subscriptionId) {
				await synchronizeSubscription(subscriptionId);
				await reconcileSupporterChangesForSubscription(subscriptionId);
			}
		} else if (event.type.startsWith('charge.dispute.'))
			await reconcileDispute(event.objectId);
		else if (
			event.type === 'charge.refunded' ||
			event.type === 'charge.updated'
		) {
			const charge = await stripeClient().charges.retrieve(
				event.objectId,
				{ expand: ['balance_transaction'] },
			);
			const [payment] = await db
				.select()
				.from(payments)
				.where(eq(payments.chargeId, charge.id));
			if (payment) await reconcileCharge(payment.id, charge);
		} else if (event.type.startsWith('refund.')) {
			const refund = await stripeClient().refunds.retrieve(
				event.objectId,
			);
			const chargeId = stripeId(refund.charge);
			if (chargeId) {
				const [payment] = await db
					.select()
					.from(payments)
					.where(eq(payments.chargeId, chargeId));
				if (payment)
					await reconcileCharge(
						payment.id,
						await stripeClient().charges.retrieve(chargeId, {
							expand: ['balance_transaction'],
						}),
					);
			}
			// Use the first-class refund mapping, never untrusted metadata, for retries.
			const { paymentOperations } =
				await import('@/server/db/payments-schema');
			const [operation] = await db
				.select()
				.from(paymentOperations)
				.where(eq(paymentOperations.stripeObjectId, refund.id));
			if (operation && refund.status === 'succeeded')
				await processRefund(operation.id);
		} else if (
			event.type === 'account.updated' ||
			event.type.startsWith('v2.core.account.') ||
			event.type.startsWith('v2.core.account[')
		) {
			const [account] = await db
				.select()
				.from(paymentAccounts)
				.where(
					and(
						eq(paymentAccounts.stripeAccountId, event.objectId),
						eq(paymentAccounts.livemode, event.livemode),
					),
				);
			if (account?.recipientRequested)
				await refreshRecipientAccount(account.stripeAccountId);
		} else if (event.type === 'payout.failed') {
			await db
				.insert(paymentCases)
				.values({
					key: `payout:${event.objectId}`,
					accountId: event.stripeAccountId,
					category: 'payout_failure',
					summary:
						'Stripe reported a failed payout. Recipient must review bank details in their secure Stripe dashboard.',
					stripeObjectId: event.objectId,
				})
				.onConflictDoNothing();
		}
		await db
			.update(paymentWebhookInbox)
			.set({
				status: 'processed',
				processedAt: new Date(),
				lastError: null,
			})
			.where(eq(paymentWebhookInbox.id, id));
	} catch (error) {
		await db
			.update(paymentWebhookInbox)
			.set({ status: 'failed', lastError: paymentErrorCode(error) })
			.where(eq(paymentWebhookInbox.id, id));
		throw error;
	}
}
