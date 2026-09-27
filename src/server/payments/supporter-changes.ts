import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type Stripe from 'stripe';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import {
	paymentSubscriptions,
	paymentAccounts,
	supporterChanges,
	supporterPaidCoverage,
	payments,
} from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import { paymentConfiguration, requirePaymentFeature } from './config';
import {
	assertEntitlementMutationAllowed,
	entitlementTime,
} from './entitlement-time';
import type { PaymentTransaction } from './ledger';
import { reconcileInvoice, synchronizeSubscription } from './reconcile';
import { paymentErrorCode, stripeClient, stripeId } from './stripe';
import {
	assertChangeAction,
	changeHash,
	invoiceHandoff,
	pendingUpdatePaymentMethod,
	retryWithinProviderWindow,
	scheduleMatchesPlan,
	supporterChangeInput,
	supporterPrice,
	supporterState,
	validateOwnedSchedule,
	validateUpgradePreview,
	type SupporterChangeInput,
	type SupporterState,
} from './supporter-changes-policy';

export { supporterChangeInput } from './supporter-changes-policy';
export const supporterChangeOperationInput = z
	.object({ operationId: z.uuid() })
	.strict();
export const supporterChangeListInput = z
	.object({
		subscriptionId: z
			.string()
			.regex(/^sub_[A-Za-z0-9_]+$/)
			.max(255)
			.optional(),
		limit: z.number().int().min(1).max(50).default(20),
	})
	.strict();
