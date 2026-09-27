import 'server-only';
import { and, desc, eq, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { applicationEnvironment } from '@/lib/environment';
import { redactText } from '@/lib/redaction';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { operationEvents } from '@/server/db/operations-schema';
import { paymentCases } from '@/server/db/payments-schema';
import { recordEvent } from '@/server/observability/events';
import {
	assertAdmin,
	assertFinancialAdmin,
} from '@/server/security/authorization';
import type { PaymentTransaction } from './ledger';

export const caseReviewInput = z
	.object({
		caseId: z.uuid(),
		operationId: z.uuid(),
		decision: z.enum(['acknowledge', 'escalate']),
		note: z.string().trim().min(10).max(500),
	})
	.strict();

export const caseHistoryInput = z
	.object({
		caseId: z.uuid(),
		beforeId: z.number().int().positive().optional(),
		limit: z.number().int().min(1).max(100).default(30),
	})
	.strict();

/** Append operator context; never clear a financial hold or resolve a payment. */
export async function recordCaseReview(
	tx: PaymentTransaction,
	actorId: string,
	input: z.infer<typeof caseReviewInput>,
) {
	const parsed = caseReviewInput.parse(input);
	const [actor] = await tx
		.select({
			role: users.role,
			frozenAt: users.frozenAt,
			emailVerified: users.emailVerified,
		})
		.from(users)
		.where(eq(users.id, actorId))
		.for('share');
	if (
		!actor ||
		actor.role !== 'admin' ||
		actor.frozenAt ||
		!actor.emailVerified
	) {
		throw new TRPCError({ code: 'FORBIDDEN' });
	}
	const [item] = await tx
		.select({
			id: paymentCases.id,
			paymentId: paymentCases.paymentId,
			resolvedAt: paymentCases.resolvedAt,
		})
		.from(paymentCases)
		.where(eq(paymentCases.id, parsed.caseId))
		.for('update');
	if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
	const externalId = `case-review:${actorId}:${parsed.operationId}`;
	const summary = redactText(parsed.note);
	const action =
		parsed.decision === 'acknowledge' ?
			'payment_case_acknowledged'
		:	'payment_case_escalated';
	const [previous] = await tx
		.select()
		.from(operationEvents)
		.where(eq(operationEvents.externalId, externalId));
	if (previous) {
		if (
			previous.entityId !== item.id ||
			previous.action !== action ||
			previous.summary !== summary
		) {
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'This operation ID was already used for a different case review.',
			});
		}
		return {
			eventId: previous.id,
			decision: parsed.decision,
			financialStatusChanged: false as const,
		};
	}
	const eventId = await recordEvent(
		{
			externalId,
			actorId,
			entityType: 'payment_case',
			entityId: item.id,
			action,
			outcome: 'recorded',
			summary,
			correlationId: parsed.operationId,
			details: {
				decision: parsed.decision,
				paymentId: item.paymentId,
				alreadyResolved: Boolean(item.resolvedAt),
				financialStatusChanged: false,
			},
		},
		tx,
	);
	if (!eventId)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'This review is already being recorded. Retry the same operation.',
		});
	return {
		eventId,
		decision: parsed.decision,
		financialStatusChanged: false as const,
	};
}

export async function reviewCase(
	actorId: string,
	input: z.infer<typeof caseReviewInput>,
	elevationToken?: string,
) {
	await assertFinancialAdmin(actorId, elevationToken);
	return db.transaction((tx) => recordCaseReview(tx, actorId, input));
}

export async function caseHistory(
	actorId: string,
	input: z.infer<typeof caseHistoryInput>,
) {
	await assertAdmin(actorId);
	const [item] = await db
		.select()
		.from(paymentCases)
		.where(eq(paymentCases.id, input.caseId));
	if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
	const rows = await db
		.select({
			id: operationEvents.id,
			actorId: operationEvents.actorId,
			action: operationEvents.action,
			summary: operationEvents.summary,
			occurredAt: operationEvents.occurredAt,
		})
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.environment, applicationEnvironment()),
				eq(operationEvents.entityType, 'payment_case'),
				eq(operationEvents.entityId, item.id),
				input.beforeId ?
					lt(operationEvents.id, input.beforeId)
				:	undefined,
			),
		)
		.orderBy(desc(operationEvents.id))
		.limit(input.limit + 1);
	const hasMore = rows.length > input.limit;
	const items = rows.slice(0, input.limit);
	return { item, items, nextCursor: hasMore ? items.at(-1)!.id : null };
}
