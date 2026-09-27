import 'server-only';
import {
	and,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	notInArray,
	sql,
} from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import {
	apiTokens,
	operationEvents,
	simulationAgents,
	simulationRuns,
	toolOperations,
} from '@/server/db/operations-schema';
import {
	paymentAccounts,
	paymentLedger,
	payments,
	paymentWebhookInbox,
} from '@/server/db/payments-schema';
import { users } from '@/server/db/schema';
import {
	type SimulationActor,
	requireSimulationScope,
} from '@/server/simulation/auth';
import { assertSimulationEnvironment } from '@/server/simulation/guard';
import { simulationScopes } from '@/server/simulation/policy';
import { paymentConfiguration } from './config';
import { stripeClient, stripeId } from './stripe';
import { myOverview } from './queries';
import {
	simulationCheckoutOrigin,
	verifySandboxCheckoutSession,
	verifySandboxPaymentIntent,
} from './simulation-checkout-policy';

async function authorize(actor: SimulationActor) {
	requireSimulationScope(actor, simulationScopes.payments);
	const target = await assertSimulationEnvironment();
	const config = paymentConfiguration();
	if (
		target.origin !== simulationCheckoutOrigin ||
		target.stripeMode !== 'test' ||
		config.environment !== 'staging' ||
		config.origin !== simulationCheckoutOrigin ||
		!config.configured ||
		config.livemode
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	const [member] = await db
		.select({ scopes: apiTokens.scopes })
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.innerJoin(simulationRuns, eq(simulationRuns.id, apiTokens.runId))
		.innerJoin(
			simulationAgents,
			and(
				eq(simulationAgents.runId, apiTokens.runId),
				eq(simulationAgents.userId, apiTokens.userId),
			),
		)
		.where(
			and(
				eq(apiTokens.id, actor.token.id),
				eq(apiTokens.userId, actor.user.id),
				eq(apiTokens.runId, actor.run.id),
				eq(apiTokens.kind, 'agent'),
				eq(apiTokens.environment, 'staging'),
				isNull(apiTokens.revokedAt),
				gt(apiTokens.expiresAt, new Date()),
				eq(apiTokens.sessionVersion, users.sessionVersion),
				eq(users.isSynthetic, true),
				isNull(users.frozenAt),
				isNotNull(users.emailVerified),
				eq(simulationRuns.environment, 'staging'),
				eq(simulationRuns.databaseIdentity, target.databaseIdentity),
				notInArray(simulationRuns.status, [
					'stopped',
					'completed',
					'cancelled',
				]),
			),
		)
		.limit(1);
	if (!member?.scopes.includes(simulationScopes.payments))
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	return { target, config };
}

async function checkoutState(
	actor: SimulationActor,
	operationId: string,
	requireOpen: boolean,
) {
	const authorization = await authorize(actor);
	const [owned] = await db
		.select({
			payment: payments,
			accountId: paymentAccounts.stripeAccountId,
		})
		.from(payments)
		.innerJoin(
			paymentAccounts,
			and(
				eq(paymentAccounts.userId, payments.actorId),
				eq(paymentAccounts.livemode, false),
			),
		)
		.innerJoin(
			toolOperations,
			and(
				eq(toolOperations.actorId, payments.actorId),
				eq(toolOperations.correlationId, sql`${payments.id}::text`),
				eq(toolOperations.tool, 'prepare_checkout'),
				eq(toolOperations.status, 'completed'),
			),
		)
		.innerJoin(
			operationEvents,
			and(
				eq(operationEvents.actorId, payments.actorId),
				eq(operationEvents.correlationId, sql`${payments.id}::text`),
				eq(operationEvents.runId, actor.run.id),
				eq(operationEvents.action, 'prepare_checkout'),
				eq(operationEvents.outcome, 'completed'),
				eq(operationEvents.environment, 'staging'),
			),
		)
		.where(
			and(
				eq(payments.id, operationId),
				eq(payments.actorId, actor.user.id),
				eq(payments.livemode, false),
			),
		)
		.limit(1);
	if (
		!owned?.payment.checkoutId ||
		!/^cs_test_[A-Za-z0-9]+$/.test(owned.payment.checkoutId)
	)
		throw new TRPCError({
			code: 'NOT_FOUND',
			message:
				'A completed, actor-owned test checkout preparation is required.',
		});
	const binding = {
		operationId,
		checkoutId: owned.payment.checkoutId,
		customerAccountId: owned.accountId,
		grossAmount: owned.payment.grossAmount,
		recurring: owned.payment.recurring,
	};
	const session = await stripeClient().checkout.sessions.retrieve(
		binding.checkoutId,
		{ expand: ['payment_intent'] },
	);
	verifySandboxCheckoutSession(session, binding, requireOpen);
	await authorize(actor); // Revocation/freeze during provider retrieval still takes effect.
	return { ...authorization, ...owned, binding, session };
}

/** These private harness reads must never be exposed in the model's tool allowlist or telemetry. */
export async function simulationCheckoutContext(
	actor: SimulationActor,
	operationId: string,
) {
	try {
		const { target, session } = await checkoutState(
			actor,
			operationId,
			true,
		);
		return {
			environment: 'staging' as const,
			databaseIdentity: target.databaseIdentity,
			runId: actor.run.id,
			operationId,
			actorId: actor.user.id,
			sessionId: session.id,
			url: session.url!,
			livemode: false as const,
			currency: 'usd' as const,
			amountTotal: session.amount_total!,
			mode: session.mode,
			status: session.status,
			paymentStatus: session.payment_status,
			expiresAt: session.expires_at,
			returnOrigin: simulationCheckoutOrigin,
			verifiedAt: new Date().toISOString(),
		};
	} catch (error) {
		if (error instanceof TRPCError) throw error;
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'The actor-owned Stripe sandbox checkout could not be verified.',
		});
	}
}

