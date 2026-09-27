/** Isolated ownership/authentication tests; every Stripe call is an explicit stub. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after, mock } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import type Stripe from 'stripe';
import { TRPCError } from '@trpc/server';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	communityFunds,
	paymentAccounts,
	payments,
	paymentSubscriptions,
	paymentLedger,
} from '../../src/server/db/payments-schema.ts';
import { billingRouter } from '../../src/server/api/routers/billing.ts';
import { sessionContexts } from '../../src/server/auth/session-policy.ts';
import { clearRateLimit } from '../../src/server/auth/rate-limit.ts';
import { recordEvent } from '../../src/server/observability/events.ts';
import { createFundCancellationPortal } from '../../src/server/payments/fund-cancellation.ts';
import { publicPaymentConfiguration } from '../../src/server/payments/config.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const run = randomUUID();
const fundId = randomUUID();
const actors = [randomUUID(), randomUUID()];
const paymentIds = [randomUUID(), randomUUID()];
const fixtureName = `CI fund cancellation ${run}`;
const subscriptionId = (id: string) =>
	`sub_ciFundCancel${id.replaceAll('-', '')}`;
const accountId = (id: string) => `acct_ciFundCancel${id.replaceAll('-', '')}`;
const headers = new Headers();
const feeSnapshot = {
	version: `ci-fund-cancel:${run}`,
	platformBps: 0,
	processingBps: 0,
	processingFixed: 0,
};
const configuration = {
	id: 'bpc_ciCancelOnly',
	active: true,
	livemode: false,
	login_page: { enabled: false },
	features: {
		customer_update: { enabled: false, allowed_updates: [] },
		invoice_history: { enabled: false },
		payment_method_update: { enabled: false },
		subscription_pause: { enabled: false },
		subscription_update: { enabled: false, default_allowed_updates: [] },
		subscription_cancel: {
			enabled: true,
			mode: 'at_period_end',
			proration_behavior: 'none',
		},
	},
};
let policy = structuredClone(configuration);
let ready = false;
let reads = 0;
let creates = 0;
let badProviderAccount = false;
let badHandoff = false;
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	process.env['STRIPE_SECRET_KEY'] = [
		'rk',
		'test',
		'fund_cancel_stub_no_network',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ciFundCancelPlatform';
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	process.env['STRIPE_PORTAL_CONFIGURATION_ID'] = 'bpc_ciGeneral';
	process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] =
		configuration.id;
	process.env['FUNDS_ENABLED'] = 'false';
	delete process.env['STRIPE_PUBLISHABLE_KEY'];
	await db.transaction(async (tx) => {
		await tx
			.insert(users)
			.values(
				actors.map((id, index) => ({
					id,
					name: fixtureName,
					email: `${id}@example.invalid`,
					emailVerified: new Date(),
					isSynthetic: true,
					sessionVersion: 7,
					frozenAt: index === 0 ? new Date() : null,
				})),
			);
		await tx
			.insert(communityFunds)
			.values({
				id: fundId,
				slug: `ci-fund-cancel-${run}`,
				name: fixtureName,
				description:
					'Isolated cancellation fixture, no real provider records.',
				active: false,
				createdById: actors[0]!,
			});
		for (const [index, id] of actors.entries()) {
			await tx
				.insert(paymentAccounts)
				.values({
					userId: id,
					stripeAccountId: accountId(id),
					livemode: false,
				});
			await tx
				.insert(payments)
				.values({
					id: paymentIds[index]!,
					actorId: id,
					subscriptionId: subscriptionId(id),
					kind: 'fund',
					fundId,
					recurring: true,
					livemode: false,
					requestHash: run,
					status: 'expired',
					grossAmount: 500,
					platformFee: 0,
					processingEstimate: 0,
					recipientAmount: 500,
					feeSnapshot,
					expiresAt: new Date(),
				});
			await tx
				.insert(paymentSubscriptions)
				.values({
					id: subscriptionId(id),
					actorId: id,
					accountId: accountId(id),
					kind: 'fund',
					fundId,
					status: 'active',
					livemode: false,
					initialPaymentId: paymentIds[index]!,
					feeSnapshot,
				});
		}
	});
	ready = true;
	const stripe = stripeClient();
	mock.method(stripe.billingPortal.configurations, 'retrieve', () => {
		reads++;
		return Promise.resolve(structuredClone(policy));
	});
	mock.method(stripe.subscriptions, 'retrieve', (id: string) => {
		reads++;
		const actor = actors.find(
			(candidate) => subscriptionId(candidate) === id,
		);
		assert.ok(actor, 'Only exact synthetic provider IDs may be retrieved');
		return Promise.resolve({
			id,
			livemode: false,
			customer_account:
				badProviderAccount ? 'acct_wrong' : accountId(actor),
			status: 'past_due',
			cancel_at_period_end: false,
			cancel_at: null,
			schedule: null,
			pending_update: null,
		});
	});
	mock.method(
		stripe.billingPortal.sessions,
		'create',
		(params: Stripe.BillingPortal.SessionCreateParams) => {
			creates++;
			assert.equal(params.configuration, configuration.id);
			assert.equal(params.flow_data?.type, 'subscription_cancel');
			assert.equal(params.flow_data.after_completion?.type, 'redirect');
			assert.equal(params.flow_data.subscription_update, undefined);
			assert.equal(
				params.flow_data.subscription_cancel?.retention,
				undefined,
			);
			assert.equal(
				params.flow_data.after_completion.redirect?.return_url,
				params.return_url,
			);
			return Promise.resolve({
				id: `bps_ciFundCancel${randomUUID().replaceAll('-', '')}`,
				customer_account: params.customer_account,
				configuration: params.configuration,
				livemode: false,
				return_url: params.return_url,
				url: 'https://billing.stripe.com/p/session/test_synthetic',
				flow: {
					...params.flow_data,
					type:
						badHandoff ?
							'payment_method_update'
						:	'subscription_cancel',
					subscription_cancel: {
						...params.flow_data.subscription_cancel,
						retention: null,
					},
				},
			});
		},
	);
	const unexpected = () => {
		throw new Error('Unexpected provider mutation');
	};
	mock.method(stripe.subscriptions, 'update', unexpected);
	mock.method(stripe.subscriptions, 'cancel', unexpected);
	mock.method(stripe.v2.core.accounts, 'create', unexpected);
});

after(async () => {
	try {
		if (ready) {
			await verifyIsolatedTarget(
				db.$client,
				isolatedConfiguration(process.env, 'test'),
			);
			for (const [index, id] of actors.entries()) {
				await clearRateLimit('fund-cancel-portal', id, headers);
				await db.transaction(async (tx) => {
					const [actor] = await tx
						.select()
						.from(users)
						.where(eq(users.id, id))
						.for('update');
					const [subscription] = await tx
						.select()
						.from(paymentSubscriptions)
						.where(eq(paymentSubscriptions.id, subscriptionId(id)))
						.for('update');
					const [payment] = await tx
						.select()
						.from(payments)
						.where(eq(payments.id, paymentIds[index]!))
						.for('update');
					assert.ok(
						actor?.isSynthetic &&
							actor.name === fixtureName &&
							actor.email === `${id}@example.invalid`,
					);
					assert.ok(subscription && payment);
					assert.equal(subscription.actorId, id);
					assert.equal(subscription.accountId, accountId(id));
					assert.equal(subscription.initialPaymentId, payment.id);
					assert.equal(subscription.livemode, false);
					assert.equal(subscription.fundId, fundId);
					assert.equal(subscription.kind, 'fund');
					assert.equal(payment.actorId, id);
					assert.equal(payment.subscriptionId, subscription.id);
					assert.equal(payment.requestHash, run);
					assert.equal(payment.status, 'expired');
					assert.equal(payment.livemode, false);
					assert.deepEqual(payment.feeSnapshot, feeSnapshot);
					assert.deepEqual(subscription.feeSnapshot, feeSnapshot);
					for (const value of [
						payment.checkoutId,
						payment.checkoutUrl,
						payment.paymentIntentId,
						payment.chargeId,
						payment.invoiceId,
						payment.transferId,
						payment.receiptUrl,
						payment.paidAt,
						subscription.latestInvoiceId,
						subscription.scheduleId,
						subscription.itemId,
						subscription.priceId,
						subscription.paidThrough,
					])
						assert.equal(value, null);
					assert.equal(
						(
							await tx
								.select()
								.from(paymentLedger)
								.where(eq(paymentLedger.paymentId, payment.id))
						).length,
						0,
					);
					await tx
						.update(paymentSubscriptions)
						.set({
							status: 'canceled',
							activeMutationId: null,
							pendingChangeId: null,
							providerReadLeaseUntil: null,
							providerReadRevision: sql`${paymentSubscriptions.providerReadRevision} + 1`,
						})
						.where(eq(paymentSubscriptions.id, subscription.id));
					await tx
						.update(users)
						.set({
							frozenAt: new Date(),
							sessionVersion: sql`${users.sessionVersion} + 1`,
						})
						.where(eq(users.id, id));
					await recordEvent(
						{
							externalId: `ci-fund-cancel-retired:${id}`,
							actorId: id,
							entityType: 'ci_fixture',
							entityId: id,
							action: 'ci_fund_cancellation_fixture_retired',
							outcome: 'completed',
							summary:
								'Retired isolated fund cancellation stub without provider calls or deletion.',
						},
						tx,
					);
				});
			}
		}
	} finally {
		mock.restoreAll();
		await db.$client.end();
	}
});
function identity(index = 0): Session {
	return {
		access: index === 0 ? 'billing_only' : 'active',
		expires: new Date(Date.now() + 60_000).toISOString(),
		user: {
			id: actors[index]!,
			role: 'member',
			sessionVersion: 7,
			authenticatedAt: Date.now(),
		},
	};
}
const caller = (index = 0) =>
	billingRouter.createCaller({
		db,
		headers,
		...sessionContexts(identity(index)),
	});
const open = (index = 0, target = subscriptionId(actors[index]!)) =>
	createFundCancellationPortal(
		identity(index),
		{ subscriptionId: target },
		headers,
	);
const denied = (error: unknown) =>
	error instanceof TRPCError &&
	['NOT_FOUND', 'UNAUTHORIZED', 'PRECONDITION_FAILED'].includes(error.code);

test('frozen verified member can open cancel-only confirmation with new fund sales off and no local cancellation', async () => {
	assert.equal(publicPaymentConfiguration().funds, false);
	assert.equal(publicPaymentConfiguration().fundCancellation, true);
	assert.equal(
		(
			await caller().createFundCancellationPortal({
				subscriptionId: subscriptionId(actors[0]!),
			})
		).url,
		'https://billing.stripe.com/p/session/test_synthetic',
	);
	const stored = await db.query.paymentSubscriptions.findFirst({
		where: eq(paymentSubscriptions.id, subscriptionId(actors[0]!)),
	});
	assert.equal(stored?.status, 'active');
	assert.equal(stored.cancelAtPeriodEnd, false);
});
test('active member uses the same bounded flow; frozen identity cannot open general Portal', async () => {
	assert.ok((await open(1)).url);
	await assert.rejects(caller().createPortal(), denied);
});
test('foreign target, unknown target and anonymous callers cannot reach provider', async () => {
	const before = { reads, creates };
	await assert.rejects(open(0, subscriptionId(actors[1]!)), denied);
	await assert.rejects(open(0, 'sub_missing'), denied);
	await assert.rejects(
		billingRouter
			.createCaller({ db, headers, session: null, billingSession: null })
			.createFundCancellationPortal({
				subscriptionId: subscriptionId(actors[0]!),
			}),
		denied,
	);
	assert.deepEqual({ reads, creates }, before);
});
test('missing, shared, broad or pause-enabled configuration fails closed before session creation', async () => {
	const count = creates;
	try {
		delete process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'];
		assert.equal(publicPaymentConfiguration().fundCancellation, false);
		await assert.rejects(open(), denied);
		process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] =
			'bpc_ciGeneral';
		await assert.rejects(open(), denied);
		process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] =
			configuration.id;
		policy.features.payment_method_update.enabled = true;
		await assert.rejects(open(), denied);
		policy = structuredClone(configuration);
		policy.features.subscription_pause.enabled = true;
		await assert.rejects(open(), denied);
		assert.equal(creates, count);
	} finally {
		process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'] =
			configuration.id;
		policy = structuredClone(configuration);
	}
});
test('first-class stored/provider ownership and returned hosted flow are verified', async () => {
	const count = creates;
	try {
		badProviderAccount = true;
		await assert.rejects(open(), denied);
	} finally {
		badProviderAccount = false;
	}
	const id = subscriptionId(actors[0]!);
	try {
		await db
			.update(paymentSubscriptions)
			.set({ accountId: accountId(actors[1]!) })
			.where(eq(paymentSubscriptions.id, id));
		await assert.rejects(open(), denied);
	} finally {
		await db
			.update(paymentSubscriptions)
			.set({ accountId: accountId(actors[0]!) })
			.where(eq(paymentSubscriptions.id, id));
	}
	assert.equal(creates, count);
	try {
		badHandoff = true;
		await assert.rejects(open(), denied);
	} finally {
		badHandoff = false;
	}
});
test('revoked/unverified identity, already-ending subscription and other subscription kinds are denied', async () => {
	const actorId = actors[0]!;
	const id = subscriptionId(actorId);
	try {
		await db
			.update(users)
			.set({ sessionVersion: 8 })
			.where(eq(users.id, actorId));
		await assert.rejects(open(), denied);
	} finally {
		await db
			.update(users)
			.set({ sessionVersion: 7 })
			.where(eq(users.id, actorId));
	}
	try {
		await db
			.update(users)
			.set({ emailVerified: null })
			.where(eq(users.id, actorId));
		await assert.rejects(open(), denied);
	} finally {
		await db
			.update(users)
			.set({ emailVerified: new Date() })
			.where(eq(users.id, actorId));
	}
	try {
		await db
			.update(paymentSubscriptions)
			.set({ cancelAtPeriodEnd: true })
			.where(eq(paymentSubscriptions.id, id));
		await assert.rejects(open(), denied);
	} finally {
		await db
			.update(paymentSubscriptions)
			.set({ cancelAtPeriodEnd: false })
			.where(eq(paymentSubscriptions.id, id));
	}
	try {
		await db
			.update(paymentSubscriptions)
			.set({ kind: 'supporter' })
			.where(eq(paymentSubscriptions.id, id));
		await assert.rejects(open(), denied);
	} finally {
		await db
			.update(paymentSubscriptions)
			.set({ kind: 'fund' })
			.where(eq(paymentSubscriptions.id, id));
	}
});
