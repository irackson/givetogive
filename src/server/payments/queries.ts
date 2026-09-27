import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import { applicationEnvironment } from '@/lib/environment';
import { asks, users } from '@/server/db/schema';
import {
	communityFunds,
	fundAllocations,
	paymentAccounts,
	paymentAskSettings,
	paymentCases,
	paymentLedger,
	paymentOperations,
	payments,
	paymentSubscriptions,
	paymentWebhookInbox,
} from '@/server/db/payments-schema';
import { fundingTotals } from './checkout';
import { paymentConfiguration } from './config';
import { netVerifiedFunding } from './math';
import { supporterMetrics, supporterRecognition } from './coverage';
import { entitlementTime } from './entitlement-time';
import { refreshRecipientAccount } from './accounts';

export async function askFunding(askId: number) {
	const [ask] = await db.select().from(asks).where(eq(asks.id, askId));
	if (!ask) throw new TRPCError({ code: 'NOT_FOUND' });
	const [settings] = await db
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	const [account] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, ask.createdById),
				eq(paymentAccounts.livemode, paymentConfiguration().livemode),
			),
		);
	const totals =
		settings ?
			await fundingTotals(db, askId)
		:	{ paidAmount: 0, pendingAmount: 0 };
	return {
		enabled: Boolean(settings),
		accepting: Boolean(
			settings &&
			!settings.pausedAt &&
			paymentConfiguration().askPayments,
		),
		goalAmount: settings?.goalAmount ?? ask.goalAmount,
		...totals,
		recipientReady: Boolean(
			account?.transfersActive && account.payoutsActive,
		),
	};
}

const paymentProjection = {
	id: payments.id,
	kind: payments.kind,
	status: payments.status,
	grossAmount: payments.grossAmount,
	currency: payments.currency,
	platformFee: payments.platformFee,
	processingEstimate: payments.processingEstimate,
	recipientAmount: payments.recipientAmount,
	refundedAmount: payments.refundedAmount,
	refundedRecipientAmount: payments.refundedRecipientAmount,
	disputedAmount: payments.disputedAmount,
	createdAt: payments.createdAt,
	paidAt: payments.paidAt,
	expiresAt: payments.expiresAt,
	askId: payments.askId,
	askTitle: asks.title,
	askSlug: asks.slug,
	fundId: payments.fundId,
	fundName: communityFunds.name,
	fundSlug: communityFunds.slug,
	tier: payments.tier,
	recurring: payments.recurring,
	livemode: payments.livemode,
	receiptUrl: payments.receiptUrl,
};

export async function myPayments(
	userId: string,
	input: { cursor?: string | undefined; limit?: number | undefined } = {},
) {
	const limit = input.limit ?? 20;
	let cursorDate: Date | undefined;
	if (input.cursor) {
		const [cursor] = await db
			.select({ createdAt: payments.createdAt })
			.from(payments)
			.where(
				and(
					eq(payments.id, input.cursor),
					eq(payments.actorId, userId),
				),
			);
		cursorDate = cursor?.createdAt;
	}
	const items = await db
		.select(paymentProjection)
		.from(payments)
		.leftJoin(asks, eq(asks.id, payments.askId))
		.leftJoin(communityFunds, eq(communityFunds.id, payments.fundId))
		.where(
			and(
				eq(payments.actorId, userId),
				eq(payments.livemode, paymentConfiguration().livemode),
				cursorDate ?
					or(
						lt(payments.createdAt, cursorDate),
						and(
							eq(payments.createdAt, cursorDate),
							lt(payments.id, input.cursor!),
						),
					)
				:	undefined,
			),
		)
		.orderBy(desc(payments.createdAt), desc(payments.id))
		.limit(limit + 1);
	const more = items.length > limit;
	if (more) items.pop();
	return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
}

