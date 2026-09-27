import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core';
import { asks, createTable, users } from './schema';

const createdAt = () =>
	timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

/** One Accounts v2 identity can buy and receive; configuration is expanded on demand. */
export const paymentAccounts = createTable(
	'payment_account',
	{
		userId: varchar('user_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		stripeAccountId: varchar('stripe_account_id', {
			length: 255,
		}).notNull(),
		livemode: boolean('livemode').notNull(),
		recipientRequested: boolean('recipient_requested')
			.notNull()
			.default(false),
		transfersActive: boolean('transfers_active').notNull().default(false),
		payoutsActive: boolean('payouts_active').notNull().default(false),
		requirements: jsonb('requirements')
			.$type<string[]>()
			.notNull()
			.default([]),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.livemode] }),
		uniqueIndex('payment_account_stripe_unique').on(t.stripeAccountId),
	],
);

/** Opt-in is separate from legacy pledges; only empty USD money Asks can enroll. */
export const paymentAskSettings = createTable(
	'payment_ask_settings',
	{
		askId: integer('ask_id')
			.primaryKey()
			.references(() => asks.id),
		goalAmount: integer('goal_amount').notNull(),
		pausedAt: timestamp('paused_at', { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [check('payment_ask_goal_positive', sql`${t.goalAmount} > 0`)],
);

export const communityFunds = createTable('community_fund', {
	id: uuid('id').primaryKey().defaultRandom(),
	slug: varchar('slug', { length: 160 }).notNull().unique(),
	name: varchar('name', { length: 160 }).notNull(),
	description: text('description').notNull(),
	currency: varchar('currency', { length: 3 }).notNull().default('usd'),
	active: boolean('active').notNull().default(true),
	createdById: varchar('created_by_id', { length: 255 })
		.notNull()
		.references(() => users.id),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export type PaymentKind = 'ask' | 'fund' | 'supporter';
export type PaymentStatus =
	| 'reserved'
	| 'checkout_open'
	| 'pending'
	| 'succeeded'
	| 'failed'
	| 'expired'
	| 'partially_refunded'
	| 'refunded'
	| 'disputed';
export type FeeSnapshot = {
	version: string;
	platformBps: number;
	processingBps: number;
	processingFixed: number;
};

export const payments = createTable(
	'payment',
	{
		id: uuid('id').primaryKey(),
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		kind: varchar('kind', { length: 20 }).notNull().$type<PaymentKind>(),
		askId: integer('ask_id').references(() => asks.id),
		fundId: uuid('fund_id').references(() => communityFunds.id),
		tier: varchar('tier', { length: 20 }).$type<
			'supporter' | 'sustainer'
		>(),
		recurring: boolean('recurring').notNull().default(false),
		livemode: boolean('livemode').notNull(),
		currency: varchar('currency', { length: 3 }).notNull().default('usd'),
		requestHash: varchar('request_hash', { length: 64 }).notNull(),
		grossAmount: integer('gross_amount').notNull(),
		platformFee: integer('platform_fee').notNull(),
		processingEstimate: integer('processing_estimate').notNull(),
		recipientAmount: integer('recipient_amount').notNull(),
		feeSnapshot: jsonb('fee_snapshot').notNull().$type<FeeSnapshot>(),
		refundedAmount: integer('refunded_amount').notNull().default(0),
		refundedRecipientAmount: integer('refunded_recipient_amount')
			.notNull()
			.default(0),
		actualProcessingFee: integer('actual_processing_fee'),
		allocatedAmount: integer('allocated_amount').notNull().default(0),
		disputedAmount: integer('disputed_amount').notNull().default(0),
		disputePendingAmount: integer('dispute_pending_amount')
			.notNull()
			.default(0),
		status: varchar('status', { length: 30 })
			.notNull()
			.$type<PaymentStatus>()
			.default('reserved'),
		checkoutId: varchar('checkout_id', { length: 255 }).unique(),
		checkoutUrl: text('checkout_url'),
		paymentIntentId: varchar('payment_intent_id', { length: 255 }).unique(),
		chargeId: varchar('charge_id', { length: 255 }).unique(),
		invoiceId: varchar('invoice_id', { length: 255 }).unique(),
		entitlementPeriodEnd: timestamp('entitlement_period_end', {
			withTimezone: true,
		}),
		subscriptionId: varchar('subscription_id', { length: 255 }),
		destinationAccountId: varchar('destination_account_id', {
			length: 255,
		}),
		transferId: varchar('transfer_id', { length: 255 }),
		receiptUrl: text('receipt_url'),
		availableAt: timestamp('available_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		lastError: varchar('last_error', { length: 500 }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index('payment_actor_idx').on(t.actorId, t.createdAt),
		index('payment_ask_idx').on(t.askId),
		index('payment_fund_idx').on(t.fundId),
		index('payment_recovery_idx').on(t.status, t.updatedAt),
		check(
			'payment_amounts_valid',
			sql`${t.grossAmount} > 0 AND ${t.platformFee} >= 0 AND ${t.processingEstimate} >= 0 AND ${t.recipientAmount} >= 0 AND ${t.grossAmount} = ${t.platformFee} + ${t.processingEstimate} + ${t.recipientAmount}`,
		),
		check(
			'payment_refund_valid',
			sql`${t.refundedAmount} BETWEEN 0 AND ${t.grossAmount} AND ${t.refundedRecipientAmount} BETWEEN 0 AND ${t.recipientAmount}`,
		),
		check(
			'payment_kind_valid',
			sql`${t.kind} IN ('ask','fund','supporter')`,
		),
		check(
			'payment_status_valid',
			sql`${t.status} IN ('reserved','checkout_open','pending','succeeded','failed','expired','partially_refunded','refunded','disputed')`,
		),
	],
);

export const paymentSubscriptions = createTable(
	'payment_subscription',
	{
		id: varchar('id', { length: 255 }).primaryKey(),
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		accountId: varchar('account_id', { length: 255 }).notNull(),
		livemode: boolean('livemode').notNull(),
		kind: varchar('kind', { length: 20 })
			.notNull()
			.$type<'supporter' | 'fund'>(),
		fundId: uuid('fund_id').references(() => communityFunds.id),
		tier: varchar('tier', { length: 20 }).$type<
			'supporter' | 'sustainer'
		>(),
		priceId: varchar('price_id', { length: 255 }),
		itemId: varchar('item_id', { length: 255 }),
		periodStart: timestamp('period_start', { withTimezone: true }),
		periodEnd: timestamp('period_end', { withTimezone: true }),
		scheduleId: varchar('schedule_id', { length: 255 }),
		latestInvoiceId: varchar('latest_invoice_id', { length: 255 }),
		pendingUpdateExpiresAt: timestamp('pending_update_expires_at', {
			withTimezone: true,
		}),
		providerObservedAt: timestamp('provider_observed_at', {
			withTimezone: true,
		}),
		providerReadRevision: integer('provider_read_revision')
			.notNull()
			.default(0),
		providerReadLeaseUntil: timestamp('provider_read_lease_until', {
			withTimezone: true,
		}),
		changeRevision: integer('change_revision').notNull().default(0),
		activeMutationId: uuid('active_mutation_id'),
		pendingChangeId: uuid('pending_change_id'),
		status: varchar('status', { length: 40 }).notNull(),
		paidThrough: timestamp('paid_through', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end')
			.notNull()
			.default(false),
		feeSnapshot: jsonb('fee_snapshot').$type<FeeSnapshot>().notNull(),
		initialPaymentId: uuid('initial_payment_id')
			.notNull()
			.references(() => payments.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index('payment_subscription_actor_idx').on(t.actorId),
		uniqueIndex('one_active_supporter_subscription')
			.on(t.actorId, t.livemode)
			.where(
				sql`${t.kind} = 'supporter' AND ${t.status} NOT IN ('canceled','incomplete_expired')`,
			),
	],
);

/** Immutable invoice-line provenance. End-only legacy projections never grant access. */
export const supporterPaidCoverage = createTable(
	'supporter_paid_coverage',
	{
		invoiceLineId: varchar('invoice_line_id', { length: 255 }).notNull(),
		livemode: boolean('livemode').notNull(),
		invoiceId: varchar('invoice_id', { length: 255 }).notNull(),
		paymentId: uuid('payment_id')
			.notNull()
			.references(() => payments.id),
		subscriptionId: varchar('subscription_id', { length: 255 })
			.notNull()
			.references(() => paymentSubscriptions.id),
		priceId: varchar('price_id', { length: 255 }).notNull(),
		/** Null only for pre-0018 rows, filled from a verified same-invoice replay. */
		itemId: varchar('item_id', { length: 255 }),
		tier: varchar('tier', { length: 20 })
			.notNull()
			.$type<'supporter' | 'sustainer'>(),
		periodStart: timestamp('period_start', {
			withTimezone: true,
		}).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		proration: boolean('proration').notNull(),
		appliedAt: timestamp('applied_at', { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.invoiceLineId, t.livemode] }),
		index('supporter_coverage_subscription_idx').on(
			t.subscriptionId,
			t.periodStart,
			t.periodEnd,
		),
		index('supporter_coverage_payment_idx').on(t.paymentId),
		check(
			'supporter_coverage_period_valid',
			sql`${t.periodStart} < ${t.periodEnd}`,
		),
		check(
			'supporter_coverage_tier_valid',
			sql`${t.tier} IN ('supporter','sustainer')`,
		),
	],
);

/** Minimal authenticated pending-update snapshot; never inferred from current tier. */
export const supporterApplicationEvidence = createTable(
	'supporter_application_evidence',
	{
		stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
		livemode: boolean('livemode').notNull(),
		platformAccountId: varchar('platform_account_id', {
			length: 255,
		}).notNull(),
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		accountId: varchar('account_id', { length: 255 }).notNull(),
		subscriptionId: varchar('subscription_id', { length: 255 })
			.notNull()
			.references(() => paymentSubscriptions.id),
		invoiceId: varchar('invoice_id', { length: 255 }).notNull(),
		itemId: varchar('item_id', { length: 255 }).notNull(),
		priceId: varchar('price_id', { length: 255 }).notNull(),
		periodStart: timestamp('period_start', {
			withTimezone: true,
		}).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		providerCreatedAt: timestamp('provider_created_at', {
			withTimezone: true,
		}).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.stripeEventId, t.livemode] }),
		index('supporter_application_invoice_idx').on(
			t.subscriptionId,
			t.invoiceId,
			t.livemode,
		),
		check(
			'supporter_application_period_valid',
			sql`${t.periodStart} < ${t.periodEnd}`,
		),
	],
);

export type SupporterChangeAction =
	'upgrade' | 'downgrade' | 'undo' | 'cancel' | 'resume';
export type SupporterChangeStatus =
	| 'quoted'
	| 'reserved'
	| 'processing'
	| 'pending_payment'
	| 'scheduled'
	| 'applied'
	| 'expired'
	| 'failed'
	| 'recovery_required';
export const supporterChanges = createTable(
	'supporter_change',
	{
		id: uuid('id').primaryKey(),
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		subscriptionId: varchar('subscription_id', { length: 255 })
			.notNull()
			.references(() => paymentSubscriptions.id),
		livemode: boolean('livemode').notNull(),
		action: varchar('action', { length: 24 })
			.notNull()
			.$type<SupporterChangeAction>(),
		requestHash: varchar('request_hash', { length: 64 }).notNull(),
		expectedRevision: integer('expected_revision').notNull(),
		sourcePriceId: varchar('source_price_id', { length: 255 }).notNull(),
		sourcePeriodEnd: timestamp('source_period_end', { withTimezone: true }),
		targetPriceId: varchar('target_price_id', { length: 255 }),
		itemId: varchar('item_id', { length: 255 }).notNull(),
		providerFingerprint: varchar('provider_fingerprint', {
			length: 64,
		}).notNull(),
		prorationDate: integer('proration_date'),
		quoteAmount: integer('quote_amount'),
		quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true }),
		effectiveAt: timestamp('effective_at', { withTimezone: true }),
		invoiceId: varchar('invoice_id', { length: 255 }),
		paymentIntentId: varchar('payment_intent_id', { length: 255 }),
		scheduleId: varchar('schedule_id', { length: 255 }),
		status: varchar('status', { length: 32 })
			.notNull()
			.$type<SupporterChangeStatus>()
			.default('quoted'),
		step: varchar('step', { length: 64 }).notNull().default('quote'),
		providerStartedAt: timestamp('provider_started_at', {
			withTimezone: true,
		}),
		leaseUntil: timestamp('lease_until', { withTimezone: true }),
		attempts: integer('attempts').notNull().default(0),
		lastError: varchar('last_error', { length: 500 }),
		targetOperationId: uuid('target_operation_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index('supporter_change_actor_idx').on(t.actorId, t.createdAt),
		index('supporter_change_recovery_idx').on(t.status, t.updatedAt),
		check(
			'supporter_change_action_valid',
			sql`${t.action} IN ('upgrade','downgrade','undo','cancel','resume')`,
		),
		check(
			'supporter_change_status_valid',
			sql`${t.status} IN ('quoted','reserved','processing','pending_payment','scheduled','applied','expired','failed','recovery_required')`,
		),
		check(
			'supporter_change_revision_valid',
			sql`${t.expectedRevision} >= 0 AND ${t.attempts} >= 0`,
		),
		check(
			'supporter_change_quote_valid',
			sql`${t.quoteAmount} IS NULL OR ${t.quoteAmount} >= 0`,
		),
	],
);

export const paymentWebhookInbox = createTable(
	'payment_webhook_inbox',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
		stripeAccountId: varchar('stripe_account_id', {
			length: 255,
		}).notNull(),
		livemode: boolean('livemode').notNull(),
		type: varchar('type', { length: 160 }).notNull(),
		/** Store only object IDs; retrieve authoritative state instead of persisting PII-heavy payloads. */
		objectId: varchar('object_id', { length: 255 }).notNull(),
		status: varchar('status', { length: 20 })
			.notNull()
			.$type<'pending' | 'processed' | 'failed' | 'ignored'>()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: varchar('last_error', { length: 500 }),
		processedAt: timestamp('processed_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex('payment_webhook_unique').on(
			t.stripeAccountId,
			t.livemode,
			t.stripeEventId,
		),
		index('payment_webhook_pending_idx').on(t.status, t.createdAt),
	],
);

export type LedgerLine = { account: string; amount: number };
export const paymentLedger = createTable(
	'payment_ledger',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		operationKey: varchar('operation_key', { length: 255 })
			.notNull()
			.unique(),
		paymentId: uuid('payment_id').references(() => payments.id),
		fundId: uuid('fund_id').references(() => communityFunds.id),
		currency: varchar('currency', { length: 3 }).notNull().default('usd'),
		livemode: boolean('livemode').notNull(),
		/** Signed minor units. Every persisted journal must sum to zero. Never update a journal. */
		lines: jsonb('lines').$type<LedgerLine[]>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		index('payment_ledger_payment_idx').on(t.paymentId),
		index('payment_ledger_fund_idx').on(t.fundId),
	],
);

export const fundAllocations = createTable(
	'fund_allocation',
	{
		id: uuid('id').primaryKey(),
		fundId: uuid('fund_id')
			.notNull()
			.references(() => communityFunds.id),
		askId: integer('ask_id')
			.notNull()
			.references(() => asks.id),
		approvedById: varchar('approved_by_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		amount: integer('amount').notNull(),
		reversedAmount: integer('reversed_amount').notNull().default(0),
		reason: text('reason').notNull(),
		livemode: boolean('livemode').notNull(),
		status: varchar('status', { length: 30 })
			.notNull()
			.$type<
				| 'reserved'
				| 'processing'
				| 'completed'
				| 'recovery_required'
				| 'reversed'
			>()
			.default('reserved'),
		destinationAccountId: varchar('destination_account_id', {
			length: 255,
		}).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index('fund_allocation_fund_idx').on(t.fundId),
		check('fund_allocation_amount_positive', sql`${t.amount} > 0`),
	],
);

export const fundAllocationSources = createTable(
	'fund_allocation_source',
	{
		allocationId: uuid('allocation_id')
			.notNull()
			.references(() => fundAllocations.id),
		paymentId: uuid('payment_id')
			.notNull()
			.references(() => payments.id),
		amount: integer('amount').notNull(),
		reversedAmount: integer('reversed_amount').notNull().default(0),
		transferId: varchar('transfer_id', { length: 255 }).unique(),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.allocationId, t.paymentId] }),
		check(
			'fund_allocation_source_amount_positive',
			sql`${t.amount} > 0 AND ${t.reversedAmount} BETWEEN 0 AND ${t.amount}`,
		),
	],
);

