import { TRPCError } from '@trpc/server';
import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	isNull,
	lt,
	lte,
	or,
	sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { applicationEnvironment } from '@/lib/environment';
import { simulationRunnerOnline } from '@/lib/simulation-presentation';
import { db } from '@/server/db';
import { askContributions, asks, users } from '@/server/db/schema';
import {
	apiTokens,
	operationEvents,
	requestMetrics,
	simulationAgents,
	simulationCommands,
	simulationRuns,
} from '@/server/db/operations-schema';
import {
	fundAllocations,
	paymentAccounts,
	paymentCases,
	paymentLedger,
	payments,
	paymentSubscriptions,
	paymentWebhookInbox,
} from '@/server/db/payments-schema';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
	assertAdmin,
	assertFinancialAdmin,
} from '@/server/security/authorization';
import { recordEvent } from '@/server/observability/events';
import { assertSimulationEnvironment } from '@/server/simulation/guard';
import {
	controllerRecoverySchema,
	recoverSimulationController,
} from '@/server/simulation/controller';
import { supporterMetrics } from '@/server/payments/coverage';

const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	await assertAdmin(ctx.session.user.id);
	return next({ ctx });
});
const page = z.object({
	query: z.string().max(100).optional(),
	page: z.number().int().min(1).max(10_000).default(1),
	limit: z.number().int().min(1).max(100).default(25),
});
const userFields = {
	id: users.id,
	name: users.name,
	email: users.email,
	emailVerified: users.emailVerified,
	role: users.role,
	frozenAt: users.frozenAt,
	isSynthetic: users.isSynthetic,
	joinedAt: users.joinedAt,
};
const environment = applicationEnvironment;
const liveMode = () => environment() === 'production';