export async function simulationCheckoutOutcome(
	actor: SimulationActor,
	operationId: string,
) {
	try {
		const { session, payment, binding, config } = await checkoutState(
			actor,
			operationId,
			false,
		);
		let intentId =
			stripeId(session.payment_intent) ?? payment.paymentIntentId;
		// Subscription Checkout can expose its failed first invoice before our webhook has a PaymentIntent ID.
		const invoiceId = stripeId(session.invoice) ?? payment.invoiceId;
		if (!intentId && invoiceId) {
			const invoice = await stripeClient().invoices.retrieve(invoiceId);
			if (
				invoice.livemode ||
				invoice.customer_account !== binding.customerAccountId ||
				invoice.currency !== 'usd'
			)
				throw new Error('Sandbox invoice identity does not match.');
			const entries = await stripeClient().invoicePayments.list({
				invoice: invoiceId,
				limit: 10,
			});
			intentId = stripeId(
				entries.data.find(
					(entry) =>
						entry.is_default &&
						entry.payment.type === 'payment_intent',
				)?.payment.payment_intent,
			);
		}
		const intent =
			intentId ?
				(
					typeof session.payment_intent === 'object' &&
					session.payment_intent
				) ?
					session.payment_intent
				:	await stripeClient().paymentIntents.retrieve(intentId)
			:	null;
		if (intent) verifySandboxPaymentIntent(intent, binding);
		const ids = [
			session.id,
			intentId,
			payment.invoiceId,
			stripeId(session.invoice),
		].filter((id): id is string => Boolean(id));
		const [webhook] = await db
			.select({ id: paymentWebhookInbox.id })
			.from(paymentWebhookInbox)
			.where(
				and(
					eq(paymentWebhookInbox.livemode, false),
					eq(
						paymentWebhookInbox.stripeAccountId,
						config.platformAccountId,
					),
					eq(paymentWebhookInbox.status, 'processed'),
					inArray(paymentWebhookInbox.objectId, ids),
					inArray(paymentWebhookInbox.type, [
						'checkout.session.completed',
						'checkout.session.async_payment_succeeded',
						'payment_intent.succeeded',
						'invoice.paid',
					]),
				),
			)
			.limit(1);
		const [journal] = await db
			.select({ id: paymentLedger.id })
			.from(paymentLedger)
			.where(
				and(
					eq(paymentLedger.paymentId, operationId),
					eq(paymentLedger.livemode, false),
				),
			)
			.limit(1);
		const overview = await myOverview(actor.user.id);
		await authorize(actor);
		return {
			operationId,
			actorId: actor.user.id,
			livemode: false as const,
			databaseStatus: payment.status,
			providerPaymentStatus: intent?.status ?? session.payment_status,
			providerErrorCode: intent?.last_payment_error?.code ?? null,
			webhookVerified: Boolean(
				webhook &&
				journal &&
				payment.paidAt &&
				payment.status === 'succeeded',
			),
			effectiveTier: overview.tier,
		};
	} catch (error) {
		if (error instanceof TRPCError) throw error;
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'The actor-owned Stripe sandbox outcome could not be verified.',
		});
	}
}
