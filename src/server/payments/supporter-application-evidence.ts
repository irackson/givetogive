import 'server-only';
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import {
	paymentAccounts,
	paymentSubscriptions,
	supporterApplicationEvidence,
} from '@/server/db/payments-schema';
import { paymentConfiguration } from './config';
import type { PaymentTransaction } from './ledger';
import {
	applicationProofFromEvent,
	applicationProvesLine,
	applicationSubscriptionId,
	sameApplicationProof,
	type ApplicationInvoiceLine,
} from './supporter-application-policy';

type Connection = typeof db | PaymentTransaction;

async function ownedSubscription(
	subscriptionId: string,
	livemode: boolean,
	connection: Connection,
) {
	const [owner] = await connection
		.select({
			actorId: paymentSubscriptions.actorId,
			subscriptionId: paymentSubscriptions.id,
			accountId: paymentSubscriptions.accountId,
			livemode: paymentSubscriptions.livemode,
		})
		.from(paymentSubscriptions)
		.innerJoin(
			paymentAccounts,
			and(
				eq(paymentAccounts.userId, paymentSubscriptions.actorId),
				eq(
					paymentAccounts.stripeAccountId,
					paymentSubscriptions.accountId,
				),
				eq(paymentAccounts.livemode, paymentSubscriptions.livemode),
			),
		)
		.where(
			and(
				eq(paymentSubscriptions.id, subscriptionId),
				eq(paymentSubscriptions.livemode, livemode),
				eq(paymentSubscriptions.kind, 'supporter'),
			),
		)
		.limit(1);
	return owner;
}

/** SECURITY: call only after HMAC/account/mode verification, or for an exact authenticated
 * provider event retrieved by an already-owned inbox ID. Never accept browser events. */
export async function captureSupporterApplication(
	event: Stripe.Event,
	connection: Connection = db,
): Promise<{ captured: boolean }> {
	const subscriptionId = applicationSubscriptionId(event);
	if (!subscriptionId) return { captured: false };
	const config = paymentConfiguration();
	if (
		event.livemode !== config.livemode ||
		!config.platformAccountId ||
		(event.account !== undefined &&
			event.account !== config.platformAccountId)
	)
		throw new Error('Supporter application platform or mode mismatch.');
	// Unrelated Stripe resources remain valid inbox events, but cannot produce evidence.
	const owner = await ownedSubscription(
		subscriptionId,
		event.livemode,
		connection,
	);
	if (!owner) return { captured: false };
	const proof = applicationProofFromEvent(
		event,
		owner,
		config.platformAccountId,
	);
	await connection
		.insert(supporterApplicationEvidence)
		.values(proof)
		.onConflictDoNothing();
	const [existing] = await connection
		.select()
		.from(supporterApplicationEvidence)
		.where(
			and(
				eq(supporterApplicationEvidence.stripeEventId, event.id),
				eq(supporterApplicationEvidence.livemode, event.livemode),
			),
		)
		.limit(1);
	if (!existing || !sameApplicationProof(existing, proof))
		throw new Error('Supporter application evidence replay conflict.');
	return { captured: true };
}

/** Durable retries need not re-fetch events after Stripe's retention period. */
export async function getStoredSupporterApplication(
	eventId: string,
	subscriptionId: string,
	livemode: boolean,
	connection: Connection = db,
): Promise<{ invoiceId: string } | null> {
	const config = paymentConfiguration();
	if (livemode !== config.livemode || !config.platformAccountId) return null;
	const owner = await ownedSubscription(subscriptionId, livemode, connection);
	if (!owner) return null;
	const [proof] = await connection
		.select({ invoiceId: supporterApplicationEvidence.invoiceId })
		.from(supporterApplicationEvidence)
		.where(
			and(
				eq(supporterApplicationEvidence.stripeEventId, eventId),
				eq(supporterApplicationEvidence.subscriptionId, subscriptionId),
				eq(supporterApplicationEvidence.actorId, owner.actorId),
				eq(supporterApplicationEvidence.accountId, owner.accountId),
				eq(supporterApplicationEvidence.livemode, livemode),
				eq(
					supporterApplicationEvidence.platformAccountId,
					config.platformAccountId,
				),
			),
		)
		.limit(1);
	return proof ?? null;
}

export async function appliedSupporterInvoiceLines(
	input: {
		subscriptionId: string;
		accountId: string;
		invoiceId: string;
		livemode: boolean;
		lines: readonly ApplicationInvoiceLine[];
	},
	connection: Connection = db,
): Promise<Set<string>> {
	const config = paymentConfiguration();
	if (input.livemode !== config.livemode || !config.platformAccountId)
		return new Set();
	const owner = await ownedSubscription(
		input.subscriptionId,
		input.livemode,
		connection,
	);
	if (!owner || owner.accountId !== input.accountId) return new Set();
	const proofs = await connection
		.select()
		.from(supporterApplicationEvidence)
		.where(
			and(
				eq(
					supporterApplicationEvidence.subscriptionId,
					owner.subscriptionId,
				),
				eq(supporterApplicationEvidence.actorId, owner.actorId),
				eq(supporterApplicationEvidence.accountId, input.accountId),
				eq(supporterApplicationEvidence.invoiceId, input.invoiceId),
				eq(supporterApplicationEvidence.livemode, input.livemode),
				eq(
					supporterApplicationEvidence.platformAccountId,
					config.platformAccountId,
				),
			),
		);
	return new Set(
		input.lines
			.filter((line) =>
				proofs.some((proof) => applicationProvesLine(proof, line)),
			)
			.map((line) => line.invoiceLineId),
	);
}