type Change = typeof supporterChanges.$inferSelect;
type Subscription = typeof paymentSubscriptions.$inferSelect;
const terminal = new Set<Change['status']>(['applied', 'expired', 'failed']);
const pending = new Set<Change['status']>(['scheduled', 'pending_payment']);
const QUOTE_MS = 5 * 60_000;
const LEASE_MS = 5 * 60_000;
class UnsentFrozenChange extends Error {
	constructor() {
		super(
			'This change was not sent because the account was frozen. No new charge or renewal resumption was requested. Review a new preview after the account is restored.',
		);
	}
}
function conflict(
	message = 'Billing changed. Refresh and review a new preview.',
) {
	return new TRPCError({ code: 'CONFLICT', message });
}
function precondition(message: string) {
	return new TRPCError({ code: 'PRECONDITION_FAILED', message });
}
function prices() {
	const supporter = process.env['STRIPE_SUPPORTER_PRICE_ID'];
	const sustainer = process.env['STRIPE_SUSTAINER_PRICE_ID'];
	if (!supporter || !sustainer || supporter === sustainer)
		throw precondition('Supporter prices are not configured.');
	return { supporter, sustainer };
}
function dto(op: Change, invoiceUrl: string | null = null) {
	const configured = {
		supporter: process.env['STRIPE_SUPPORTER_PRICE_ID'],
		sustainer: process.env['STRIPE_SUSTAINER_PRICE_ID'],
	};
	const tier = (id: string | null) =>
		id === configured.supporter ? ('supporter' as const)
		: id === configured.sustainer ? ('sustainer' as const)
		: null;
	return {
		operationId: op.id,
		subscriptionId: op.subscriptionId,
		action: op.action,
		status: op.status,
		sourceTier: tier(op.sourcePriceId),
		targetTier: tier(op.targetPriceId),
		quoteAmount: op.quoteAmount,
		currency: 'usd' as const,
		quoteExpiresAt: op.quoteExpiresAt,
		effectiveAt: op.effectiveAt,
		expectedRevision: op.expectedRevision,
		invoiceUrl,
		lastError: op.lastError,
		canConfirm:
			op.status === 'quoted' &&
			Boolean(
				op.quoteExpiresAt && op.quoteExpiresAt.getTime() > Date.now(),
			),
		canUndo:
			(op.status === 'pending_payment' && op.action === 'upgrade') ||
			(op.status === 'scheduled' &&
				(op.action === 'downgrade' ||
					(op.action === 'cancel' && Boolean(op.scheduleId)))),
	};
}
async function memberDto(
	op: Change,
	member: { frozenAt: Date | null },
	invoiceUrl: string | null = null,
) {
	const result = dto(op, member.frozenAt ? null : invoiceUrl);
	if (!member.frozenAt) return result;
	const [target] =
		op.action === 'undo' && op.targetOperationId ?
			await db
				.select({ action: supporterChanges.action })
				.from(supporterChanges)
				.where(
					and(
						eq(supporterChanges.id, op.targetOperationId),
						eq(supporterChanges.actorId, op.actorId),
						eq(supporterChanges.subscriptionId, op.subscriptionId),
						eq(supporterChanges.livemode, op.livemode),
					),
				)
		:	[];
	return {
		...result,
		canConfirm: result.canConfirm && mayStopBilling(op.action, target),
		canUndo:
			result.canUndo &&
			op.action === 'upgrade' &&
			op.status === 'pending_payment',
	};
}
async function operation(id: string) {
	const [op] = await db
		.select()
		.from(supporterChanges)
		.where(eq(supporterChanges.id, id));
	if (!op || op.livemode !== paymentConfiguration().livemode)
		throw new TRPCError({ code: 'NOT_FOUND' });
	return op;
}
async function ownOperation(actorId: string, id: string) {
	await billingMember(actorId);
	const op = await operation(id);
	if (op.actorId !== actorId) throw new TRPCError({ code: 'NOT_FOUND' });
	return op;
}
async function billingMember(actorId: string) {
	const [member] = await db
		.select({
			id: users.id,
			frozenAt: users.frozenAt,
			emailVerified: users.emailVerified,
		})
		.from(users)
		.where(eq(users.id, actorId));
	if (!member?.emailVerified)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Verify your email before managing billing.',
		});
	return member;
}
function mayStopBilling(
	action: Change['action'],
	target?: Pick<Change, 'action'>,
) {
	return (
		action === 'cancel' ||
		(action === 'undo' && target?.action === 'upgrade')
	);
}
function checkMemberAction(
	member: { frozenAt: Date | null },
	action: Change['action'],
	target?: Pick<Change, 'action'>,
) {
	if (member.frozenAt && !mayStopBilling(action, target))
		throw new TRPCError({
			code: 'FORBIDDEN',
			message:
				'This account is frozen. You can still cancel renewal or cancel an unpaid upgrade.',
		});
}
async function ownSubscription(actorId: string, id: string) {
	const [sub] = await db
		.select()
		.from(paymentSubscriptions)
		.where(
			and(
				eq(paymentSubscriptions.id, id),
				eq(paymentSubscriptions.actorId, actorId),
				eq(paymentSubscriptions.kind, 'supporter'),
				eq(
					paymentSubscriptions.livemode,
					paymentConfiguration().livemode,
				),
			),
		);
	if (!sub) throw new TRPCError({ code: 'NOT_FOUND' });
	return sub;
}
async function authoritativeNow(actorId: string) {
	const time = await entitlementTime(actorId);
	if (time.status !== 'ready')
		throw precondition(
			'Billing time is reconciling. Wait until the sandbox clock is ready.',
		);
	return Math.floor(time.asOf.getTime() / 1000);
}
async function targetFor(
	sub: Subscription,
	input: Pick<SupporterChangeInput, 'targetOperationId'>,
) {
	if (input.targetOperationId !== (sub.pendingChangeId ?? undefined)) {
		if (input.targetOperationId || sub.pendingChangeId)
			throw conflict(
				'Select the exact pending change shown in current billing.',
			);
		return undefined;
	}
	if (!input.targetOperationId) return undefined;
	const target = await operation(input.targetOperationId);
	if (
		target.actorId !== sub.actorId ||
		target.subscriptionId !== sub.id ||
		!pending.has(target.status)
	)
		throw conflict();
	return target;
}
function stateFor(
	raw: Stripe.Subscription,
	sub: Subscription,
	asOf: number,
	target?: Change,
	allowPending = false,
	allowUnpaidManagement = false,
) {
	const configured = prices();
	return supporterState(raw, {
		subscriptionId: sub.id,
		accountId: sub.accountId,
		livemode: sub.livemode,
		supporterPriceId: configured.supporter,
		sustainerPriceId: configured.sustainer,
		asOf,
		ownedScheduleId: target?.scheduleId ?? null,
		allowPending,
		allowUnpaidManagement,
	});
}
async function providerSubscription(sub: Subscription) {
	const raw = await stripeClient().subscriptions.retrieve(sub.id);
	if (
		raw.id !== sub.id ||
		raw.customer_account !== sub.accountId ||
		raw.livemode !== sub.livemode
	)
		throw precondition(
			'Subscription ownership or environment requires review.',
		);
	return raw;
}
async function readState(
	sub: Subscription,
	asOf: number,
	target?: Change,
	allowPending = false,
	allowUnpaidManagement = false,
) {
	return stateFor(
		await providerSubscription(sub),
		sub,
		asOf,
		target,
		allowPending,
		allowUnpaidManagement,
	);
}
async function ownedInvoice(id: string, sub: Subscription) {
	const invoice = await stripeClient().invoices.retrieve(id);
	if (
		invoice.id !== id ||
		invoice.livemode !== sub.livemode ||
		invoice.customer_account !== sub.accountId ||
		stripeId(invoice.parent?.subscription_details?.subscription) !==
			sub.id ||
		invoice.currency !== 'usd'
	)
		throw precondition('Invoice ownership or environment requires review.');
	return invoice;
}
async function currentInvoicePaid(state: SupporterState, sub: Subscription) {
	const invoice = await ownedInvoice(state.invoiceId, sub);
	if (
		invoice.status !== 'paid' ||
		invoice.amount_remaining !== 0 ||
		invoice.amount_paid <= 0
	)
		throw precondition(
			'Resolve the current unpaid invoice before changing your plan.',
		);
}
async function checkPaymentMethod(state: SupporterState, sub: Subscription) {
	let methodId = state.defaultPaymentMethodId;
	if (!methodId) {
		const account = await stripeClient().v2.core.accounts.retrieve(
			sub.accountId,
			{ include: ['configuration.customer'] },
		);
		if (account.id !== sub.accountId || account.livemode !== sub.livemode)
			throw precondition('Customer ownership requires review.');
		methodId =
			account.configuration?.customer?.billing?.default_payment_method ??
			null;
	}
	if (!methodId)
		throw precondition(
			'Add a supported default payment method in billing management before upgrading.',
		);
	const method = await stripeClient().paymentMethods.retrieve(methodId);
	if (
		method.livemode !== sub.livemode ||
		method.customer_account !== sub.accountId ||
		!pendingUpdatePaymentMethod(method.type)
	)
		throw precondition(
			'This payment method does not support a pay-before-upgrade change. Update it in billing management.',
		);
}
async function upgradeQuote(
	state: SupporterState,
	sub: Subscription,
	prorationDate: number,
	targetPriceId: string,
) {
	const invoice = await stripeClient().invoices.createPreview({
		customer_account: sub.accountId,
		subscription: sub.id,
		subscription_details: {
			items: [{ id: state.itemId, price: targetPriceId, quantity: 1 }],
			proration_behavior: 'always_invoice',
			proration_date: prorationDate,
		},
	});
	return validateUpgradePreview(invoice, {
		accountId: sub.accountId,
		subscriptionId: sub.id,
		livemode: sub.livemode,
		itemId: state.itemId,
		sourcePriceId: state.priceId,
		targetPriceId,
		prorationDate,
		periodEnd: state.periodEnd,
	});
}
async function exactSchedule(target: Change, sub: Subscription) {
	if (!target.scheduleId)
		throw precondition('The owned schedule needs reconciliation.');
	return validateOwnedSchedule(
		await stripeClient().subscriptionSchedules.retrieve(target.scheduleId),
		{
			id: target.scheduleId,
			accountId: sub.accountId,
			subscriptionId: sub.id,
			livemode: sub.livemode,
		},
	);
}

