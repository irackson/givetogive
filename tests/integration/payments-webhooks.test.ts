/** Signature/inbox verification with real PostgreSQL; provider API is never called. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import Stripe from 'stripe';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import {
	paymentAccounts,
	paymentWebhookInbox,
} from '../../src/server/db/payments-schema.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	acceptStripeWebhook,
	processWebhook,
	supporterApplicationInvoice,
} from '../../src/server/payments/webhooks.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';

const ownedEvents: string[] = [];
const syntheticSigningSecret = 'ci-signing-secret-never-a-real-key';
const connectedSigningSecret = 'ci-connect-signing-secret-never-a-real-key';
const connectedUserId = `ci_webhook_${randomUUID()}`;
const connectedAccountId = `acct_ci_${randomUUID()}`;
const changedKeys = [
	'STRIPE_SECRET_KEY',
	'STRIPE_PLATFORM_ACCOUNT_ID',
	'STRIPE_WEBHOOK_SECRET',
	'STRIPE_V2_WEBHOOK_SECRET',
	'STRIPE_CONNECT_WEBHOOK_SECRET',
	'STRIPE_PROCESSING_BPS',
	'STRIPE_PROCESSING_FIXED_CENTS',
];
const previous = Object.fromEntries(
	changedKeys.map((key) => [key, process.env[key]]),
);

before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	const result = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(result[0]?.name, 'givetogive_ci_20260926');
	assert.equal(result[0]?.role, 'givetogive_ci_20260926');
	process.env['STRIPE_SECRET_KEY'] = [
		'rk',
		'test',
		'synthetic-no-network',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ci_signature_tests';
	process.env['STRIPE_WEBHOOK_SECRET'] = syntheticSigningSecret;
	process.env['STRIPE_V2_WEBHOOK_SECRET'] = syntheticSigningSecret;
	process.env['STRIPE_CONNECT_WEBHOOK_SECRET'] = connectedSigningSecret;
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	await db
		.insert(users)
		.values({
			id: connectedUserId,
			email: `${connectedUserId}@example.test`,
			name: 'Synthetic webhook recipient',
		});
	await db
		.insert(paymentAccounts)
		.values({
			userId: connectedUserId,
			stripeAccountId: connectedAccountId,
			livemode: false,
			recipientRequested: true,
		});
});

after(async () => {
	if (ownedEvents.length)
		await db
			.delete(paymentWebhookInbox)
			.where(inArray(paymentWebhookInbox.stripeEventId, ownedEvents));
	await db
		.delete(paymentAccounts)
		.where(eq(paymentAccounts.userId, connectedUserId));
	await db.delete(users).where(eq(users.id, connectedUserId));
	for (const key of changedKeys) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
	await db.$client.end();
});

function event(overrides: Record<string, unknown> = {}) {
	const id = `evt_ci_${randomUUID()}`;
	ownedEvents.push(id);
	return JSON.stringify({
		id,
		object: 'event',
		livemode: false,
		created: Math.floor(Date.now() / 1000),
		type: 'checkout.session.completed',
		data: {
			object: { id: `cs_ci_${randomUUID()}`, object: 'checkout.session' },
		},
		...overrides,
	});
}

function signature(payload: string, secret = syntheticSigningSecret) {
	return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

test('valid signatures persist a minimal inbox record, and duplicate delivery returns the same record', async () => {
	const payload = event();
	const id = await acceptStripeWebhook(payload, signature(payload));
	assert.ok(id);
	assert.equal(await acceptStripeWebhook(payload, signature(payload)), id);
	const [row] = await db
		.select()
		.from(paymentWebhookInbox)
		.where(eq(paymentWebhookInbox.id, id));
	assert.equal(row?.status, 'pending');
	assert.equal(row?.stripeAccountId, 'acct_ci_signature_tests');
	assert.equal(row?.livemode, false);
	assert.equal(
		'payload' in (row ?? {}),
		false,
		'PII-heavy provider payload is not persisted.',
	);
});

test('invalid signatures and payload tampering do not persist an event', async () => {
	const payload = event();
	await assert.rejects(
		acceptStripeWebhook(payload, signature(payload, 'wrong-signing-key')),
	);
	await assert.rejects(
		acceptStripeWebhook(
			payload.replace('completed', 'expired'),
			signature(payload),
		),
	);
	const rows = await db
		.select()
		.from(paymentWebhookInbox)
		.where(
			eq(
				paymentWebhookInbox.stripeEventId,
				(JSON.parse(payload) as { id: string }).id,
			),
		);
	assert.equal(rows.length, 0);
});

test('test deployment rejects correctly signed live events', async () => {
	const payload = event({ livemode: true });
	await assert.rejects(
		acceptStripeWebhook(payload, signature(payload)),
		/environment mismatch/,
	);
});

test('correctly signed events from unassociated connected accounts are rejected', async () => {
	const payload = event({ account: `acct_unknown_${randomUUID()}` });
	await assert.rejects(
		acceptStripeWebhook(payload, signature(payload)),
		/not associated/,
	);
});

test('unhandled event families are explicitly ignored without queueing work', async () => {
	const payload = event({ type: 'product.created' });
	assert.equal(await acceptStripeWebhook(payload, signature(payload)), null);
});

test('connected snapshot destination requires its own signature and an associated account, and cannot queue platform payments', async () => {
	const payload = event({
		account: connectedAccountId,
		type: 'account.updated',
		data: { object: { id: connectedAccountId } },
	});
	await assert.rejects(
		acceptStripeWebhook(payload, signature(payload), false, true),
	);
	const id = await acceptStripeWebhook(
		payload,
		signature(payload, connectedSigningSecret),
		false,
		true,
	);
	assert.ok(id);
	assert.equal(
		await acceptStripeWebhook(
			payload,
			signature(payload, connectedSigningSecret),
			false,
			true,
		),
		id,
	);
	const platformPayload = event();
	await assert.rejects(
		acceptStripeWebhook(
			platformPayload,
			signature(platformPayload, connectedSigningSecret),
			false,
			true,
		),
		/requires an account context/,
	);
	const forgedContext = event({ account: 'acct_ci_signature_tests' });
	await assert.rejects(
		acceptStripeWebhook(
			forgedContext,
			signature(forgedContext, connectedSigningSecret),
			false,
			true,
		),
		/cannot use the platform account/,
	);
	const paymentPayload = event({ account: connectedAccountId });
	assert.equal(
		await acceptStripeWebhook(
			paymentPayload,
			signature(paymentPayload, connectedSigningSecret),
			false,
			true,
		),
		null,
	);
	const payoutPayload = event({
		account: connectedAccountId,
		type: 'payout.failed',
		data: { object: { id: `po_ci_${randomUUID()}` } },
	});
	assert.ok(
		await acceptStripeWebhook(
			payoutPayload,
			signature(payoutPayload, connectedSigningSecret),
			false,
			true,
		),
	);
	const unknown = event({
		account: `acct_unknown_${randomUUID()}`,
		type: 'account.updated',
	});
	await assert.rejects(
		acceptStripeWebhook(
			unknown,
			signature(unknown, connectedSigningSecret),
			false,
			true,
		),
		/not associated/,
	);
});

test('signed Accounts v2 bracketed readiness events persist once and reject live-mode evidence', async () => {
	const client = stripeClient();
	const retrieve = client.v2.core.events.retrieve;
	const retrieveAccount = client.v2.core.accounts.retrieve;
	let refreshed = 0;
	try {
		client.v2.core.accounts.retrieve = (async (id: string) => {
			assert.equal(id, connectedAccountId);
			refreshed++;
			return {
				id,
				object: 'v2.core.account',
				applied_configurations: ['recipient'],
				created: new Date(0).toISOString(),
				livemode: false,
				configuration: {
					recipient: {
						applied: true,
						capabilities: {
							stripe_balance: {
								stripe_transfers: { status: 'active', status_details: [] },
								payouts: { status: 'active', status_details: [] },
							},
						},
					},
				},
				requirements: { entries: [] },
				lastResponse: { headers: {}, requestId: 'req_ci_fixture', statusCode: 200 },
			};
		}) as typeof retrieveAccount;
		for (const type of [
			'v2.core.account.updated',
			'v2.core.account[requirements].updated',
			'v2.core.account[configuration.recipient].capability_status_updated',
		]) {
			const eventId = `evt_ci_${randomUUID()}`;
			ownedEvents.push(eventId);
			const accountId = connectedAccountId;
			const notification = JSON.stringify({
				id: eventId,
				object: 'v2.core.event',
				type,
				created: new Date().toISOString(),
				livemode: false,
				related_object: {
					id: accountId,
					type: 'v2.core.account',
					url: `/v2/core/accounts/${accountId}`,
				},
			});
			let livemode = false;
			client.v2.core.events.retrieve = (async (id: string) => {
				assert.equal(id, eventId);
				return { ...JSON.parse(notification), livemode };
			}) as typeof retrieve;
			const id = await acceptStripeWebhook(
				notification,
				signature(notification),
				true,
			);
			assert.ok(id);
			assert.equal(
				await acceptStripeWebhook(
					notification,
					signature(notification),
					true,
				),
				id,
			);
			const [row] = await db
				.select()
				.from(paymentWebhookInbox)
				.where(eq(paymentWebhookInbox.id, id));
			assert.equal(row?.type, type);
			assert.equal(row?.objectId, accountId);
			assert.equal(row?.livemode, false);
			await processWebhook(id);
			livemode = true;
			await assert.rejects(
				acceptStripeWebhook(
					notification,
					signature(notification),
					true,
				),
				/environment mismatch/,
			);
		}
		assert.equal(
			refreshed,
			3,
			'Both dotted and bracketed notifications refresh the associated recipient.',
		);
	} finally {
		client.v2.core.events.retrieve = retrieve;
		client.v2.core.accounts.retrieve = retrieveAccount;
	}
});

test('signed schedule and pending-update lifecycle events are queued once without trusting embedded metadata', async () => {
	for (const type of [
		'subscription_schedule.updated',
		'subscription_schedule.released',
		'subscription_schedule.canceled',
		'customer.subscription.pending_update_applied',
		'customer.subscription.pending_update_expired',
	]) {
		const objectId =
			type.startsWith('subscription_schedule.') ?
				`sub_sched_ci_${randomUUID()}`
			:	`sub_ci_${randomUUID()}`;
		const payload = event({
			type,
			data: {
				object: { id: objectId, metadata: { actorId: 'untrusted' } },
			},
		});
		const id = await acceptStripeWebhook(payload, signature(payload));
		assert.ok(id);
		assert.equal(
			await acceptStripeWebhook(payload, signature(payload)),
			id,
		);
		const [row] = await db
			.select()
			.from(paymentWebhookInbox)
			.where(eq(paymentWebhookInbox.id, id));
		assert.equal(row?.type, type);
		assert.equal(row?.objectId, objectId);
		assert.equal('metadata' in (row ?? {}), false);
	}
});

function applicationFixture() {
	const inbox = {
		stripeEventId: 'evt_owned_application',
		stripeAccountId: 'acct_ci_signature_tests',
		objectId: 'sub_owned_application',
		type: 'customer.subscription.pending_update_applied',
		livemode: false,
	};
	const snapshot = {
		id: inbox.stripeEventId,
		type: inbox.type,
		livemode: inbox.livemode,
		data: { object: { id: inbox.objectId } },
	} as Stripe.Event;
	const calls: string[] = [];
	let stored: { invoiceId: string } | null = null;
	const services = {
		getStored: async (
			eventId: string,
			subscriptionId: string,
			mode: boolean,
		) => {
			assert.equal(eventId, inbox.stripeEventId);
			assert.equal(subscriptionId, inbox.objectId);
			assert.equal(mode, false);
			calls.push('stored');
			return stored;
		},
		retrieve: async (eventId: string) => {
			assert.equal(eventId, inbox.stripeEventId);
			calls.push('retrieve');
			return snapshot;
		},
		capture: async (event: Stripe.Event) => {
			assert.equal(event, snapshot);
			calls.push('capture');
			stored = { invoiceId: 'in_owned_application' };
			return { captured: true };
		},
	};
	return {
		inbox,
		snapshot,
		calls,
		services,
		setStored: () => {
			stored = { invoiceId: 'in_owned_application' };
		},
	};
}

test('application recovery uses persisted owned evidence without retrieving an expired Stripe event', async () => {
	const fixture = applicationFixture();
	fixture.setStored();
	assert.equal(
		await supporterApplicationInvoice(fixture.inbox, fixture.services),
		'in_owned_application',
	);
	assert.deepEqual(fixture.calls, ['stored']);
});

test('application recovery retrieves only the exact inbox event and re-reads captured owned proof', async () => {
	const fixture = applicationFixture();
	assert.equal(
		await supporterApplicationInvoice(fixture.inbox, fixture.services),
		'in_owned_application',
	);
	assert.deepEqual(fixture.calls, [
		'stored',
		'retrieve',
		'capture',
		'stored',
	]);
});

test('application recovery rejects mismatched event, account, mode, type or subscription before capturing', async () => {
	for (const patch of [
		{ id: 'evt_other' },
		{ type: 'customer.subscription.updated' },
		{ livemode: true },
		{ account: 'acct_other' },
		{ data: { object: { id: 'sub_other' } } },
	]) {
		const fixture = applicationFixture();
		Object.assign(fixture.snapshot, patch);
		await assert.rejects(
			supporterApplicationInvoice(fixture.inbox, fixture.services),
			/ownership mismatch/,
		);
		assert.deepEqual(fixture.calls, ['stored', 'retrieve']);
	}
	for (const patch of [
		{ type: 'customer.subscription.updated' },
		{ livemode: true },
		{ stripeAccountId: 'acct_connected' },
	]) {
		const fixture = applicationFixture();
		Object.assign(fixture.inbox, patch);
		await assert.rejects(
			supporterApplicationInvoice(fixture.inbox, fixture.services),
			/ownership mismatch/,
		);
		assert.deepEqual(fixture.calls, []);
	}
});

test('an authenticated but unowned application event cannot fabricate invoice proof', async () => {
	const fixture = applicationFixture();
	fixture.services.capture = async () => ({ captured: false });
	assert.equal(
		await supporterApplicationInvoice(fixture.inbox, fixture.services),
		null,
	);
	assert.deepEqual(fixture.calls, ['stored', 'retrieve', 'stored']);
});