export const adminRouter = createTRPCRouter({
	overview: adminProcedure.query(async () => {
		const mode = liveMode();
		const [
			[[members]],
			[[askStats]],
			[[contributions]],
			[[giving]],
			[[subscriptions]],
			[[queues]],
		] = await Promise.all([
			Promise.all([
				db
					.select({
						total: sql<number>`count(*)::int`,
						frozen: sql<number>`count(*) filter(where ${users.frozenAt} is not null)::int`,
					})
					.from(users),
			]),
			Promise.all([
				db
					.select({
						total: sql<number>`count(*)::int`,
						complete: sql<number>`count(*) filter(where ${asks.status} = 'complete')::int`,
					})
					.from(asks),
			]),
			Promise.all([
				db
					.select({
						completed: sql<number>`count(*) filter(where ${askContributions.status} = 'completed')::int`,
					})
					.from(askContributions)
					.innerJoin(asks, eq(askContributions.askId, asks.id))
					.where(sql`${asks.type} <> 'money'`),
			]),
			Promise.all([
				db
					.select({
						gross: sql<number>`coalesce(sum(${payments.grossAmount}),0)::bigint`,
						refunds: sql<number>`coalesce(sum(${payments.refundedAmount}),0)::bigint`,
						recipient: sql<number>`coalesce(sum(case when ${payments.status} in ('succeeded','partially_refunded','refunded','disputed') then greatest(0, ${payments.recipientAmount} - ${payments.refundedRecipientAmount} - ${payments.disputedAmount}) else 0 end),0)::bigint`,
					})
					.from(payments)
					.where(
						and(
							eq(payments.livemode, mode),
							sql`${payments.paidAt} is not null`,
							sql`${payments.kind} <> 'supporter'`,
						),
					),
			]),
			Promise.all([supporterMetrics().then((metrics) => [metrics])]),
			Promise.all([
				db
					.select({ unresolved: sql<number>`count(*)::int` })
					.from(paymentCases)
					.where(isNull(paymentCases.resolvedAt)),
			]),
		]);
		return {
			environment: environment(),
			currency: 'usd' as const,
			observedAt: new Date(),
			period: 'all_time' as const,
			metrics: [
				{
					key: 'members',
					label: 'Members',
					value: Number(members?.total ?? 0),
					unit: 'count',
					definition:
						'All registered accounts in this isolated environment.',
				},
				{
					key: 'asks',
					label: 'Asks',
					value: Number(askStats?.total ?? 0),
					unit: 'count',
					definition:
						'All published Asks, including completed and legacy money Asks.',
				},
				{
					key: 'completed_asks',
					label: 'Completed Asks',
					value: Number(askStats?.complete ?? 0),
					unit: 'count',
					definition:
						'Asks currently marked complete; denominator is all Asks.',
				},
				{
					key: 'completed_help',
					label: 'Completed offers of help',
					value: Number(contributions?.completed ?? 0),
					unit: 'count',
					definition:
						'Completed non-monetary contribution records; not equivalent to unique helpers.',
				},
				{
					key: 'gross_giving',
					label: 'Gross gifts',
					value: Number(giving?.gross ?? 0),
					unit: 'cents',
					definition:
						'Successful Ask and community-fund payment gross before refunds; excludes supporter subscriptions and legacy pledges.',
				},
				{
					key: 'refunds',
					label: 'Gift refunds',
					value: Number(giving?.refunds ?? 0),
					unit: 'cents',
					definition:
						'Confirmed refunded gross from successful gifts; excludes pending refund requests.',
				},
				{
					key: 'net_giving',
					label: 'Net verified gifts',
					value: Number(giving?.recipient ?? 0),
					unit: 'cents',
					definition:
						'Verified recipient or fund-intake value less confirmed recipient refunds and disputed recipient value. Not a cash balance or bank payout metric. Excludes supporter subscriptions and legacy pledges.',
				},
				{
					key: 'supporter_mrr',
					label: 'Supporter MRR',
					value: Number(subscriptions?.supporterMrr ?? 0),
					unit: 'cents',
					definition:
						'Monthly list-price value of active, paid-through, non-canceling supporter subscriptions. Excludes fund subscriptions, past-due and unpaid subscriptions.',
				},
				{
					key: 'unresolved',
					label: 'Operations requiring attention',
					value: Number(queues?.unresolved ?? 0),
					unit: 'count',
					definition:
						'Unresolved payment operation cases in this environment.',
				},
			],
			frozenMembers: members?.frozen ?? 0,
		};
	}),
	trends: adminProcedure
		.input(
			z
				.object({ days: z.number().int().min(1).max(90).default(30) })
				.default({ days: 30 }),
		)
		.query(async ({ input }) => {
			const end = new Date();
			const start = new Date(
				Date.UTC(
					end.getUTCFullYear(),
					end.getUTCMonth(),
					end.getUTCDate() - input.days + 1,
				),
			);
			const giftDay = sql<string>`to_char(${payments.paidAt} at time zone 'UTC', 'YYYY-MM-DD')`;
			const requestDay = sql<string>`to_char(${requestMetrics.bucketStart} at time zone 'UTC', 'YYYY-MM-DD')`;
			const [gifts, requests, [checkout]] = await Promise.all([
				db
					.select({
						date: giftDay,
						gross: sql<number>`sum(${payments.grossAmount})::bigint`,
						net: sql<number>`sum(case when ${payments.status} in ('succeeded','partially_refunded','refunded','disputed') then greatest(0, ${payments.recipientAmount} - ${payments.refundedRecipientAmount} - ${payments.disputedAmount}) else 0 end)::bigint`,
						count: sql<number>`count(*)::int`,
					})
					.from(payments)
					.where(
						and(
							eq(payments.livemode, liveMode()),
							gte(payments.paidAt, start),
							lte(payments.paidAt, end),
							sql`${payments.kind} <> 'supporter'`,
						),
					)
					.groupBy(giftDay),
				db
					.select({
						date: requestDay,
						count: sql<number>`sum(${requestMetrics.count})::bigint`,
						errors: sql<number>`coalesce(sum(${requestMetrics.count}) filter(where ${requestMetrics.outcome} = 'error'),0)::bigint`,
						duration: sql<number>`sum(${requestMetrics.durationSumMs})::bigint`,
						maximum: sql<number>`max(${requestMetrics.durationMaxMs})::int`,
					})
					.from(requestMetrics)
					.where(
						and(
							eq(requestMetrics.environment, environment()),
							gte(requestMetrics.bucketStart, start),
							lte(requestMetrics.bucketStart, end),
						),
					)
					.groupBy(requestDay),
				db
					.select({
						attempts: sql<number>`count(*)::int`,
						paid: sql<number>`count(*) filter(where ${payments.paidAt} is not null)::int`,
					})
					.from(payments)
					.where(
						and(
							eq(payments.livemode, liveMode()),
							gte(payments.createdAt, start),
							lte(payments.createdAt, end),
							sql`${payments.checkoutId} is not null`,
						),
					),
			]);
			const series = Array.from({ length: input.days }, (__, index) => {
				const date = new Date(start.getTime() + index * 86_400_000)
					.toISOString()
					.slice(0, 10);
				const giving = gifts.find((item) => item.date === date);
				const calls = requests.find((item) => item.date === date);
				const requestCount = Number(calls?.count ?? 0);
				return {
					date,
					grossCents: Number(giving?.gross ?? 0),
					netCents: Number(giving?.net ?? 0),
					giftCount: Number(giving?.count ?? 0),
					requestCount,
					errorCount: Number(calls?.errors ?? 0),
					meanLatencyMs:
						requestCount ?
							Math.round(
								Number(calls?.duration ?? 0) / requestCount,
							)
						:	null,
					maxLatencyMs: calls ? Number(calls.maximum) : null,
				};
			});
			return {
				environment: environment(),
				currency: 'usd' as const,
				start,
				end,
				timezone: 'UTC' as const,
				series,
				givingDefinition:
					'Current net value of gifts grouped by original payment date (UTC), after refunds and disputes as of now. Not a historical cash-balance series. Excludes supporter subscriptions and legacy pledges.',
				latencyDefinition:
					'Measured top-level tRPC HTTP and server-component procedure duration, excluding metrics persistence, admin polling, Auth.js, and internal MCP transaction calls. Missing measurements are null, not zero latency.',
				checkoutConversion: {
					paid: checkout?.paid ?? 0,
					attempts: checkout?.attempts ?? 0,
					ratio:
						checkout?.attempts ?
							checkout.paid / checkout.attempts
						:	null,
					definition:
						'Checkouts created in this period with a confirmed paidAt divided by all created Checkout Sessions. Includes pending or abandoned sessions; recurring renewal invoices without a Checkout Session are excluded.',
				},
			};
		}),
	activity: adminProcedure
		.input(
			z.object({
				after: z.number().int().nonnegative().optional(),
				before: z.number().int().positive().optional(),
				entityType: z.string().max(60).optional(),
				entityId: z.string().max(255).optional(),
				actorId: z.string().max(255).optional(),
				runId: z.string().max(64).optional(),
				outcome: z.string().max(40).optional(),
				from: z.date().optional(),
				to: z.date().optional(),
				limit: z.number().int().min(1).max(100).default(50),
			}),
		)
		.query(async ({ input }) => {
			const items = await db
				.select()
				.from(operationEvents)
				.where(
					and(
						eq(operationEvents.environment, environment()),
						input.after !== undefined ?
							gt(operationEvents.id, input.after)
						:	undefined,
						input.before ?
							lt(operationEvents.id, input.before)
						:	undefined,
						input.entityType ?
							eq(operationEvents.entityType, input.entityType)
						:	undefined,
						input.entityId ?
							eq(operationEvents.entityId, input.entityId)
						:	undefined,
						input.actorId ?
							eq(operationEvents.actorId, input.actorId)
						:	undefined,
						input.runId ?
							eq(operationEvents.runId, input.runId)
						:	undefined,
						input.outcome ?
							eq(operationEvents.outcome, input.outcome)
						:	undefined,
						input.from ?
							gte(operationEvents.occurredAt, input.from)
						:	undefined,
						input.to ?
							lte(operationEvents.occurredAt, input.to)
						:	undefined,
					),
				)
				.orderBy(
					input.after !== undefined ?
						asc(operationEvents.id)
					:	desc(operationEvents.id),
				)
				.limit(input.limit);
			return {
				items,
				nextCursor: items.at(-1)?.id ?? null,
				observedAt: new Date(),
				environment: environment(),
			};
		}),
	listUsers: adminProcedure.input(page).query(async ({ input }) => {
		const filter =
			input.query ?
				or(
					ilike(users.name, `%${input.query}%`),
					ilike(users.email, `%${input.query}%`),
				)
			:	undefined;
		const [items, [total]] = await Promise.all([
			db
				.select(userFields)
				.from(users)
				.where(filter)
				.orderBy(desc(users.joinedAt), asc(users.id))
				.limit(input.limit)
				.offset((input.page - 1) * input.limit),
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(users)
				.where(filter),
		]);
		return {
			items,
			total: total?.count ?? 0,
			page: input.page,
			observedAt: new Date(),
		};
	}),
	userDetail: adminProcedure
		.input(z.object({ id: z.string().max(255) }))
		.query(async ({ input }) => {
			const [user] = await db
				.select(userFields)
				.from(users)
				.where(eq(users.id, input.id));
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
			const [accounts, subscriptions] = await Promise.all([
				db
					.select()
					.from(paymentAccounts)
					.where(eq(paymentAccounts.userId, input.id)),
				db
					.select()
					.from(paymentSubscriptions)
					.where(eq(paymentSubscriptions.actorId, input.id)),
			]);
			return { user, accounts, subscriptions, observedAt: new Date() };
		}),
	freezeUser: adminProcedure
		.input(
			z.object({
				id: z.string().max(255),
				frozen: z.boolean(),
				reason: z.string().trim().min(10).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertFinancialAdmin(
				ctx.session.user.id,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			);
			if (input.id === ctx.session.user.id)
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Cannot freeze your own administrator account.',
				});
			await db.transaction(async (tx) => {
				const [user] = await tx
					.update(users)
					.set({
						frozenAt: input.frozen ? new Date() : null,
						sessionVersion: sql`${users.sessionVersion} + 1`,
					})
					.where(eq(users.id, input.id))
					.returning({ id: users.id });
				if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
				await tx
					.update(apiTokens)
					.set({ revokedAt: new Date() })
					.where(eq(apiTokens.userId, input.id));
				await recordEvent(
					{
						actorId: ctx.session.user.id,
						entityType: 'user',
						entityId: input.id,
						action: input.frozen ? 'user_frozen' : 'user_unfrozen',
						outcome: 'success',
						details: { reason: input.reason },
					},
					tx,
				);
			});
			return { saved: true };
		}),
	payments: adminProcedure
		.input(
			z.object({
				after: z.string().uuid().optional(),
				status: z.string().max(30).optional(),
				actorId: z.string().max(255).optional(),
				limit: z.number().int().min(1).max(100).default(50),
			}),
		)
		.query(async ({ input }) => {
			const items = await db
				.select({
					id: payments.id,
					actorId: payments.actorId,
					kind: payments.kind,
					status: payments.status,
					grossAmount: payments.grossAmount,
					recipientAmount: payments.recipientAmount,
					refundedAmount: payments.refundedAmount,
					currency: payments.currency,
					createdAt: payments.createdAt,
					paidAt: payments.paidAt,
					askId: payments.askId,
					fundId: payments.fundId,
				})
				.from(payments)
				.where(
					and(
						eq(payments.livemode, liveMode()),
						input.status ?
							sql`${payments.status} = ${input.status}`
						:	undefined,
						input.actorId ?
							eq(payments.actorId, input.actorId)
						:	undefined,
						input.after ? gt(payments.id, input.after) : undefined,
					),
				)
				.orderBy(asc(payments.id))
				.limit(input.limit);
			return {
				items,
				nextCursor: items.at(-1)?.id ?? null,
				observedAt: new Date(),
			};
		}),
	paymentDetail: adminProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ input }) => {
			const payment = await db.query.payments.findFirst({
				where: and(
					eq(payments.id, input.id),
					eq(payments.livemode, liveMode()),
				),
			});
			if (!payment) throw new TRPCError({ code: 'NOT_FOUND' });
			// Checkout/receipt URLs can grant access; never put them in admin timelines.
			const {
				checkoutUrl: _checkoutUrl,
				receiptUrl: _receiptUrl,
				...safePayment
			} = payment;
			const [ledger, cases] = await Promise.all([
				db
					.select()
					.from(paymentLedger)
					.where(eq(paymentLedger.paymentId, input.id)),
				db
					.select()
					.from(paymentCases)
					.where(eq(paymentCases.paymentId, input.id)),
			]);
			return {
				payment: safePayment,
				ledger,
				cases,
				observedAt: new Date(),
			};
		}),
	operations: adminProcedure.query(async () => {
		const [cases, webhooks, allocations] = await Promise.all([
			db
				.select()
				.from(paymentCases)
				.where(isNull(paymentCases.resolvedAt))
				.orderBy(desc(paymentCases.createdAt))
				.limit(100),
			db
				.select()
				.from(paymentWebhookInbox)
				.where(
					and(
						eq(paymentWebhookInbox.livemode, liveMode()),
						sql`${paymentWebhookInbox.status} in ('pending','failed')`,
					),
				)
				.orderBy(desc(paymentWebhookInbox.createdAt))
				.limit(100),
			db
				.select()
				.from(fundAllocations)
				.where(
					and(
						eq(fundAllocations.livemode, liveMode()),
						eq(fundAllocations.status, 'recovery_required'),
					),
				)
				.orderBy(desc(fundAllocations.createdAt))
				.limit(100),
		]);
		return { cases, webhooks, allocations, observedAt: new Date() };
	}),
	simulations: adminProcedure.query(async () => ({
		items: await db
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.environment, environment()))
			.orderBy(desc(simulationRuns.createdAt))
			.limit(100),
		observedAt: new Date(),
		enabled:
			environment() === 'staging' &&
			process.env['SIMULATION_ENABLED'] === 'true',
	})),
	simulation: adminProcedure
		.input(z.object({ id: z.string().max(64) }))
		.query(async ({ input }) => {
			const run = await db.query.simulationRuns.findFirst({
				where: and(
					eq(simulationRuns.id, input.id),
					eq(simulationRuns.environment, environment()),
				),
			});
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			const agents = await db
				.select()
				.from(simulationAgents)
				.where(eq(simulationAgents.runId, run.id))
				.orderBy(asc(simulationAgents.name));
			return {
				run,
				agents,
				observedAt: new Date(),
				online: simulationRunnerOnline(run),
			};
		}),
	createSimulation: adminProcedure
		.input(
			z
				.object({
					name: z.string().trim().min(3).max(160),
					mode: z
						.enum(['autonomous', 'deterministic', 'scripted'])
						.default('scripted'),
					agentCount: z.number().int().min(1).max(280).default(253),
					browserUsers: z.number().int().min(1).max(30).default(3),
				})
				.superRefine((input, context) => {
					if (input.mode !== 'scripted' && input.agentCount > 100)
						context.addIssue({
							code: 'custom',
							message:
								'Legacy model runs allow at most 100 accounts.',
						});
					if (
						input.mode === 'scripted' &&
						input.browserUsers > input.agentCount
					)
						context.addIssue({
							code: 'custom',
							message:
								'Browser users must fit within the total account population.',
						});
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = await assertSimulationEnvironment();
			return db.transaction(async (tx) => {
				const [run] = await tx
					.insert(simulationRuns)
					.values({
						name: input.name,
						mode: input.mode,
						agentCount: input.agentCount,
						settings:
							input.mode === 'scripted' ?
								{ browserUsers: input.browserUsers }
							:	{},
						createdById: ctx.session.user.id,
						databaseIdentity: target.databaseIdentity,
					})
					.returning();
				await recordEvent(
					{
						actorId: ctx.session.user.id,
						entityType: 'simulation',
						entityId: run!.id,
						runId: run!.id,
						action: 'simulation_created',
						outcome: 'success',
						details: {
							agentCount: input.agentCount,
							mode: input.mode,
							browserUsers:
								input.mode === 'scripted' ?
									input.browserUsers
								:	0,
						},
					},
					tx,
				);
				return run!;
			});
		}),
	recoverSimulationController: adminProcedure
		.input(controllerRecoverySchema)
		.mutation(async ({ ctx, input }) => {
			const target = await assertSimulationEnvironment();
			return recoverSimulationController(
				ctx.session.user.id,
				target.databaseIdentity,
				input,
			);
		}),
	controlSimulation: adminProcedure
		.input(
			z.object({
				runId: z.string().max(64),
				type: z.enum([
					'start',
					'pause',
					'resume',
					'stop',
					'set_concurrency',
					'set_rate',
					'pause_agent',
					'resume_agent',
				]),
				agentId: z.string().max(64).optional(),
				value: z.number().positive().max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertSimulationEnvironment();
			const run = await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, input.runId),
			});
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (
				run.environment !== 'staging' ||
				run.databaseIdentity !== process.env['DATABASE_IDENTITY']
			) {
				throw new TRPCError({ code: 'FORBIDDEN' });
			}
			if (['completed', 'stopped', 'cancelled'].includes(run.status)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'Create and provision a new run; a finished run remains historical.',
				});
			}
			if (
				['set_concurrency', 'set_rate'].includes(input.type) &&
				input.value === undefined
			)
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'A numeric setting is required.',
				});
			if (
				input.type === 'set_rate' &&
				(input.value! < 0.1 || input.value! > 5)
			) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'The activity rate must be between 0.1 and 5.',
				});
			}
			if (
				input.type === 'set_concurrency' &&
				(!Number.isInteger(input.value) ||
					input.value! >
						(run.mode === 'scripted' ?
							Math.min(
								30,
								Number(run.settings['browserUsers'] ?? 3),
							)
						:	2))
			)
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						run.mode === 'scripted' ?
							'Browser concurrency must fit the configured browser population, up to 30.'
						:	'Model runs allow at most two concurrent inference requests.',
				});
			if (input.type.endsWith('_agent')) {
				if (
					!input.agentId ||
					!(await db.query.simulationAgents.findFirst({
						where: and(
							eq(simulationAgents.id, input.agentId),
							eq(simulationAgents.runId, input.runId),
						),
					}))
				)
					throw new TRPCError({ code: 'NOT_FOUND' });
			}
			const [command] = await db
				.insert(simulationCommands)
				.values({
					runId: input.runId,
					actorId: ctx.session.user.id,
					type: input.type === 'start' ? 'resume' : input.type,
					agentId: input.agentId,
					value: input.value,
				})
				.returning();
			await recordEvent({
				actorId: ctx.session.user.id,
				entityType: 'simulation',
				entityId: input.runId,
				runId: input.runId,
				action: `command_${input.type}`,
				outcome: 'requested',
				details: {
					commandId: command!.id,
					value: input.value,
					agentId: input.agentId,
				},
			});
			// Runner heartbeat, not a queued command, is the authority on actual running state.
			return { commandId: command!.id, queued: true };
		}),
});
