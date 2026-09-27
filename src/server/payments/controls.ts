import 'server-only';
import { and, asc, desc, eq, gt, ilike, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { asks, users } from '@/server/db/schema';
import { paymentAskSettings } from '@/server/db/payments-schema';
import { operationEvents } from '@/server/db/operations-schema';
import { recordEvent } from '@/server/observability/events';
import {
	assertAdmin,
	assertFinancialAdmin,
} from '@/server/security/authorization';
import { redactText } from '@/lib/redaction';
import type { PaymentTransaction } from './ledger';

export const paymentAskControlInput = z
	.object({
		askId: z.number().int().positive(),
		operationId: z.uuid(),
		paused: z.boolean(),
		expectedPaused: z.boolean(),
		expectedRevision: z.number().int().nonnegative(),
		reason: z.string().trim().min(10).max(500),
	})
	.strict();
export const paymentAskListInput = z
	.object({
		query: z.string().max(100).optional(),
		afterId: z.number().int().positive().optional(),
		limit: z.number().int().min(1).max(100).default(25),
	})
	.strict();

export async function recordAskPaymentPause(
	tx: PaymentTransaction,
	actorId: string,
	input: z.infer<typeof paymentAskControlInput>,
) {
	const parsed = paymentAskControlInput.parse(input);
	const [actor] = await tx
		.select({
			role: users.role,
			emailVerified: users.emailVerified,
			frozenAt: users.frozenAt,
		})
		.from(users)
		.where(eq(users.id, actorId))
		.for('share');
	if (
		!actor ||
		actor.role !== 'admin' ||
		!actor.emailVerified ||
		actor.frozenAt
	)
		throw new TRPCError({ code: 'FORBIDDEN' });
	// Same ordering as Checkout/allocation/owner goal changes. Only new capacity
	// reservations stop; already-open Checkout and recovery remain authoritative.
	const [ask] = await tx
		.select({ id: asks.id })
		.from(asks)
		.where(eq(asks.id, parsed.askId))
		.for('update');
	const [settings] = await tx
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, parsed.askId));
	if (!ask || !settings)
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: 'Choose a payment-enabled Ask.',
		});
	const externalId = `ask-payment-pause:${actorId}:${parsed.operationId}`;
	const summary = redactText(parsed.reason);
	const [previous] = await tx
		.select()
		.from(operationEvents)
		.where(eq(operationEvents.externalId, externalId));
	if (previous) {
		if (
			previous.entityId !== String(parsed.askId) ||
			previous.details['paused'] !== parsed.paused ||
			previous.details['expectedRevision'] !== parsed.expectedRevision ||
			previous.summary !== summary
		) {
			throw new TRPCError({
				code: 'CONFLICT',
				message:
					'The operation ID belongs to a different payment-control request.',
			});
		}
		return {
			askId: parsed.askId,
			paused: Boolean(settings.pausedAt),
			eventId: previous.id,
		};
	}
	const [lastControl] = await tx
		.select({ id: operationEvents.id })
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.entityType, 'ask'),
				eq(operationEvents.entityId, String(parsed.askId)),
				inArray(operationEvents.action, [
					'ask_payments_paused',
					'ask_payments_resumed',
				]),
			),
		)
		.orderBy(desc(operationEvents.id))
		.limit(1);
	if (
		Boolean(settings.pausedAt) !== parsed.expectedPaused ||
		(lastControl?.id ?? 0) !== parsed.expectedRevision
	)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'This Ask was changed by another administrator. Refresh and review its current state.',
		});
	if (parsed.paused === Boolean(settings.pausedAt))
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'The Ask is already in the requested state.',
		});
	await tx
		.update(paymentAskSettings)
		.set({ pausedAt: parsed.paused ? new Date() : null })
		.where(eq(paymentAskSettings.askId, parsed.askId));
	const eventId = await recordEvent(
		{
			externalId,
			actorId,
			entityType: 'ask',
			entityId: String(parsed.askId),
			action:
				parsed.paused ? 'ask_payments_paused' : 'ask_payments_resumed',
			outcome: 'completed',
			correlationId: parsed.operationId,
			summary,
			details: {
				paused: parsed.paused,
				expectedRevision: parsed.expectedRevision,
				existingReservationsPreserved: true,
			},
		},
		tx,
	);
	if (!eventId)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'Payment control is already being recorded. Retry the same operation.',
		});
	return { askId: parsed.askId, paused: parsed.paused, eventId };
}

export async function setAskPaymentPause(
	actorId: string,
	input: z.infer<typeof paymentAskControlInput>,
	elevation?: string,
) {
	await assertFinancialAdmin(actorId, elevation);
	return db.transaction((tx) => recordAskPaymentPause(tx, actorId, input));
}

export async function listPaymentAsks(
	actorId: string,
	input: z.infer<typeof paymentAskListInput>,
) {
	await assertAdmin(actorId);
	const query = input.query?.replace(/[\\%_]/g, '\\$&');
	const rows = await db
		.select({
			id: asks.id,
			title: asks.title,
			slug: asks.slug,
			goalAmount: paymentAskSettings.goalAmount,
			pausedAt: paymentAskSettings.pausedAt,
			revision:
				sql<number>`(SELECT coalesce(max(e.id), 0) FROM ${operationEvents} e
				WHERE e.entity_type = 'ask' AND e.entity_id = ${asks.id}::text
				AND e.action IN ('ask_payments_paused', 'ask_payments_resumed'))`.mapWith(
					Number,
				),
		})
		.from(paymentAskSettings)
		.innerJoin(asks, eq(asks.id, paymentAskSettings.askId))
		.where(
			and(
				query ? ilike(asks.title, `%${query}%`) : undefined,
				input.afterId ? gt(asks.id, input.afterId) : undefined,
			),
		)
		.orderBy(asc(asks.id))
		.limit(input.limit + 1);
	const items = rows.slice(0, input.limit);
	return {
		items,
		nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
	};
}