/** Quotes are immutable. A changed quote always requires a new UUID and consent. */
export async function previewSupporterChange(
	actorId: string,
	raw: SupporterChangeInput,
) {
	const input = supporterChangeInput.parse(raw);
	const member = await billingMember(actorId);
	if (input.action === 'upgrade' || input.action === 'downgrade')
		requirePaymentFeature('supporter');
	else if (!paymentConfiguration().configured)
		throw precondition('Stripe is not configured.');
	const requestHash = changeHash(input);
	const [existing] = await db
		.select()
		.from(supporterChanges)
		.where(eq(supporterChanges.id, input.operationId));
	if (existing) {
		if (existing.actorId !== actorId)
			throw new TRPCError({ code: 'NOT_FOUND' });
		if (
			existing.requestHash !== requestHash ||
			existing.livemode !== paymentConfiguration().livemode
		)
			throw conflict('This operation ID belongs to another request.');
		return memberDto(existing, member);
	}
	const sub = await ownSubscription(actorId, input.subscriptionId);
	if (sub.changeRevision !== input.expectedRevision || sub.activeMutationId)
		throw conflict();
	const target = await targetFor(sub, input);
	checkMemberAction(member, input.action, target);
	await assertEntitlementMutationAllowed(actorId);
	const asOf = await authoritativeNow(actorId);
	const state = await readState(
		sub,
		asOf,
		target,
		input.action === 'undo' && target?.action === 'upgrade',
		input.action === 'cancel' || input.action === 'resume',
	);
	try {
		assertChangeAction(input.action, state, target);
	} catch (error) {
		throw precondition(
			error instanceof Error ?
				error.message
			:	'This change is not available.',
		);
	}
	if (target?.scheduleId) {
		const schedule = await exactSchedule(target, sub);
		if (
			!['downgrade', 'cancel'].includes(target.action) ||
			!target.effectiveAt ||
			!scheduleMatchesPlan(schedule, {
				action: target.action as 'downgrade' | 'cancel',
				sourcePriceId: target.sourcePriceId,
				targetPriceId: target.targetPriceId,
				periodEnd: Math.floor(target.effectiveAt.getTime() / 1000),
			})
		)
			throw precondition(
				'The scheduled change was modified outside GiveToGive. Review billing before continuing.',
			);
	}
	if (input.action === 'upgrade' || input.action === 'downgrade')
		await currentInvoicePaid(state, sub);
	const configured = prices();
	const targetPriceId =
		input.action === 'upgrade' ? configured.sustainer
		: input.action === 'downgrade' ? configured.supporter
		: null;
	let amount = 0;
	if (targetPriceId) {
		const targetPrice = supporterPrice(
			await stripeClient().prices.retrieve(targetPriceId),
			targetPriceId,
			input.action === 'upgrade' ? 1500 : 500,
			sub.livemode,
		);
		if (targetPrice.productId === state.productId)
			throw precondition(
				'Supporter tiers must have separate configured products.',
			);
	}
	if (input.action === 'upgrade') {
		await checkPaymentMethod(state, sub);
		amount = await upgradeQuote(state, sub, asOf, targetPriceId!);
	}
	const values: typeof supporterChanges.$inferInsert = {
		id: input.operationId,
		actorId,
		subscriptionId: sub.id,
		livemode: sub.livemode,
		action: input.action,
		requestHash,
		expectedRevision: input.expectedRevision,
		sourcePriceId: state.priceId,
		targetPriceId,
		itemId: state.itemId,
		providerFingerprint: state.fingerprint,
		sourcePeriodEnd: new Date(state.periodEnd * 1000),
		prorationDate: input.action === 'upgrade' ? asOf : null,
		quoteAmount: amount,
		quoteExpiresAt: new Date(Date.now() + QUOTE_MS),
		effectiveAt: new Date(
			(['cancel', 'downgrade'].includes(input.action) ?
				state.periodEnd
			:	asOf) * 1000,
		),
		targetOperationId: input.targetOperationId,
	};
	const op = await db.transaction(async (tx) => {
		await lockMember(
			tx,
			actorId,
			true,
			mayStopBilling(input.action, target),
		);
		const [locked] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, sub.id))
			.for('update');
		if (
			!locked ||
			locked.changeRevision !== input.expectedRevision ||
			locked.activeMutationId ||
			locked.pendingChangeId !== sub.pendingChangeId
		)
			throw conflict();
		await tx.insert(supporterChanges).values(values).onConflictDoNothing();
		const [result] = await tx
			.select()
			.from(supporterChanges)
			.where(eq(supporterChanges.id, input.operationId));
		if (
			!result ||
			result.actorId !== actorId ||
			result.requestHash !== requestHash
		)
			throw conflict('This operation ID belongs to another request.');
		return result;
	});
	return memberDto(op, member);
}