export const paymentOperations = createTable('payment_operation', {
	id: uuid('id').primaryKey(),
	kind: varchar('kind', { length: 40 })
		.notNull()
		.$type<
			| 'refund'
			| 'dispute_reversal'
			| 'dispute_restoration'
			| 'allocation_reversal'
		>(),
	paymentId: uuid('payment_id').references(() => payments.id),
	actorId: varchar('actor_id', { length: 255 }).references(() => users.id),
	amount: integer('amount').notNull(),
	reason: text('reason').notNull(),
	status: varchar('status', { length: 30 })
		.notNull()
		.$type<'pending' | 'succeeded' | 'recovery_required' | 'failed'>()
		.default('pending'),
	stripeObjectId: varchar('stripe_object_id', { length: 255 }),
	lastError: varchar('last_error', { length: 500 }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const paymentCases = createTable('payment_case', {
	id: uuid('id').primaryKey().defaultRandom(),
	key: varchar('key', { length: 255 }).notNull().unique(),
	paymentId: uuid('payment_id').references(() => payments.id),
	accountId: varchar('account_id', { length: 255 }),
	category: varchar('category', { length: 60 }).notNull(),
	summary: varchar('summary', { length: 500 }).notNull(),
	stripeObjectId: varchar('stripe_object_id', { length: 255 }),
	resolvedAt: timestamp('resolved_at', { withTimezone: true }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});
