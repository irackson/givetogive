/** Isolated PostgreSQL with an explicit in-memory Stripe stub. Not provider acceptance evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, mock } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { TRPCError } from '@trpc/server';
import { db } from '../../src/server/db/index.ts';
import { users } from '../../src/server/db/schema.ts';
import {
	paymentSubscriptions,
	paymentAccounts,
	payments,
	supporterPaidCoverage,
	supporterChanges,
} from '../../src/server/db/payments-schema.ts';
import { stripeClient } from '../../src/server/payments/stripe.ts';
import { activeSupporterCoverage } from '../../src/server/payments/coverage.ts';
import {
	admitSupporterChange,
	confirmSupporterChange as confirmAdmission,
	listSupporterChanges,
	previewSupporterChange,
	reconcileSupporterChange,
	supporterChangeStatus,
} from '../../src/server/payments/supporter-changes.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const actors: string[] = [];
const fixtureId = randomUUID();
const subStore = new Map<string, Stripe.Subscription>();
const invoiceStore = new Map<string, Stripe.Invoice>();
const scheduleStore = new Map<string, Stripe.SubscriptionSchedule>();
const responses = new Map<string, unknown>();
let loseNextResponse = false;
let mutateCalls = 0;
let providerEffects = 0;
let quoteDelta = 0;
let beforeNextPreview: (() => Promise<void>) | undefined;
let beforeNextMutation: (() => Promise<void>) | undefined;
const supporterId = 'price_ciSupporter';
const sustainerId = 'price_ciSustainer';
const response = <T>(value: T): Stripe.Response<T> =>
	structuredClone(value) as Stripe.Response<T>;
const price = (id: string) =>
	({
		id,
		active: true,
		livemode: false,
		currency: 'usd',
		type: 'recurring',
		billing_scheme: 'per_unit',
		unit_amount: id === supporterId ? 500 : 1500,
		product: id === supporterId ? 'prod_ciSupporter' : 'prod_ciSustainer',
		recurring: {
			interval: 'month',
			interval_count: 1,
			usage_type: 'licensed',
		},
		transform_quantity: null,
		tiers_mode: null,
	}) as Stripe.Price;
function upgradeInvoice(
	sub: Stripe.Subscription,
	proration: number,
	id = 'upcoming_ci',
) {
	const item = sub.items.data[0]!;
	const line = (priceId: string, amount: number) => ({
		amount,
		currency: 'usd',
		period: { start: proration, end: item.current_period_end },
		pricing: { price_details: { price: priceId } },
		parent: {
			type: 'subscription_item_details',
			subscription_item_details: {
				subscription_item: item.id,
				proration: true,
			},
		},
	});
	return {
		id,
		currency: 'usd',
		livemode: false,
		customer_account: sub.customer_account,
		amount_due: 500 + quoteDelta,
		amount_paid: 0,
		amount_remaining: 500 + quoteDelta,
		total: 500 + quoteDelta,
		status: 'open',
		hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
		parent: { subscription_details: { subscription: sub.id } },
		lines: {
			has_more: false,
			data: [
				line(supporterId, -250),
				line(sustainerId, 750 + quoteDelta),
			],
		},
	} as unknown as Stripe.Invoice;
}
function stored<T>(store: Map<string, T>, id: string): T {
	const value = store.get(id);
	if (!value) throw new Error(`Unexpected synthetic provider object ${id}`);
	return value;
}
before(async () => {
	await verifyIsolatedTarget(
		db.$client,
		isolatedConfiguration(process.env, 'test'),
	);
	process.env['STRIPE_SECRET_KEY'] = [
		'sk',
		'test',
		'isolated_stub_no_provider',
	].join('_');
	process.env['STRIPE_PLATFORM_ACCOUNT_ID'] = 'acct_ciStub';
	process.env['STRIPE_PROCESSING_BPS'] = '290';
	process.env['STRIPE_PROCESSING_FIXED_CENTS'] = '30';
	process.env['STRIPE_SUPPORTER_PRICE_ID'] = supporterId;
	process.env['STRIPE_SUSTAINER_PRICE_ID'] = sustainerId;
	process.env['SUPPORTERS_ENABLED'] = 'true';
	delete process.env['STRIPE_PUBLISHABLE_KEY'];
	const stripe = stripeClient();
	mock.method(stripe.subscriptions, 'retrieve', async (id: string) =>
		response(stored(subStore, id)),
	);
	mock.method(stripe.prices, 'retrieve', async (id: string) =>
		response(price(id)),
	);
	mock.method(stripe.paymentMethods, 'retrieve', async (id: string) => {
		const sub = [...subStore.values()].find(
			(value) => value.default_payment_method === id,
		);
		if (!sub) throw new Error('Unknown synthetic payment method');
		return response({
			id,
			livemode: false,
			customer_account: sub.customer_account,
			type: 'card',
		} as Stripe.PaymentMethod);
	});
	mock.method(stripe.invoices, 'retrieve', async (id: string) =>
		response(stored(invoiceStore, id)),
	);
	mock.method(
		stripe.invoices,
		'createPreview',
		async (params: Stripe.InvoiceCreatePreviewParams) => {
			const hook = beforeNextPreview;
			beforeNextPreview = undefined;
			await hook?.();
			return response(
				upgradeInvoice(
					stored(subStore, params.subscription!),
					params.subscription_details!.proration_date!,
				),
			);
		},
	);
	mock.method(
		stripe.subscriptions,
		'update',
		async (
			id: string,
			params: Stripe.SubscriptionUpdateParams,
			opts: Stripe.RequestOptions,
		) => {
			mutateCalls++;
			const hook = beforeNextMutation;
			beforeNextMutation = undefined;
			await hook?.();
			assert.ok(opts.idempotencyKey);
			if (responses.has(opts.idempotencyKey!))
				return response(
					responses.get(opts.idempotencyKey!) as Stripe.Subscription,
				);
			const sub = stored(subStore, id);
			providerEffects++;
			if (params.items) {
				assert.equal(params.items.length, 1);
				assert.equal(params.items[0]!.id, sub.items.data[0]!.id);
				assert.equal(params.payment_behavior, 'pending_if_incomplete');
				assert.equal(params.proration_behavior, 'always_invoice');
				const invoice = upgradeInvoice(
					sub,
					params.proration_date!,
					`in_upgrade_${randomUUID().replaceAll('-', '')}`,
				);
				invoiceStore.set(invoice.id, invoice);
				sub.latest_invoice = invoice.id;
				sub.pending_update = {
					expires_at: Math.floor(Date.now() / 1000) + 3600,
					subscription_items: [
						{ id: sub.items.data[0]!.id, price: sustainerId },
					],
				} as unknown as Stripe.Subscription.PendingUpdate;
			} else {
				assert.equal(params.proration_behavior, 'none');
				sub.cancel_at_period_end = params.cancel_at_period_end!;
				sub.cancel_at =
					sub.cancel_at_period_end ?
						sub.items.data[0]!.current_period_end
					:	null;
			}
			const result = response(sub);
			responses.set(opts.idempotencyKey!, result);
			if (loseNextResponse) {
				loseNextResponse = false;
				throw new Error(
					'Synthetic transport lost response after provider effect',
				);
			}
			return result;
		},
	);
	mock.method(
		stripe.invoices,
		'voidInvoice',
		async (id: string, __params: unknown, opts: Stripe.RequestOptions) => {
			assert.ok(opts.idempotencyKey);
			const invoice = stored(invoiceStore, id);
			if (invoice.status !== 'void') {
				assert.equal(invoice.status, 'open');
				invoice.status = 'void';
				const subId = invoice.parent!.subscription_details!
					.subscription as string;
				stored(subStore, subId).pending_update = null;
			}
			return response(invoice);
		},
	);
	mock.method(
		stripe.subscriptionSchedules,
		'create',
		async (
			params: Stripe.SubscriptionScheduleCreateParams,
			opts: Stripe.RequestOptions,
		) => {
			assert.ok(opts.idempotencyKey);
			if (responses.has(opts.idempotencyKey!))
				return response(
					responses.get(
						opts.idempotencyKey!,
					) as Stripe.SubscriptionSchedule,
				);
			const sub = stored(subStore, params.from_subscription!);
			assert.equal(sub.schedule, null);
			const item = sub.items.data[0]!;
			const schedule = {
				id: `sub_sched_${randomUUID().replaceAll('-', '')}`,
				customer_account: sub.customer_account,
				subscription: sub.id,
				released_subscription: null,
				livemode: false,
				status: 'active',
				end_behavior: 'release',
				phases: [
					{
						start_date: item.current_period_start,
						end_date: item.current_period_end,
						items: [{ price: item.price.id, quantity: 1 }],
					},
				],
			} as Stripe.SubscriptionSchedule;
			scheduleStore.set(schedule.id, schedule);
			sub.schedule = schedule.id;
			responses.set(opts.idempotencyKey!, response(schedule));
			return response(schedule);
		},
	);
	mock.method(stripe.subscriptionSchedules, 'retrieve', async (id: string) =>
		response(stored(scheduleStore, id)),
	);
	mock.method(
		stripe.subscriptionSchedules,
		'update',
		async (
			id: string,
			params: Stripe.SubscriptionScheduleUpdateParams,
			opts: Stripe.RequestOptions,
		) => {
			assert.ok(opts.idempotencyKey);
			if (responses.has(opts.idempotencyKey!))
				return response(
					responses.get(
						opts.idempotencyKey!,
					) as Stripe.SubscriptionSchedule,
				);
			assert.equal(params.proration_behavior, 'none');
			const schedule = stored(scheduleStore, id);
			schedule.end_behavior = params.end_behavior!;
			schedule.phases = params.phases!.map((phase) => ({
				start_date: phase.start_date,
				end_date:
					phase.end_date ?? Number(phase.start_date) + 2_592_000,
				items: phase.items,
			})) as Stripe.SubscriptionSchedule.Phase[];
			if (params.end_behavior === 'cancel')
				stored(subStore, schedule.subscription as string).cancel_at =
					Number(params.phases!.at(-1)!.end_date);
			responses.set(opts.idempotencyKey!, response(schedule));
			return response(schedule);
		},
	);
	mock.method(
		stripe.subscriptionSchedules,
		'release',
		async (
			id: string,
			params: Stripe.SubscriptionScheduleReleaseParams,
			opts: Stripe.RequestOptions,
		) => {
			assert.ok(opts.idempotencyKey);
			const schedule = stored(scheduleStore, id);
			if (schedule.status !== 'released') {
				const sub = stored(subStore, schedule.subscription as string);
				schedule.released_subscription = sub.id;
				schedule.subscription = null;
				schedule.status = 'released';
				sub.schedule = null;
				if (!params.preserve_cancel_date) {
					sub.cancel_at = null;
					sub.cancel_at_period_end = false;
				}
			}
			return response(schedule);
		},
	);
});
after(async () => {
	try {
		await verifyIsolatedTarget(
			db.$client,
			isolatedConfiguration(process.env, 'test'),
		);
		if (actors.length) {
			const owned = await db
				.select()
				.from(users)
				.where(inArray(users.id, actors));
			assert.ok(
				owned.every(
					(member) =>
						member.isSynthetic &&
						member.name === `CI supporter change ${fixtureId}`,
				),
			);
			// These exact IDs have only in-memory provider-stub objects. Preserve
			// history but retire work so a future real CI sandbox sweep cannot send it.
			await db
				.update(supporterChanges)
				.set({
					status: 'expired',
					step: 'ci_fixture_retired',
					leaseUntil: null,
					lastError:
						'Isolated provider-stub CI fixture retired; no real provider objects.',
				})
				.where(inArray(supporterChanges.actorId, actors));
			await db
				.update(paymentSubscriptions)
				.set({
					status: 'canceled',
					activeMutationId: null,
					pendingChangeId: null,
				})
				.where(inArray(paymentSubscriptions.actorId, actors));
			await db
				.update(payments)
				.set({
					status: 'expired',
					expiresAt: new Date(),
					lastError:
						'Retired isolated provider-stub fixture; no real financial effect.',
				})
				.where(inArray(payments.actorId, actors));
			await db
				.update(users)
				.set({
					frozenAt: new Date(),
					sessionVersion: sql`${users.sessionVersion} + 1`,
				})
				.where(inArray(users.id, actors));
		}
	} finally {
		mock.restoreAll();
		await db.$client.end();
	}
});
async function fixture(tier: 'supporter' | 'sustainer' = 'supporter') {
	const actorId = randomUUID();
	actors.push(actorId);
	const compact = actorId.replaceAll('-', '');
	const id = `sub_ci${compact}`;
	const paymentId = randomUUID();
	const now = Math.floor(Date.now() / 1000);
	const priceId = tier === 'supporter' ? supporterId : sustainerId;
	const feeSnapshot = {
		version: 'synthetic-stub',
		platformBps: 0,
		processingBps: 0,
		processingFixed: 0,
	};
	const raw = {
		id,
		livemode: false,
		customer_account: `acct_ci${compact}`,
		status: 'active',
		collection_method: 'charge_automatically',
		currency: 'usd',
		items: {
			has_more: false,
			data: [
				{
					id: `si_ci${compact}`,
					quantity: 1,
					current_period_start: now - 1000,
					current_period_end: now + 1000,
					price: price(priceId),
				},
			],
		},
		cancel_at_period_end: false,
		cancel_at: null,
		latest_invoice: `in_ci${compact}`,
		schedule: null,
		pending_update: null,
		automatic_tax: { enabled: false },
		default_payment_method: `pm_ci${compact}`,
	} as unknown as Stripe.Subscription;
	subStore.set(id, raw);
	invoiceStore.set(
		raw.latest_invoice as string,
		{
			id: raw.latest_invoice,
			customer_account: raw.customer_account,
			livemode: false,
			currency: 'usd',
			status: 'paid',
			amount_paid: tier === 'supporter' ? 500 : 1500,
			amount_remaining: 0,
			parent: { subscription_details: { subscription: id } },
		} as Stripe.Invoice,
	);
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: actorId,
			name: `CI supporter change ${fixtureId}`,
			email: `${actorId}@example.invalid`,
			emailVerified: new Date(),
			isSynthetic: true,
		});
		await tx.insert(payments).values({
			id: paymentId,
			actorId,
			kind: 'supporter',
			tier,
			recurring: true,
			livemode: false,
			requestHash: `ci-supporter-change:${fixtureId}`,
			grossAmount: 500,
			platformFee: 0,
			processingEstimate: 0,
			recipientAmount: 500,
			feeSnapshot,
			expiresAt: new Date(),
			status: 'expired',
		});
		await tx.insert(paymentAccounts).values({
			userId: actorId,
			stripeAccountId: raw.customer_account!,
			livemode: false,
		});
		await tx.insert(paymentSubscriptions).values({
			id,
			actorId,
			accountId: raw.customer_account!,
			livemode: false,
			kind: 'supporter',
			tier,
			priceId,
			itemId: raw.items.data[0]!.id,
			periodStart: new Date((now - 1000) * 1000),
			periodEnd: new Date((now + 1000) * 1000),
			latestInvoiceId: raw.latest_invoice as string,
			status: 'active',
			initialPaymentId: paymentId,
			feeSnapshot,
		});
	});
	return { actorId, id, raw };
}
async function row(id: string) {
	return (
		await db
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, id))
	)[0]!;
}
async function change(id: string) {
	return (
		await db
			.select()
			.from(supporterChanges)
			.where(eq(supporterChanges.id, id))
	)[0]!;
}
async function freezeMember(actorId: string) {
	await db
		.update(users)
		.set({
			frozenAt: new Date(),
			sessionVersion: sql`${users.sessionVersion} + 1`,
		})
		.where(eq(users.id, actorId));
}
function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}
async function confirmSupporterChange(
	actorId: string,
	input: { operationId: string },
) {
	const before = mutateCalls;
	await confirmAdmission(actorId, input);
	assert.equal(
		mutateCalls,
		before,
		'authenticated confirmation admits only; provider mutations belong to the durable worker',
	);
	await reconcileSupporterChange(input.operationId);
	return supporterChangeStatus(actorId, input);
}
async function preview(
	f: Awaited<ReturnType<typeof fixture>>,
	action: 'upgrade' | 'downgrade' | 'cancel' | 'resume' | 'undo',
	targetOperationId?: string,
) {
	const current = await row(f.id);
	return previewSupporterChange(f.actorId, {
		operationId: randomUUID(),
		subscriptionId: f.id,
		action,
		expectedRevision: current.changeRevision,
		...(targetOperationId ? { targetOperationId } : {}),
	});
}

test('quotes are immutable; changed quote amounts require new consent and have no provider effect', async () => {
	const f = await fixture();
	const quoted = await preview(f, 'upgrade');
	assert.equal(quoted.quoteAmount, 500);
	const effects = providerEffects;
	quoteDelta = 10;
	await assert.rejects(
		confirmSupporterChange(f.actorId, { operationId: quoted.operationId }),
		/amount changed/,
	);
	quoteDelta = 0;
	assert.equal(providerEffects, effects);
	assert.equal((await change(quoted.operationId)).quoteAmount, 500);
	assert.equal((await row(f.id)).activeMutationId, null);
});

test('amount changes after admission but before worker execution require new consent without charging', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	await confirmAdmission(f.actorId, { operationId: quote.operationId });
	const effects = providerEffects;
	quoteDelta = 10;
	try {
		assert.equal(
			(await reconcileSupporterChange(quote.operationId)).status,
			'failed',
		);
		assert.equal(providerEffects, effects);
		assert.equal((await change(quote.operationId)).providerStartedAt, null);
		assert.equal((await row(f.id)).activeMutationId, null);
	} finally {
		quoteDelta = 0;
	}
});

test('freeze after admission blocks unsent upgrade and both renewal-resumption paths', async () => {
	for (const action of [
		'upgrade',
		'plain_resume',
		'schedule_resume',
	] as const) {
		const f = await fixture(
			action === 'schedule_resume' ? 'sustainer' : 'supporter',
		);
		let target: string | undefined;
		if (action === 'schedule_resume') {
			const downgrade = await preview(f, 'downgrade');
			await confirmSupporterChange(f.actorId, {
				operationId: downgrade.operationId,
			});
			target = downgrade.operationId;
		}
		if (action !== 'upgrade') {
			const cancellation = await preview(f, 'cancel', target);
			await confirmSupporterChange(f.actorId, {
				operationId: cancellation.operationId,
			});
			target = cancellation.operationId;
		}
		const quote = await preview(
			f,
			action === 'upgrade' ? 'upgrade' : 'resume',
			target,
		);
		await confirmAdmission(f.actorId, { operationId: quote.operationId });
		const priorSchedule = f.raw.schedule;
		const calls = mutateCalls;
		await freezeMember(f.actorId);
		await reconcileSupporterChange(quote.operationId);
		const blocked = await change(quote.operationId);
		assert.equal(blocked.status, 'failed', action);
		assert.match(
			blocked.lastError!,
			/not sent because the account was frozen/,
		);
		assert.equal(blocked.providerStartedAt, null);
		assert.equal(blocked.invoiceId, null);
		assert.equal(blocked.leaseUntil, null);
		assert.equal((await row(f.id)).activeMutationId, null);
		assert.equal(mutateCalls, calls);
		assert.equal(f.raw.schedule, priorSchedule);
		if (target) {
			assert.equal((await row(f.id)).pendingChangeId, target);
			assert.equal((await change(target)).status, 'scheduled');
			assert.ok(f.raw.cancel_at);
		}
		await db
			.update(users)
			.set({ frozenAt: null })
			.where(eq(users.id, f.actorId));
		await reconcileSupporterChange(quote.operationId);
		assert.equal(
			(await change(quote.operationId)).status,
			'failed',
			'unfreeze cannot resurrect old consent',
		);
		assert.equal(mutateCalls, calls);
	}
});

test('freeze during final provider preflight wins the durable send boundary', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	await confirmAdmission(f.actorId, { operationId: quote.operationId });
	const calls = mutateCalls;
	beforeNextPreview = () => freezeMember(f.actorId);
	try {
		assert.equal(
			(await reconcileSupporterChange(quote.operationId)).status,
			'failed',
		);
		assert.equal(
			beforeNextPreview,
			undefined,
			'freeze happened after worker claim and reads',
		);
		assert.equal(mutateCalls, calls);
		assert.equal((await change(quote.operationId)).providerStartedAt, null);
		assert.equal((await row(f.id)).activeMutationId, null);
	} finally {
		beforeNextPreview = undefined;
	}
});

test('the send boundary waits for a concurrent freeze transaction before deciding eligibility', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	await confirmAdmission(f.actorId, { operationId: quote.operationId });
	const locked = deferred<number>();
	const release = deferred<void>();
	let freezing: Promise<void> | undefined;
	const calls = mutateCalls;
	beforeNextPreview = async () => {
		freezing = db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ frozenAt: new Date() })
				.where(eq(users.id, f.actorId));
			const [backend] = await tx.execute<{ pid: number }>(
				sql`select pg_backend_pid() as pid`,
			);
			locked.resolve(backend!.pid);
			await release.promise;
		});
		void freezing.catch(locked.reject);
		await locked.promise;
	};
	const worker = reconcileSupporterChange(quote.operationId);
	void worker.then(
		() => locked.reject(new Error('Worker ended before the freeze barrier.')),
		locked.reject,
	);
	try {
		const freezeBackend = await locked.promise;
		let waiting = false;
		const deadline = Date.now() + 5000;
		while (!waiting && Date.now() < deadline) {
			const [observation] = await db.execute<{ waiting: boolean }>(sql`
				select exists (
					select 1 from pg_stat_activity
					where datname = current_database()
					and ${freezeBackend} = any(pg_blocking_pids(pid))
				) as waiting
			`);
			waiting = Boolean(observation?.waiting);
			if (!waiting)
				await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.equal(
			waiting,
			true,
			'the worker must actually wait on the concurrently held member lock',
		);
		assert.equal((await change(quote.operationId)).providerStartedAt, null);
		assert.equal(mutateCalls, calls);
	} finally {
		release.resolve(undefined);
		await freezing;
		await worker;
		beforeNextPreview = undefined;
	}
	assert.equal((await worker).status, 'failed');
	assert.equal(mutateCalls, calls);
	assert.equal((await row(f.id)).activeMutationId, null);
});

test('freeze after the durable send marker preserves ambiguous upgrade recovery and unpaid undo', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	const effects = providerEffects;
	let startedAt: number | undefined;
	beforeNextMutation = async () => {
		const dispatched = await change(quote.operationId);
		assert.equal(dispatched.step, 'upgrade_mutation');
		assert.ok(dispatched.providerStartedAt);
		startedAt = dispatched.providerStartedAt.getTime();
		// This would deadlock if provider I/O were inside the member-lock transaction.
		await freezeMember(f.actorId);
	};
	loseNextResponse = true;
	try {
		const first = await confirmSupporterChange(f.actorId, {
			operationId: quote.operationId,
		});
		assert.equal(first.status, 'recovery_required');
		assert.equal((await row(f.id)).activeMutationId, quote.operationId);
		const invoiceId = f.raw.latest_invoice;
		assert.equal(
			(await reconcileSupporterChange(quote.operationId)).status,
			'pending_payment',
		);
		assert.equal(
			providerEffects,
			effects + 1,
			'retry reuses the original provider result',
		);
		const recovered = await change(quote.operationId);
		assert.equal(recovered.invoiceId, invoiceId);
		assert.equal(recovered.providerStartedAt!.getTime(), startedAt);
		const frozenView = await supporterChangeStatus(f.actorId, {
			operationId: quote.operationId,
		});
		assert.equal(frozenView.invoiceUrl, null);
		assert.equal(frozenView.canUndo, true);
		const undo = await preview(f, 'undo', quote.operationId);
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: undo.operationId,
				})
			).status,
			'applied',
		);
		assert.equal(stored(invoiceStore, recovered.invoiceId!).status, 'void');
		assert.equal(f.raw.pending_update, null);
		assert.equal(providerEffects, effects + 1);
	} finally {
		beforeNextMutation = undefined;
		loseNextResponse = false;
	}
});

test('freeze preserves same-key recovery of a renewal resumption that was already sent', async () => {
	const f = await fixture();
	const cancel = await preview(f, 'cancel');
	await confirmSupporterChange(f.actorId, {
		operationId: cancel.operationId,
	});
	const resume = await preview(f, 'resume', cancel.operationId);
	const effects = providerEffects;
	loseNextResponse = true;
	try {
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: resume.operationId,
				})
			).status,
			'recovery_required',
		);
		const startedAt = (await change(resume.operationId)).providerStartedAt;
		assert.ok(startedAt);
		await freezeMember(f.actorId);
		assert.equal(
			(await reconcileSupporterChange(resume.operationId)).status,
			'applied',
		);
		assert.equal(providerEffects, effects + 1);
		assert.equal(
			(await change(resume.operationId)).providerStartedAt!.getTime(),
			startedAt.getTime(),
		);
		assert.equal(f.raw.cancel_at_period_end, false);
		assert.equal((await change(cancel.operationId)).status, 'expired');
		// Stopping billing remains available after recovery on the frozen identity.
		const recancel = await preview(f, 'cancel');
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: recancel.operationId,
				})
			).status,
			'scheduled',
		);
		assert.equal(f.raw.cancel_at_period_end, true);
	} finally {
		loseNextResponse = false;
	}
});

test('missing legacy send evidence is not falsely reported as an unsent frozen operation', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	await confirmAdmission(f.actorId, { operationId: quote.operationId });
	await db
		.update(supporterChanges)
		.set({ step: 'upgrade_mutation' })
		.where(eq(supporterChanges.id, quote.operationId));
	await freezeMember(f.actorId);
	const calls = mutateCalls;
	const result = await reconcileSupporterChange(quote.operationId);
	assert.equal(result.status, 'recovery_required');
	assert.match(result.lastError!, /send boundary needs review/);
	assert.equal(mutateCalls, calls);
	assert.equal((await row(f.id)).activeMutationId, quote.operationId);
});

test('separate real transactions admit one competing operation and stable concurrent retries increment revision once', async () => {
	const f = await fixture();
	const first = await preview(f, 'upgrade');
	const second = await preview(f, 'cancel');
	const backends = new Set<number>();
	const requests = [first, second];
	const results = await Promise.allSettled(
		requests.map(async (request) => {
			const candidate = await change(request.operationId);
			return db.transaction(async (tx) => {
				const [pid] = await tx.execute<{ pid: number }>(
					sql`select pg_backend_pid() as pid`,
				);
				backends.add(pid!.pid);
				return admitSupporterChange(
					tx,
					f.actorId,
					candidate.id,
					candidate.providerFingerprint,
				);
			});
		}),
	);
	assert.equal(backends.size, 2);
	assert.equal(
		results.filter((value) => value.status === 'fulfilled').length,
		1,
	);
	const winner = results.find((value) => value.status === 'fulfilled');
	assert.ok(winner?.status === 'fulfilled');
	await Promise.all(
		[0, 1].map(() =>
			db.transaction((tx) =>
				admitSupporterChange(
					tx,
					f.actorId,
					winner.value.id,
					winner.value.providerFingerprint,
				),
			),
		),
	);
	assert.equal((await row(f.id)).changeRevision, 1);
	assert.equal((await row(f.id)).activeMutationId, winner.value.id);
});

test('lost upgrade response keeps mutation ownership and recovers the same invoice through a stable key', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	const initialEffects = providerEffects;
	loseNextResponse = true;
	const first = await confirmSupporterChange(f.actorId, {
		operationId: quote.operationId,
	});
	assert.equal(first.status, 'recovery_required');
	assert.equal((await row(f.id)).activeMutationId, quote.operationId);
	const settled = await reconcileSupporterChange(quote.operationId);
	assert.equal(settled.status, 'pending_payment');
	assert.equal(providerEffects, initialEffects + 1);
	assert.equal((await row(f.id)).activeMutationId, null);
	assert.equal((await row(f.id)).pendingChangeId, quote.operationId);
	const status = await supporterChangeStatus(f.actorId, {
		operationId: quote.operationId,
	});
	assert.match(status.invoiceUrl!, /^https:\/\/invoice\.stripe\.com\//);
	assert.equal(status.canUndo, true);
	const beforeRetry = mutateCalls;
	await confirmSupporterChange(f.actorId, { operationId: quote.operationId });
	assert.equal(
		mutateCalls,
		beforeRetry,
		'repeated consent must not create another invoice',
	);
});

test('undo pending upgrade voids its exact invoice without duplicate charge or refund', async () => {
	const f = await fixture();
	const upgrade = await preview(f, 'upgrade');
	await confirmSupporterChange(f.actorId, {
		operationId: upgrade.operationId,
	});
	const undo = await preview(f, 'undo', upgrade.operationId);
	assert.equal(
		(
			await confirmSupporterChange(f.actorId, {
				operationId: undo.operationId,
			})
		).status,
		'applied',
	);
	assert.equal((await change(upgrade.operationId)).status, 'expired');
	assert.equal(f.raw.pending_update, null);
	assert.equal(f.raw.items.data[0]!.price.id, supporterId);
	assert.equal((await row(f.id)).pendingChangeId, null);
});

test('new ambiguity in a previously pending upgrade reacquires ownership and remains recoverable', async () => {
	const f = await fixture();
	const upgrade = await preview(f, 'upgrade');
	await confirmSupporterChange(f.actorId, {
		operationId: upgrade.operationId,
	});
	const current = await change(upgrade.operationId);
	const invoice = stored(invoiceStore, current.invoiceId!);
	invoice.status = 'draft';
	assert.equal(
		(await reconcileSupporterChange(upgrade.operationId)).status,
		'recovery_required',
	);
	assert.equal((await row(f.id)).activeMutationId, upgrade.operationId);
	invoice.status = 'open';
	assert.equal(
		(await reconcileSupporterChange(upgrade.operationId)).status,
		'pending_payment',
	);
	assert.equal((await row(f.id)).activeMutationId, null);
	assert.equal((await row(f.id)).pendingChangeId, upgrade.operationId);
});

test('historically paid/applied upgrades settle after later price changes, refunds or disputes without granting recognition', async () => {
	for (const reversal of ['refunded', 'disputed'] as const) {
		const f = await fixture();
		const upgrade = await preview(f, 'upgrade');
		await confirmSupporterChange(f.actorId, {
			operationId: upgrade.operationId,
		});
		const undo = await preview(f, 'undo', upgrade.operationId);
		await confirmAdmission(f.actorId, { operationId: undo.operationId });
		const op = await change(upgrade.operationId);
		const invoice = stored(invoiceStore, op.invoiceId!);
		invoice.status = 'paid';
		invoice.amount_paid = 500;
		invoice.amount_remaining = 0;
		// Explicit synthetic historical evidence; no Stripe call or real payment.
		const paymentId = randomUUID();
		await db.insert(payments).values({
			id: paymentId,
			actorId: f.actorId,
			kind: 'supporter',
			tier: 'sustainer',
			recurring: true,
			livemode: false,
			requestHash: `ci-supporter-change:${fixtureId}`,
			grossAmount: 500,
			recipientAmount: 500,
			platformFee: 0,
			processingEstimate: 0,
			feeSnapshot: {
				version: 'synthetic-stub',
				platformBps: 0,
				processingBps: 0,
				processingFixed: 0,
			},
			status: reversal,
			paidAt: new Date(),
			expiresAt: new Date(),
			invoiceId: invoice.id,
			subscriptionId: f.id,
			refundedAmount: reversal === 'refunded' ? 500 : 0,
			refundedRecipientAmount: reversal === 'refunded' ? 500 : 0,
			disputedAmount: reversal === 'disputed' ? 500 : 0,
		});
		await db.insert(supporterPaidCoverage).values({
			invoiceLineId: `il_ci${randomUUID().replaceAll('-', '')}`,
			livemode: false,
			invoiceId: invoice.id,
			paymentId,
			subscriptionId: f.id,
			itemId: op.itemId,
			priceId: sustainerId,
			tier: 'sustainer',
			proration: true,
			periodStart: new Date(op.prorationDate! * 1000),
			periodEnd: op.sourcePeriodEnd!,
			appliedAt: new Date(),
		});
		f.raw.pending_update = null;
		f.raw.latest_invoice = `in_later${randomUUID().replaceAll('-', '')}`;
		// It was applied in the past, then a later change returned billing to Supporter.
		f.raw.items.data[0]!.price = price(supporterId);
		const undoResult = await reconcileSupporterChange(undo.operationId);
		assert.equal(
			undoResult.status,
			'failed',
			'payment won the void race; no rollback or automatic refund is promised',
		);
		assert.match(
			undoResult.lastError!,
			/Payment completed before cancellation/,
		);
		assert.equal(
			(await reconcileSupporterChange(upgrade.operationId)).status,
			'applied',
		);
		assert.equal((await row(f.id)).activeMutationId, null);
		assert.deepEqual(
			await activeSupporterCoverage(f.actorId, new Date()),
			[],
			'refund/dispute still revokes current recognition',
		);
	}
});

test('downgrade is scheduled without immediate tier change and undo releases owned schedule', async () => {
	const f = await fixture('sustainer');
	const downgrade = await preview(f, 'downgrade');
	assert.equal(
		(
			await confirmSupporterChange(f.actorId, {
				operationId: downgrade.operationId,
			})
		).status,
		'scheduled',
	);
	assert.equal(f.raw.items.data[0]!.price.id, sustainerId);
	const schedule = stored(scheduleStore, f.raw.schedule as string);
	assert.equal(schedule.end_behavior, 'release');
	assert.equal(
		schedule.phases[1]!.start_date,
		f.raw.items.data[0]!.current_period_end,
	);
	const undo = await preview(f, 'undo', downgrade.operationId);
	assert.equal(
		(
			await confirmSupporterChange(f.actorId, {
				operationId: undo.operationId,
			})
		).status,
		'applied',
	);
	assert.equal(f.raw.schedule, null);
	assert.equal(f.raw.items.data[0]!.price.id, sustainerId);
	assert.equal((await change(downgrade.operationId)).status, 'expired');
});

test('owned downgrade can become period-end cancellation then resume without immediate cancel', async () => {
	const f = await fixture('sustainer');
	const downgrade = await preview(f, 'downgrade');
	await confirmSupporterChange(f.actorId, {
		operationId: downgrade.operationId,
	});
	const cancel = await preview(f, 'cancel', downgrade.operationId);
	assert.equal(
		(
			await confirmSupporterChange(f.actorId, {
				operationId: cancel.operationId,
			})
		).status,
		'scheduled',
	);
	const schedule = stored(scheduleStore, f.raw.schedule as string);
	assert.equal(schedule.end_behavior, 'cancel');
	assert.equal(schedule.phases.length, 1);
	assert.equal(f.raw.status, 'active');
	assert.equal((await change(downgrade.operationId)).status, 'expired');
	await reconcileSupporterChange(downgrade.operationId);
	assert.equal(
		(await row(f.id)).pendingChangeId,
		cancel.operationId,
		'superseded worker cannot reclaim the pending pointer',
	);
	const resume = await preview(f, 'resume', cancel.operationId);
	assert.equal(
		(
			await confirmSupporterChange(f.actorId, {
				operationId: resume.operationId,
			})
		).status,
		'applied',
	);
	assert.equal(f.raw.schedule, null);
	assert.equal(f.raw.cancel_at, null);
	assert.equal(f.raw.status, 'active');
});

test('plain cancellation and resumption remain possible when new-sale feature gate is off', async () => {
	const f = await fixture();
	process.env['SUPPORTERS_ENABLED'] = 'false';
	try {
		const cancel = await preview(f, 'cancel');
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: cancel.operationId,
				})
			).status,
			'scheduled',
		);
		assert.equal(f.raw.status, 'active');
		const resume = await preview(f, 'resume', cancel.operationId);
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: resume.operationId,
				})
			).status,
			'applied',
		);
		assert.equal(f.raw.cancel_at_period_end, false);
		await assert.rejects(preview(f, 'upgrade'), /not enabled/);
	} finally {
		process.env['SUPPORTERS_ENABLED'] = 'true';
	}
});

test('unpaid renewal and an account freeze do not trap a verified member in renewing billing', async () => {
	const f = await fixture();
	f.raw.status = 'past_due';
	const invoice = stored(invoiceStore, f.raw.latest_invoice as string);
	invoice.status = 'open';
	invoice.amount_paid = 0;
	invoice.amount_remaining = 500;
	await db
		.update(users)
		.set({ frozenAt: new Date() })
		.where(eq(users.id, f.actorId));
	process.env['SUPPORTERS_ENABLED'] = 'false';
	try {
		const cancel = await preview(f, 'cancel');
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: cancel.operationId,
				})
			).status,
			'scheduled',
		);
		assert.equal(f.raw.status, 'past_due');
		assert.equal(f.raw.cancel_at_period_end, true);
		assert.equal((await listSupporterChanges(f.actorId)).length, 1);
		await assert.rejects(
			preview(f, 'resume', cancel.operationId),
			/frozen/,
		);
		await db
			.update(users)
			.set({ frozenAt: null })
			.where(eq(users.id, f.actorId));
		const resume = await preview(f, 'resume', cancel.operationId);
		assert.equal(
			(
				await confirmSupporterChange(f.actorId, {
					operationId: resume.operationId,
				})
			).status,
			'applied',
		);
		assert.equal(
			f.raw.status,
			'past_due',
			'resumption must not fabricate payment or paid recognition',
		);
		assert.equal(f.raw.cancel_at_period_end, false);
	} finally {
		process.env['SUPPORTERS_ENABLED'] = 'true';
	}
});

test('frozen history never emits a payment handoff or forbidden action but preserves unpaid-upgrade undo', async () => {
	const f = await fixture();
	const quote = await preview(f, 'upgrade');
	await db
		.update(users)
		.set({ frozenAt: new Date() })
		.where(eq(users.id, f.actorId));
	assert.equal(
		(
			await supporterChangeStatus(f.actorId, {
				operationId: quote.operationId,
			})
		).canConfirm,
		false,
	);
	assert.equal((await listSupporterChanges(f.actorId))[0]!.canConfirm, false);
	await db
		.update(users)
		.set({ frozenAt: null })
		.where(eq(users.id, f.actorId));
	const pending = await confirmSupporterChange(f.actorId, {
		operationId: quote.operationId,
	});
	assert.equal(pending.status, 'pending_payment');
	assert.ok(pending.invoiceUrl);
	await db
		.update(users)
		.set({ frozenAt: new Date() })
		.where(eq(users.id, f.actorId));
	const frozen = await supporterChangeStatus(f.actorId, {
		operationId: quote.operationId,
	});
	assert.equal(frozen.invoiceUrl, null);
	assert.equal(frozen.canConfirm, false);
	assert.equal(frozen.canUndo, true);
	const undo = await preview(f, 'undo', quote.operationId);
	assert.equal(undo.canConfirm, true);
	assert.equal(
		(
			await supporterChangeStatus(f.actorId, {
				operationId: undo.operationId,
			})
		).canConfirm,
		true,
	);
});

test('actor isolation, frozen admission, stale cancellation and expired replay fail closed', async () => {
	const f = await fixture();
	const other = await fixture();
	const quote = await preview(f, 'upgrade');
	await assert.rejects(
		previewSupporterChange(other.actorId, {
			operationId: quote.operationId,
			subscriptionId: f.id,
			action: 'upgrade',
			expectedRevision: 0,
		}),
		(error) => error instanceof TRPCError && error.code === 'NOT_FOUND',
	);
	await assert.rejects(
		previewSupporterChange(f.actorId, {
			operationId: quote.operationId,
			subscriptionId: f.id,
			action: 'cancel',
			expectedRevision: 0,
		}),
		(error) => error instanceof TRPCError && error.code === 'CONFLICT',
	);
	await assert.rejects(
		supporterChangeStatus(other.actorId, {
			operationId: quote.operationId,
		}),
		(error) => error instanceof TRPCError && error.code === 'NOT_FOUND',
	);
	assert.equal(
		(await listSupporterChanges(other.actorId, { subscriptionId: f.id }))
			.length,
		0,
	);
	await db
		.update(users)
		.set({ frozenAt: new Date() })
		.where(eq(users.id, f.actorId));
	await assert.rejects(
		confirmSupporterChange(f.actorId, { operationId: quote.operationId }),
		/frozen/,
	);
	await db
		.update(users)
		.set({ frozenAt: null })
		.where(eq(users.id, f.actorId));
	f.raw.cancel_at_period_end = true;
	await assert.rejects(
		confirmSupporterChange(f.actorId, { operationId: quote.operationId }),
		/Billing changed/,
	);
	f.raw.cancel_at_period_end = false;
	const current = await change(quote.operationId);
	await db.transaction((tx) =>
		admitSupporterChange(
			tx,
			f.actorId,
			current.id,
			current.providerFingerprint,
		),
	);
	await db
		.update(supporterChanges)
		.set({
			step: 'upgrade_mutation',
			providerStartedAt: new Date(Date.now() - 24 * 60 * 60_000),
		})
		.where(eq(supporterChanges.id, quote.operationId));
	const calls = mutateCalls;
	assert.equal(
		(await reconcileSupporterChange(quote.operationId)).status,
		'recovery_required',
	);
	assert.equal(
		mutateCalls,
		calls,
		'expired idempotency window must not send another update',
	);
	assert.equal((await row(f.id)).activeMutationId, quote.operationId);
});