async function lockMember(
	tx: PaymentTransaction,
	actorId: string,
	requireEligible = true,
	allowFrozen = false,
) {
	const [member] = await tx
		.select({
			id: users.id,
			emailVerified: users.emailVerified,
			frozenAt: users.frozenAt,
		})
		.from(users)
		.where(eq(users.id, actorId))
		.for('update');
	if (
		!member ||
		(requireEligible &&
			(!member.emailVerified || (member.frozenAt && !allowFrozen)))
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	return member;
}

/** Separate-transaction admission seam. No provider calls may occur in this function. */
export async function admitSupporterChange(
	tx: PaymentTransaction,
	actorId: string,
	operationId: string,
	fingerprint: string,
) {
	const [candidate] = await tx
		.select()
		.from(supporterChanges)
		.where(eq(supporterChanges.id, operationId));
	if (
		!candidate ||
		candidate.actorId !== actorId ||
		candidate.livemode !== paymentConfiguration().livemode
	)
		throw new TRPCError({ code: 'NOT_FOUND' });
	const [target] =
		candidate.targetOperationId ?
			await tx
				.select({ action: supporterChanges.action })
				.from(supporterChanges)
				.where(eq(supporterChanges.id, candidate.targetOperationId))
		:	[];
	await lockMember(
		tx,
		actorId,
		true,
		mayStopBilling(candidate.action, target),
	);
	const [sub] = await tx
		.select()
		.from(paymentSubscriptions)
		.where(eq(paymentSubscriptions.id, candidate.subscriptionId))
		.for('update');
	const [op] = await tx
		.select()
		.from(supporterChanges)
		.where(eq(supporterChanges.id, operationId))
		.for('update');
	if (
		!sub ||
		!op ||
		sub.actorId !== actorId ||
		sub.kind !== 'supporter' ||
		sub.livemode !== op.livemode
	)
		throw new TRPCError({ code: 'NOT_FOUND' });
	if (op.status !== 'quoted') return op;
	if (!op.quoteExpiresAt || op.quoteExpiresAt.getTime() <= Date.now())
		throw precondition(
			'This preview expired. Review a new preview before confirming.',
		);
	if (
		op.providerFingerprint !== fingerprint ||
		op.expectedRevision !== sub.changeRevision ||
		sub.activeMutationId ||
		sub.pendingChangeId !== op.targetOperationId
	)
		throw conflict();
	await tx
		.update(paymentSubscriptions)
		.set({
			activeMutationId: op.id,
			changeRevision: sql`${paymentSubscriptions.changeRevision} + 1`,
		})
		.where(eq(paymentSubscriptions.id, sub.id));
	const [reserved] = await tx
		.update(supporterChanges)
		.set({ status: 'reserved', step: 'admitted' })
		.where(eq(supporterChanges.id, op.id))
		.returning();
	await recordEvent(
		{
			externalId: `supporter-change-admitted:${op.id}`,
			actorId,
			entityType: 'subscription',
			entityId: sub.id,
			action: 'supporter_change_admitted',
			outcome: 'pending',
			correlationId: op.id,
			summary: 'Member confirmed an immutable supporter billing change.',
			details: {
				action: op.action,
				quoteAmount: op.quoteAmount,
				expectedRevision: op.expectedRevision,
			},
		},
		tx,
	);
	return reserved!;
}

export async function confirmSupporterChange(
	actorId: string,
	raw: z.infer<typeof supporterChangeOperationInput>,
) {
	const { operationId } = supporterChangeOperationInput.parse(raw);
	const op = await ownOperation(actorId, operationId);
	if (op.status !== 'quoted')
		return supporterChangeStatus(actorId, { operationId });
	if (op.action === 'upgrade' || op.action === 'downgrade')
		requirePaymentFeature('supporter');
	const sub = await ownSubscription(actorId, op.subscriptionId);
	const target = await targetFor(sub, {
		targetOperationId: op.targetOperationId ?? undefined,
	});
	checkMemberAction(await billingMember(actorId), op.action, target);
	await assertEntitlementMutationAllowed(actorId);
	const state = await readState(
		sub,
		await authoritativeNow(actorId),
		target,
		op.action === 'undo' && target?.action === 'upgrade',
		op.action === 'cancel' || op.action === 'resume',
	);
	if (state.fingerprint !== op.providerFingerprint) throw conflict();
	if (op.action === 'upgrade') {
		await currentInvoicePaid(state, sub);
		await checkPaymentMethod(state, sub);
		if (
			(await upgradeQuote(
				state,
				sub,
				op.prorationDate!,
				op.targetPriceId!,
			)) !== op.quoteAmount
		)
			throw conflict(
				'The amount changed. Review a new preview before confirming.',
			);
	}
	await db.transaction((tx) =>
		admitSupporterChange(tx, actorId, operationId, state.fingerprint),
	);
	// The caller enqueues the durable hosted workflow after this commit. This
	// authenticated request never performs a provider mutation inline.
	return supporterChangeStatus(actorId, { operationId });
}

async function claim(op: Change) {
	return db.transaction(async (tx) => {
		await lockMember(tx, op.actorId, false);
		const [sub] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, op.subscriptionId))
			.for('update');
		const [current] = await tx
			.select()
			.from(supporterChanges)
			.where(eq(supporterChanges.id, op.id))
			.for('update');
		if (
			!sub ||
			!current ||
			terminal.has(current.status) ||
			current.status === 'quoted' ||
			(current.leaseUntil && current.leaseUntil.getTime() > Date.now())
		)
			return null;
		// Scheduled/pending operations may be superseded by an explicit undo/cancel.
		if (
			(sub.activeMutationId && sub.activeMutationId !== op.id) ||
			(!pending.has(current.status) && sub.activeMutationId !== op.id) ||
			(pending.has(current.status) &&
				sub.pendingChangeId !== op.id &&
				sub.activeMutationId !== op.id)
		)
			return null;
		const [leased] = await tx
			.update(supporterChanges)
			.set({
				attempts: current.attempts + 1,
				leaseUntil: new Date(Date.now() + LEASE_MS),
			})
			.where(eq(supporterChanges.id, op.id))
			.returning();
		return { op: leased!, sub };
	});
}
async function updateOwned(
	op: Change,
	patch: Partial<typeof supporterChanges.$inferInsert>,
	executor: Pick<PaymentTransaction, 'update'> = db,
) {
	const [updated] = await executor
		.update(supporterChanges)
		.set(patch)
		.where(
			and(
				eq(supporterChanges.id, op.id),
				eq(supporterChanges.attempts, op.attempts),
				sql`${supporterChanges.status} NOT IN ('applied','expired','failed')`,
			),
		)
		.returning();
	if (!updated) throw conflict('Another recovery worker owns this change.');
	return updated;
}
async function settle(
	op: Change,
	status: Change['status'],
	error: string | null = null,
) {
	return db.transaction(async (tx) => {
		await lockMember(tx, op.actorId, false);
		const [sub] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, op.subscriptionId))
			.for('update');
		const [current] = await tx
			.select()
			.from(supporterChanges)
			.where(eq(supporterChanges.id, op.id))
			.for('update');
		if (
			!sub ||
			!current ||
			terminal.has(current.status) ||
			current.attempts !== op.attempts ||
			(sub.activeMutationId && sub.activeMutationId !== op.id)
		)
			return current;
		const resolved = pending.has(status) || terminal.has(status);
		if (resolved) {
			await tx
				.update(paymentSubscriptions)
				.set({
					activeMutationId:
						sub.activeMutationId === op.id ?
							null
						:	sub.activeMutationId,
					pendingChangeId:
						pending.has(status) ? op.id
						: (
							sub.pendingChangeId === op.id ||
							(status === 'applied' &&
								sub.pendingChangeId === op.targetOperationId)
						) ?
							null
						:	sub.pendingChangeId,
				})
				.where(eq(paymentSubscriptions.id, sub.id));
			if (
				(status === 'applied' || status === 'scheduled') &&
				op.targetOperationId
			)
				await tx
					.update(supporterChanges)
					.set({
						status: 'expired',
						step: 'superseded',
						leaseUntil: null,
						lastError:
							'Superseded by the member’s verified billing change.',
					})
					.where(
						and(
							eq(supporterChanges.id, op.targetOperationId),
							inArray(supporterChanges.status, [
								'scheduled',
								'pending_payment',
							]),
						),
					);
		} else {
			// A previously scheduled/pending operation can discover ambiguity during
			// observation. Reacquire short-running ownership so recovery remains
			// claimable and another member mutation cannot race the unresolved state.
			await tx
				.update(paymentSubscriptions)
				.set({ activeMutationId: op.id })
				.where(eq(paymentSubscriptions.id, sub.id));
		}
		const [result] = await tx
			.update(supporterChanges)
			.set({
				status,
				leaseUntil: null,
				lastError: error,
				step: terminal.has(status) ? status : current.step,
			})
			.where(eq(supporterChanges.id, op.id))
			.returning();
		await recordEvent(
			{
				externalId: `supporter-change-state:${op.id}:${status}`,
				actorId: op.actorId,
				entityType: 'subscription',
				entityId: op.subscriptionId,
				action: `supporter_change_${status}`,
				outcome: status === 'applied' ? 'completed' : 'pending',
				correlationId: op.id,
				summary: 'Supporter change reconciled against provider state.',
				details: { action: op.action, status },
			},
			tx,
		);
		return result;
	});
}
async function startStep(op: Change, step: string) {
	return db.transaction(async (tx) => {
		// Serialize the durable send boundary with administrator freezes. Admission
		// alone is not permission to start a new upgrade/resumption after a freeze.
		// Once this marker commits, a crash can no longer distinguish an unsent
		// request from a lost Stripe response: preserve that stage and stable key.
		const member = await lockMember(tx, op.actorId, false);
		const [sub] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, op.subscriptionId))
			.for('update');
		const [current] = await tx
			.select()
			.from(supporterChanges)
			.where(eq(supporterChanges.id, op.id))
			.for('update');
		if (
			!sub ||
			!current ||
			sub.activeMutationId !== op.id ||
			current.attempts !== op.attempts ||
			current.step !== op.step ||
			terminal.has(current.status) ||
			!current.leaseUntil ||
			current.leaseUntil.getTime() <= Date.now()
		)
			throw conflict('Another recovery worker owns this change.');
		if (
			member.frozenAt &&
			(current.action === 'upgrade' || current.action === 'resume') &&
			!current.providerStartedAt
		) {
			if (
				current.step === 'admitted' &&
				!current.invoiceId &&
				!current.scheduleId
			)
				throw new UnsentFrozenChange();
			// Inconsistent/legacy evidence is not proof that no provider write ran.
			throw precondition(
				'The prior billing send boundary needs review. No new request was sent and no cancellation was assumed.',
			);
		}
		if (!retryWithinProviderWindow(current.providerStartedAt))
			throw precondition(
				'This ambiguous operation exceeded the safe retry window. Billing review is required; no duplicate request was sent.',
			);
		return updateOwned(
			current,
			{
				status: 'processing',
				step,
				providerStartedAt: current.providerStartedAt ?? new Date(),
			},
			tx,
		);
	});
}
function stepKey(op: Change, step: string) {
	return `supporter-change:${op.livemode ? 'live' : 'test'}:${op.id}:${step}`;
}