export async function paymentDetail(userId: string, id: string) {
	const [ownership] = await db
		.select({ actorId: payments.actorId })
		.from(payments)
		.where(
			and(
				eq(payments.id, id),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	const [member] = await db
		.select({ role: users.role })
		.from(users)
		.where(eq(users.id, userId));
	if (
		!ownership ||
		(ownership.actorId !== userId && member?.role !== 'admin')
	)
		throw new TRPCError({ code: 'NOT_FOUND' });
	const [payment] = await db
		.select(paymentProjection)
		.from(payments)
		.leftJoin(asks, eq(asks.id, payments.askId))
		.leftJoin(communityFunds, eq(communityFunds.id, payments.fundId))
		.where(eq(payments.id, id));
	const operations = await db
		.select({
			id: paymentOperations.id,
			kind: paymentOperations.kind,
			amount: paymentOperations.amount,
			status: paymentOperations.status,
			createdAt: paymentOperations.createdAt,
		})
		.from(paymentOperations)
		.where(eq(paymentOperations.paymentId, id))
		.orderBy(desc(paymentOperations.createdAt));
	return { ...payment!, operations };
}

export async function mySubscriptions(
	userId: string,
	providedRecognition?: Awaited<ReturnType<typeof supporterRecognition>>,
) {
	const recognition =
		providedRecognition ?? (await supporterRecognition(userId));
	const subscriptions = await db
		.select({
			id: paymentSubscriptions.id,
			kind: paymentSubscriptions.kind,
			tier: paymentSubscriptions.tier,
			priceId: paymentSubscriptions.priceId,
			changeRevision: paymentSubscriptions.changeRevision,
			pendingChangeId: paymentSubscriptions.pendingChangeId,
			activeMutationId: paymentSubscriptions.activeMutationId,
			periodEnd: paymentSubscriptions.periodEnd,
			fundId: paymentSubscriptions.fundId,
			fundName: communityFunds.name,
			status: paymentSubscriptions.status,
			paidThrough: paymentSubscriptions.paidThrough,
			cancelAtPeriodEnd: paymentSubscriptions.cancelAtPeriodEnd,
			createdAt: paymentSubscriptions.createdAt,
		})
		.from(paymentSubscriptions)
		.leftJoin(
			communityFunds,
			eq(communityFunds.id, paymentSubscriptions.fundId),
		)
		.where(
			and(
				eq(paymentSubscriptions.actorId, userId),
				eq(
					paymentSubscriptions.livemode,
					paymentConfiguration().livemode,
				),
			),
		)
		.orderBy(desc(paymentSubscriptions.createdAt));
	return subscriptions.map((sub) => {
		const coverage = recognition.coverage.filter(
			(item) => item.subscriptionId === sub.id,
		);
		const tier =
			coverage.some((item) => item.tier === 'sustainer') ?
				('sustainer' as const)
			: coverage.some((item) => item.tier === 'supporter') ?
				('supporter' as const)
			:	null;
		const tierCoverage = coverage.filter((item) => item.tier === tier);
		return {
			...sub,
			...(sub.kind === 'supporter' ?
				{
					tier,
					paidThrough:
						tierCoverage.length ?
							new Date(
								Math.max(
									...tierCoverage.map((item) =>
										item.periodEnd.getTime(),
									),
								),
							)
						:	null,
				}
			:	{}),
			billingTier:
				sub.priceId === process.env['STRIPE_SUSTAINER_PRICE_ID'] ?
					('sustainer' as const)
				: sub.priceId === process.env['STRIPE_SUPPORTER_PRICE_ID'] ?
					('supporter' as const)
				:	null,
			recognitionStatus: recognition.status,
		};
	});
}

export async function myOverview(userId: string) {
	const recognition = await supporterRecognition(userId);
	const subscriptions = await mySubscriptions(userId, recognition);
	const own = await db
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.actorId, userId),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	const paidGiving = own
		.filter((p) => p.kind !== 'supporter')
		.reduce((sum, p) => sum + netVerifiedFunding(p), 0);
	const pendingGiving = own
		.filter(
			(p) =>
				p.kind !== 'supporter' &&
				['reserved', 'checkout_open', 'pending'].includes(p.status),
		)
		.reduce((sum, p) => sum + p.recipientAmount, 0);
	return {
		tier: recognition.tier,
		recognitionStatus: recognition.status,
		recognitionAsOf: recognition.asOf,
		paidGiving,
		pendingGiving,
		completedContributions: own.filter(
			(p) => p.kind !== 'supporter' && netVerifiedFunding(p) > 0,
		).length,
		subscriptions,
	};
}

export async function myRecipient(userId: string) {
	const config = paymentConfiguration();
	const [account] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, userId),
				eq(paymentAccounts.livemode, config.livemode),
			),
		);
	const current =
		account?.recipientRequested && config.configured ?
			await refreshRecipientAccount(account.stripeAccountId)
		:	account;
	const owned = await db
		.select({
			id: asks.id,
			slug: asks.slug,
			title: asks.title,
			type: asks.type,
			goalAmount: asks.goalAmount,
			enabled: paymentAskSettings.askId,
		})
		.from(asks)
		.leftJoin(paymentAskSettings, eq(paymentAskSettings.askId, asks.id))
		.where(and(eq(asks.createdById, userId), eq(asks.type, 'money')))
		.orderBy(desc(asks.createdAt))
		.limit(100);
	return {
		accountId: current?.stripeAccountId ?? null,
		recipientRequested: current?.recipientRequested ?? false,
		transfersActive: current?.transfersActive ?? false,
		payoutsActive: current?.payoutsActive ?? false,
		requirements: current?.requirements ?? [],
		asks: owned,
	};
}