async function historicallyAppliedUpgrade(op: Change, sub: Subscription) {
	if (
		!op.invoiceId ||
		!op.sourcePeriodEnd ||
		op.prorationDate === null ||
		!op.targetPriceId
	)
		return false;
	const proof = await db
		.select({ id: supporterPaidCoverage.invoiceLineId })
		.from(supporterPaidCoverage)
		.innerJoin(payments, eq(payments.id, supporterPaidCoverage.paymentId))
		.innerJoin(
			paymentSubscriptions,
			eq(paymentSubscriptions.id, supporterPaidCoverage.subscriptionId),
		)
		.innerJoin(
			paymentAccounts,
			and(
				eq(paymentAccounts.userId, paymentSubscriptions.actorId),
				eq(paymentAccounts.livemode, paymentSubscriptions.livemode),
			),
		)
		.where(
			and(
				eq(paymentSubscriptions.id, sub.id),
				eq(paymentSubscriptions.actorId, op.actorId),
				eq(paymentSubscriptions.accountId, sub.accountId),
				eq(paymentSubscriptions.livemode, op.livemode),
				eq(paymentSubscriptions.kind, 'supporter'),
				eq(paymentAccounts.stripeAccountId, sub.accountId),
				eq(supporterPaidCoverage.invoiceId, op.invoiceId),
				eq(supporterPaidCoverage.itemId, op.itemId),
				eq(supporterPaidCoverage.priceId, op.targetPriceId),
				eq(
					supporterPaidCoverage.periodStart,
					new Date(op.prorationDate * 1000),
				),
				eq(supporterPaidCoverage.periodEnd, op.sourcePeriodEnd),
				eq(supporterPaidCoverage.livemode, op.livemode),
				eq(supporterPaidCoverage.proration, true),
				sql`${supporterPaidCoverage.appliedAt} IS NOT NULL`,
				eq(payments.actorId, op.actorId),
				eq(payments.livemode, op.livemode),
				eq(payments.kind, 'supporter'),
				eq(payments.invoiceId, op.invoiceId),
				eq(payments.subscriptionId, sub.id),
				sql`${payments.paidAt} IS NOT NULL`,
				sql`${payments.grossAmount} > 0`,
			),
		)
		.limit(1);
	// This is historical execution evidence, not an entitlement query. Refunds,
	// disputes and service dates still independently govern current recognition.
	return proof.length === 1;
}
async function verifyUpgradeResult(op: Change, sub: Subscription) {
	if (!op.invoiceId)
		return settle(
			op,
			'recovery_required',
			'The upgrade invoice is not yet known.',
		);
	const invoice = await ownedInvoice(op.invoiceId, sub);
	const raw = await providerSubscription(sub);
	if (invoice.status === 'void' && !raw.pending_update)
		return settle(
			op,
			'expired',
			'The unpaid upgrade expired or was canceled; no higher tier was granted.',
		);
	if (invoice.status === 'paid') {
		if (await historicallyAppliedUpgrade(op, sub))
			return settle(op, 'applied');
		await reconcileInvoice(invoice.id);
		await synchronizeSubscription(sub.id);
		if (await historicallyAppliedUpgrade(op, sub))
			return settle(op, 'applied');
		return settle(
			op,
			'recovery_required',
			'Payment received; the applied upgrade and paid coverage are still reconciling.',
		);
	}
	if (
		invoice.status === 'open' &&
		raw.pending_update &&
		stripeId(raw.latest_invoice) === invoice.id
	)
		return settle(
			op,
			'pending_payment',
			'Complete payment on the existing upgrade invoice. Your paid recognition has not been raised.',
		);
	return settle(
		op,
		'recovery_required',
		'The upgrade invoice needs review before another billing change.',
	);
}

/** Hosted worker entry. Provider calls are always outside transactions and use stable step keys. */
export async function reconcileSupporterChange(operationId: string) {
	const candidate = await operation(operationId);
	if (terminal.has(candidate.status) || candidate.status === 'quoted')
		return dto(candidate);
	const claimed = await claim(candidate);
	if (!claimed) return dto(await operation(operationId));
	let { op } = claimed;
	const { sub } = claimed;
	try {
		if (op.step === 'admitted') {
			try {
				await assertEntitlementMutationAllowed(op.actorId);
			} catch {
				await settle(
					op,
					'recovery_required',
					'Sandbox clock admission is not ready. No provider mutation was sent; billing remains pending until its scope is verified.',
				);
				return dto(await operation(op.id));
			}
		}
		const target =
			op.targetOperationId ?
				await operation(op.targetOperationId)
			:	undefined;
		if (
			target &&
			(target.actorId !== op.actorId ||
				target.subscriptionId !== sub.id ||
				target.livemode !== op.livemode)
		)
			throw new Error('Target ownership mismatch.');
		if (op.action === 'upgrade') {
			if (!op.sourcePeriodEnd)
				throw precondition(
					'This legacy change has no frozen source period. Billing review is required; no update was sent.',
				);
			if (!op.invoiceId) {
				if (op.step === 'admitted') {
					const state = await readState(
						sub,
						await authoritativeNow(op.actorId),
					);
					if (
						state.fingerprint !== op.providerFingerprint ||
						!op.quoteExpiresAt ||
						op.quoteExpiresAt.getTime() <= Date.now()
					) {
						await settle(
							op,
							'failed',
							'Billing or preview changed before the request was sent. Review a new preview.',
						);
						return dto(await operation(op.id));
					}
					await currentInvoicePaid(state, sub);
					await checkPaymentMethod(state, sub);
					if (
						(await upgradeQuote(
							state,
							sub,
							op.prorationDate!,
							op.targetPriceId!,
						)) !== op.quoteAmount
					) {
						await settle(
							op,
							'failed',
							'The upgrade amount changed while queued. Review and confirm a new preview.',
						);
						return dto(await operation(op.id));
					}
				}
				op = await startStep(op, 'upgrade_mutation');
				// Retrying this exact key recovers the original response, never a new invoice.
				const changed = await stripeClient().subscriptions.update(
					sub.id,
					{
						items: [
							{
								id: op.itemId,
								price: op.targetPriceId!,
								quantity: 1,
							},
						],
						payment_behavior: 'pending_if_incomplete',
						proration_behavior: 'always_invoice',
						proration_date: op.prorationDate!,
					},
					{ idempotencyKey: stepKey(op, 'upgrade') },
				);
				const invoiceId = stripeId(changed.latest_invoice);
				if (
					!invoiceId ||
					changed.id !== sub.id ||
					changed.customer_account !== sub.accountId ||
					changed.livemode !== sub.livemode
				)
					throw new Error('Upgrade response ownership mismatch.');
				await ownedInvoice(invoiceId, sub);
				// Persist the first-class owned invoice even when its amount/shape
				// needs review. Recovery must never create another invoice to replace it.
				op = await updateOwned(op, {
					invoiceId,
					step: 'upgrade_invoice_unverified',
				});
			}
			if (op.step === 'upgrade_invoice_unverified') {
				const invoice = await ownedInvoice(op.invoiceId!, sub);
				validateUpgradePreview(invoice, {
					accountId: sub.accountId,
					subscriptionId: sub.id,
					livemode: sub.livemode,
					itemId: op.itemId,
					sourcePriceId: op.sourcePriceId,
					targetPriceId: op.targetPriceId!,
					prorationDate: op.prorationDate!,
					periodEnd: Math.floor(op.sourcePeriodEnd!.getTime() / 1000),
				});
				if (invoice.amount_due !== op.quoteAmount)
					throw new Error('Provider upgrade amount changed.');
				op = await updateOwned(op, {
					step: 'upgrade_observed',
				});
			}
			await verifyUpgradeResult(op, sub);
		} else if (
			op.action === 'downgrade' ||
			(op.action === 'cancel' && target?.scheduleId)
		) {
			op = await reconcileSchedule(op, sub, target);
		} else if (op.action === 'undo' && target?.action === 'upgrade') {
			if (!target.invoiceId)
				throw precondition('The pending invoice needs reconciliation.');
			const invoice = await ownedInvoice(target.invoiceId, sub);
			if (invoice.status === 'paid') {
				if (!(await historicallyAppliedUpgrade(target, sub)))
					await reconcileInvoice(invoice.id);
				await synchronizeSubscription(sub.id);
				await settle(
					op,
					'failed',
					'Payment completed before cancellation. No refund was issued. Refresh the applied plan.',
				);
			} else {
				const raw = await providerSubscription(sub);
				if (invoice.status !== 'void') {
					if (
						!raw.pending_update ||
						stripeId(raw.latest_invoice) !== invoice.id ||
						invoice.status !== 'open'
					)
						throw precondition(
							'The pending upgrade changed; review billing before retrying.',
						);
					op = await startStep(op, 'void_upgrade');
					await stripeClient().invoices.voidInvoice(
						invoice.id,
						{},
						{ idempotencyKey: stepKey(op, 'void') },
					);
				}
				const after = await providerSubscription(sub);
				const afterInvoice = await ownedInvoice(invoice.id, sub);
				await synchronizeSubscription(sub.id);
				if (
					afterInvoice.status === 'void' &&
					!after.pending_update &&
					after.items.data.length === 1 &&
					after.items.data[0]?.price.id === target.sourcePriceId
				)
					await settle(op, 'applied');
				else
					await settle(
						op,
						'recovery_required',
						'The invoice cancellation raced payment or another change. Billing is reconciling; no refund was assumed.',
					);
			}
		} else if (
			(op.action === 'undo' || op.action === 'resume') &&
			target?.scheduleId
		) {
			const schedule = await exactSchedule(target, sub);
			if (schedule.status !== 'released') {
				if (
					!target.effectiveAt ||
					!['downgrade', 'cancel'].includes(target.action) ||
					!scheduleMatchesPlan(schedule, {
						action: target.action as 'downgrade' | 'cancel',
						sourcePriceId: target.sourcePriceId,
						targetPriceId: target.targetPriceId,
						periodEnd: Math.floor(
							target.effectiveAt.getTime() / 1000,
						),
					})
				)
					throw precondition(
						'The schedule changed before undo. Refresh current billing.',
					);
				op = await startStep(op, 'release_schedule');
				await stripeClient().subscriptionSchedules.release(
					schedule.id,
					{ preserve_cancel_date: target.action !== 'cancel' },
					{ idempotencyKey: stepKey(op, 'release') },
				);
			}
			const after = await providerSubscription(sub);
			await synchronizeSubscription(sub.id);
			if (
				!after.schedule &&
				(target.action !== 'cancel' ||
					(!after.cancel_at_period_end && !after.cancel_at))
			)
				await settle(op, 'applied');
			else
				await settle(
					op,
					'recovery_required',
					'Schedule release is reconciling.',
				);
		} else if (op.action === 'cancel' || op.action === 'resume') {
			const raw = await providerSubscription(sub);
			const desired = op.action === 'cancel';
			if (op.status === 'scheduled' && raw.status === 'canceled') {
				await synchronizeSubscription(sub.id);
				await settle(op, 'applied');
			} else if (op.status === 'scheduled' && !raw.cancel_at_period_end) {
				await settle(
					op,
					'expired',
					'The scheduled cancellation changed outside GiveToGive.',
				);
			} else {
				if (raw.schedule || raw.pending_update)
					throw precondition(
						'Resolve the existing schedule or pending upgrade first.',
					);
				if (op.step === 'admitted') {
					const state = stateFor(
						raw,
						sub,
						await authoritativeNow(op.actorId),
						target,
						false,
						true,
					);
					if (state.fingerprint !== op.providerFingerprint) {
						await settle(
							op,
							'failed',
							'Billing changed before the request was sent. Refresh and confirm again.',
						);
						return dto(await operation(op.id));
					}
				}
				if (op.status !== 'scheduled') {
					op = await startStep(op, 'cancel_mutation');
					await stripeClient().subscriptions.update(
						sub.id,
						{
							cancel_at_period_end: desired,
							proration_behavior: 'none',
						},
						{ idempotencyKey: stepKey(op, 'cancel') },
					);
				}
				const after = await providerSubscription(sub);
				await synchronizeSubscription(sub.id);
				if (after.cancel_at_period_end === desired)
					await settle(op, desired ? 'scheduled' : 'applied');
				else
					await settle(
						op,
						'recovery_required',
						'Cancellation state needs reconciliation.',
					);
			}
		} else throw precondition('This change has no supported owned target.');
	} catch (error) {
		await settle(
			op,
			error instanceof UnsentFrozenChange ? 'failed' : (
				'recovery_required'
			),
			error instanceof UnsentFrozenChange || error instanceof TRPCError ?
				error.message
			:	`Billing reconciliation is required (${paymentErrorCode(error)}).`,
		);
	}
	return dto(await operation(operationId));
}