export async function fundBalances(fundId: string) {
	const rows = await db
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.fundId, fundId),
				eq(payments.livemode, paymentConfiguration().livemode),
			),
		);
	const allocations = await db
		.select()
		.from(fundAllocations)
		.where(
			and(
				eq(fundAllocations.fundId, fundId),
				eq(fundAllocations.livemode, paymentConfiguration().livemode),
			),
		);
	const totalReceived = rows.reduce(
		(sum, p) => sum + netVerifiedFunding(p),
		0,
	);
	const availableAmount = rows
		.filter((p) => p.availableAt && p.availableAt <= new Date())
		.reduce(
			(sum, p) =>
				sum + Math.max(0, netVerifiedFunding(p) - p.allocatedAmount),
			0,
		);
	return {
		totalReceived,
		availableAmount,
		totalAllocated: allocations
			.filter((a) => a.status === 'completed')
			.reduce((sum, a) => sum + a.amount - a.reversedAmount, 0),
		pendingAllocation: allocations
			.filter((a) =>
				['reserved', 'processing', 'recovery_required'].includes(
					a.status,
				),
			)
			.reduce((sum, a) => sum + a.amount, 0),
	};
}

export async function listFunds() {
	const funds = await db
		.select()
		.from(communityFunds)
		.orderBy(desc(communityFunds.createdAt))
		.limit(100);
	return Promise.all(
		funds.map(async (fund) => ({
			...fund,
			...(await fundBalances(fund.id)),
		})),
	);
}

export async function getFund(slug: string) {
	const [fund] = await db
		.select()
		.from(communityFunds)
		.where(eq(communityFunds.slug, slug));
	if (!fund) throw new TRPCError({ code: 'NOT_FOUND' });
	const allocations = await db
		.select({
			id: fundAllocations.id,
			amount: fundAllocations.amount,
			reversedAmount: fundAllocations.reversedAmount,
			reason: fundAllocations.reason,
			status: fundAllocations.status,
			createdAt: fundAllocations.createdAt,
			askId: asks.id,
			askTitle: asks.title,
			askSlug: asks.slug,
		})
		.from(fundAllocations)
		.innerJoin(asks, eq(asks.id, fundAllocations.askId))
		.where(
			and(
				eq(fundAllocations.fundId, fund.id),
				eq(fundAllocations.livemode, paymentConfiguration().livemode),
			),
		)
		.orderBy(desc(fundAllocations.createdAt))
		.limit(100);
	return { ...fund, ...(await fundBalances(fund.id)), allocations };
}

export async function paymentOperationsSummary(
	executor: Pick<typeof db, 'select'> = db,
	readTime: typeof entitlementTime = entitlementTime,
) {
	// Read projections follow the environment, even while provider keys are absent.
	const mode = applicationEnvironment() === 'production';
	const [totals] = await executor
		.select({
			count: sql<number>`count(*)::int`,
			gross: sql<number>`coalesce(sum(${payments.grossAmount}), 0)::bigint`,
			refunds: sql<number>`coalesce(sum(${payments.refundedAmount}), 0)::bigint`,
			recipient: sql<number>`coalesce(sum(case when ${payments.status} in ('succeeded','partially_refunded','refunded','disputed') then greatest(0, ${payments.recipientAmount} - ${payments.refundedRecipientAmount} - ${payments.disputedAmount}) else 0 end),0)::bigint`,
		})
		.from(payments)
		.where(
			and(
				eq(payments.livemode, mode),
				sql`${payments.paidAt} is not null`,
				sql`${payments.kind} <> 'supporter'`,
			),
		);
	const cases = await executor
		.select()
		.from(paymentCases)
		.where(sql`${paymentCases.resolvedAt} IS NULL`)
		.orderBy(desc(paymentCases.createdAt))
		.limit(100);
	const webhooks = await executor
		.select()
		.from(paymentWebhookInbox)
		.where(
			and(
				eq(paymentWebhookInbox.livemode, mode),
				sql`${paymentWebhookInbox.status} IN ('pending','failed')`,
			),
		)
		.orderBy(desc(paymentWebhookInbox.createdAt))
		.limit(100);
	const operations = await executor
		.select()
		.from(paymentOperations)
		.where(sql`${paymentOperations.status} <> 'succeeded'`)
		.limit(100);
	const supporter = await supporterMetrics(executor, readTime);
	return {
		totals: {
			count: totals?.count ?? 0,
			gross: Number(totals?.gross ?? 0),
			refunds: Number(totals?.refunds ?? 0),
			recipient: Number(totals?.recipient ?? 0),
		},
		supporterMrr: supporter.supporterMrr,
		supporterReconciliationPending: supporter.pending,
		cases,
		webhooks,
		operations,
	};
}

export async function paymentAudit(id: string) {
	return {
		journals: await db
			.select()
			.from(paymentLedger)
			.where(eq(paymentLedger.paymentId, id)),
		operations: await db
			.select()
			.from(paymentOperations)
			.where(eq(paymentOperations.paymentId, id)),
		cases: await db
			.select()
			.from(paymentCases)
			.where(eq(paymentCases.paymentId, id)),
	};
}