async function reconcileSchedule(
	op: Change,
	sub: Subscription,
	target?: Change,
) {
	const end = Math.floor(op.effectiveAt!.getTime() / 1000);
	if (!op.scheduleId) {
		if (target?.scheduleId)
			op = await updateOwned(op, {
				scheduleId: target.scheduleId,
				step: 'schedule_known',
			});
		else {
			if (op.step === 'admitted') {
				const state = await readState(
					sub,
					await authoritativeNow(op.actorId),
				);
				if (
					state.fingerprint !== op.providerFingerprint ||
					state.periodEnd !== end
				) {
					await settle(
						op,
						'failed',
						'Billing changed before the schedule was created. Review a new preview.',
					);
					return op;
				}
			}
			op = await startStep(op, 'schedule_create');
			const schedule = await stripeClient().subscriptionSchedules.create(
				{ from_subscription: sub.id },
				{ idempotencyKey: stepKey(op, 'create_schedule') },
			);
			validateOwnedSchedule(schedule, {
				id: schedule.id,
				subscriptionId: sub.id,
				accountId: sub.accountId,
				livemode: sub.livemode,
			});
			op = await updateOwned(op, {
				scheduleId: schedule.id,
				step: 'schedule_known',
			});
		}
	}
	let schedule = await exactSchedule(op, sub);
	if (op.status === 'scheduled') {
		const raw = await providerSubscription(sub);
		await synchronizeSubscription(sub.id);
		if (op.action === 'cancel' && raw.status === 'canceled')
			await settle(op, 'applied');
		else if (
			op.action === 'downgrade' &&
			!raw.pending_update &&
			raw.items.data.length === 1 &&
			raw.items.data[0]?.price.id === op.targetPriceId &&
			raw.items.data[0].current_period_start >= end
		)
			await settle(op, 'applied');
		else if (
			schedule.status === 'released' ||
			schedule.status === 'canceled'
		)
			await settle(
				op,
				'expired',
				'The schedule was changed or released outside GiveToGive.',
			);
		else if (
			scheduleMatchesPlan(schedule, {
				action: op.action as 'downgrade' | 'cancel',
				sourcePriceId: op.sourcePriceId,
				targetPriceId: op.targetPriceId,
				periodEnd: end,
			})
		)
			await settle(op, 'scheduled');
		else
			await settle(
				op,
				'recovery_required',
				'The schedule no longer matches the confirmed change.',
			);
		return op;
	}
	if (schedule.status !== 'active')
		throw precondition('The schedule is no longer active.');
	const current = schedule.phases.find((phase) => phase.end_date === end);
	if (
		!current ||
		stripeId(current.items[0]!.price as string | { id: string }) !==
			op.sourcePriceId
	)
		throw precondition('The schedule period or current price changed.');
	if (
		target &&
		op.step === 'schedule_known' &&
		!scheduleMatchesPlan(schedule, {
			action: target.action as 'downgrade' | 'cancel',
			sourcePriceId: target.sourcePriceId,
			targetPriceId: target.targetPriceId,
			periodEnd: end,
		})
	)
		throw precondition('The target schedule changed before cancellation.');
	if (
		op.step !== 'schedule_mutation' &&
		(await authoritativeNow(op.actorId)) >= end
	)
		throw precondition(
			'The subscription renewed before the schedule was confirmed.',
		);
	op = await startStep(op, 'schedule_mutation');
	// Preserve supported explicit phase settings; validation rejects adjustments we
	// cannot safely copy instead of dropping taxes, discounts, or invoice overrides.
	const methodId = stripeId(
		current.default_payment_method as string | { id: string } | null,
	);
	const common = {
		proration_behavior: 'none' as const,
		...(methodId ? { default_payment_method: methodId } : {}),
		...(current.metadata ? { metadata: current.metadata } : {}),
		...(current.description ? { description: current.description } : {}),
	};
	const itemMetadata = current.items[0]!.metadata;
	const items = (price: string) => [
		{
			price,
			quantity: 1,
			...(itemMetadata ? { metadata: itemMetadata } : {}),
		},
	];
	const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] = [
		{
			...common,
			start_date: current.start_date,
			end_date: end,
			items: items(op.sourcePriceId),
		},
	];
	if (op.action === 'downgrade')
		phases.push({
			...common,
			start_date: end,
			duration: { interval: 'month', interval_count: 1 },
			items: items(op.targetPriceId!),
		});
	const updated = await stripeClient().subscriptionSchedules.update(
		schedule.id,
		{
			end_behavior: op.action === 'cancel' ? 'cancel' : 'release',
			proration_behavior: 'none',
			phases,
		},
		{ idempotencyKey: stepKey(op, 'update_schedule') },
	);
	schedule = validateOwnedSchedule(updated, {
		id: schedule.id,
		accountId: sub.accountId,
		subscriptionId: sub.id,
		livemode: sub.livemode,
	});
	await synchronizeSubscription(sub.id);
	if (
		scheduleMatchesPlan(schedule, {
			action: op.action as 'downgrade' | 'cancel',
			sourcePriceId: op.sourcePriceId,
			targetPriceId: op.targetPriceId,
			periodEnd: end,
		})
	)
		await settle(op, 'scheduled');
	else
		await settle(
			op,
			'recovery_required',
			'The provider has not confirmed the scheduled change.',
		);
	return op;
}

export async function supporterChangeStatus(
	actorId: string,
	raw: z.infer<typeof supporterChangeOperationInput>,
) {
	const { operationId } = supporterChangeOperationInput.parse(raw);
	const op = await ownOperation(actorId, operationId);
	const member = await billingMember(actorId);
	let url: string | null = null;
	if (!member.frozenAt && op.status === 'pending_payment' && op.invoiceId) {
		const sub = await ownSubscription(actorId, op.subscriptionId);
		const invoice = await ownedInvoice(op.invoiceId, sub);
		if (invoice.status === 'open')
			url = invoiceHandoff(invoice.hosted_invoice_url);
	}
	return memberDto(op, member, url);
}
export async function listSupporterChanges(
	actorId: string,
	raw: z.input<typeof supporterChangeListInput> = {},
) {
	const input = supporterChangeListInput.parse(raw);
	const member = await billingMember(actorId);
	const rows = await db
		.select()
		.from(supporterChanges)
		.where(
			and(
				eq(supporterChanges.actorId, actorId),
				eq(supporterChanges.livemode, paymentConfiguration().livemode),
				input.subscriptionId ?
					eq(supporterChanges.subscriptionId, input.subscriptionId)
				:	undefined,
			),
		)
		.orderBy(desc(supporterChanges.createdAt))
		.limit(input.limit);
	return Promise.all(rows.map((row) => memberDto(row, member)));
}
