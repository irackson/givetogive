import { toStoredAmount } from '@/lib/asks';
import {
	canUpdateContributionStatus,
	getAskStatus,
	isValidContributionAmount,
} from '@/lib/contributionLifecycle';
import { ensureErrMessage } from '@/lib/utils/errorParsing';
import { createSlugBase, createSlugCandidate } from '@/lib/utils/slug';
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import { type db } from '@/server/db';
import {
	askActivities,
	askContributions,
	asks,
	askTypeSchema,
	insertAskSchema,
	savedAsks,
	users,
} from '@/server/db/schema';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

const MAX_SLUG_ATTEMPTS = 100;

const createAskInputSchema = insertAskSchema
	.pick({
		title: true,
		description: true,
		difficulty: true,
		estimatedMinutesToComplete: true,
	})
	.extend({
		title: z.string().trim().min(3).max(256),
		description: z.string().trim().min(10).max(20_000),
		difficulty: z.number().int().min(1).max(5),
		estimatedMinutesToComplete: z.number().int().positive().max(1_000_000),
		type: askTypeSchema,
		goalAmount: z.number().positive('Goal must be positive').max(1_000_000),
		currency: z
			.string()
			.trim()
			.regex(/^[a-zA-Z]{3}$/, 'Use a three-letter currency code')
			.toUpperCase()
			.default('USD'),
	})
	.superRefine(({ goalAmount, type }, ctx) => {
		if (!isValidContributionAmount(type, goalAmount)) {
			ctx.addIssue({
				code: 'custom',
				message:
					type === 'money' ?
						'Money goals must use at most two decimal places.'
					:	'Non-monetary goals must be whole numbers.',
				path: ['goalAmount'],
			});
		}
	});

const activeContribution = ne(askContributions.status, 'cancelled');

const askBrowseInputSchema = z.object({
	type: askTypeSchema.optional(),
	status: z.enum(['not_started', 'in_progress', 'complete']).optional(),
	maxDifficulty: z.number().int().min(1).max(5).optional(),
	maxMinutes: z.number().int().positive().max(10_000).optional(),
	query: z.string().trim().max(100).optional(),
	savedOnly: z.boolean().optional(),
	filter: insertAskSchema.pick({ createdById: true }).optional(),
});

async function syncAskStatus(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	askId: number,
	goalAmount: number,
) {
	const [progress] = await transaction
		.select({
			amount: sql<number>`coalesce(sum(${askContributions.amount}), 0)::int`,
			completedAmount: sql<number>`coalesce(sum(${askContributions.amount}) filter (where ${askContributions.status} = 'completed'), 0)::int`,
		})
		.from(askContributions)
		.where(and(eq(askContributions.askId, askId), activeContribution));
	const contributedAmount = progress?.amount ?? 0;
	const status = getAskStatus(
		contributedAmount,
		goalAmount,
		progress?.completedAmount ?? 0,
	);

	await transaction.update(asks).set({ status }).where(eq(asks.id, askId));
	return {
		contributedAmount,
		completedAmount: progress?.completedAmount ?? 0,
		status,
	};
}

export const askRouter = createTRPCRouter({
	createAsk: protectedProcedure
		.input(createAskInputSchema)
		.mutation(async ({ ctx, input }) => {
			const slugBase = createSlugBase(input.title);
			const storedGoal = toStoredAmount(input.type, input.goalAmount);

			for (
				let sequence = 1;
				sequence <= MAX_SLUG_ATTEMPTS;
				sequence += 1
			) {
				const newlyCreatedSlug = createSlugCandidate(
					slugBase,
					sequence,
				);

				try {
					return await ctx.db.transaction(async (transaction) => {
						const [doc] = await transaction
							.insert(asks)
							.values({
								title: input.title,
								slug: newlyCreatedSlug,
								description: input.description,
								difficulty: input.difficulty,
								estimatedMinutesToComplete:
									input.estimatedMinutesToComplete,
								status: 'not_started',
								type: input.type,
								goalAmount: storedGoal,
								currency:
									input.type === 'money' ?
										input.currency
									:	null,
								createdById: ctx.session.user.id,
							})
							.returning({ newlyCreatedAskId: asks.id });

						if (!doc)
							throw Error(
								'The database did not return the new Ask',
							);

						await transaction.insert(askActivities).values({
							askId: doc.newlyCreatedAskId,
							actorId: ctx.session.user.id,
							type: 'ask_created',
						});

						return {
							newlyCreatedAskId: doc.newlyCreatedAskId,
							newlyCreatedSlug,
						};
					});
				} catch (error: unknown) {
					if (hasDatabaseErrorCode(error, '23505')) continue;

					const { message, cause } = ensureErrMessage(error);
					console.error({ message, cause });
					throw new TRPCError({
						code: 'INTERNAL_SERVER_ERROR',
						message: 'Unable to create this Ask. Please try again.',
						cause,
					});
				}
			}

			throw new TRPCError({
				code: 'CONFLICT',
				message: `Could not find a unique slug after ${MAX_SLUG_ATTEMPTS} attempts.`,
			});
		}),

	createContribution: protectedProcedure
		.input(
			z.object({
				askId: z.number().int().positive(),
				amount: z.number().positive().max(1_000_000),
				note: z.string().trim().max(500).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.db.transaction(async (transaction) => {
				const [ask] = await transaction
					.select()
					.from(asks)
					.where(eq(asks.id, input.askId))
					.limit(1)
					.for('update');

				if (!ask) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Ask not found.',
					});
				}

				if (ask.createdById === ctx.session.user.id) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'You cannot contribute to your own Ask.',
					});
				}

				if (!isValidContributionAmount(ask.type, input.amount)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							ask.type === 'money' ?
								'Use a positive amount with at most two decimal places.'
							:	'Use a positive whole-number amount.',
					});
				}
				const storedAmount = toStoredAmount(ask.type, input.amount);

				const [progress] = await transaction
					.select({
						amount: sql<number>`coalesce(sum(${askContributions.amount}), 0)::int`,
					})
					.from(askContributions)
					.where(
						and(
							eq(askContributions.askId, ask.id),
							activeContribution,
						),
					);

				const contributedAmount = progress?.amount ?? 0;
				const remainingAmount = Math.max(
					ask.goalAmount - contributedAmount,
					0,
				);

				if (remainingAmount === 0) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'This Ask is already fully supported.',
					});
				}

				if (storedAmount > remainingAmount) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'Contribution cannot exceed the remaining goal.',
					});
				}

				const [contribution] = await transaction
					.insert(askContributions)
					.values({
						askId: ask.id,
						contributorId: ctx.session.user.id,
						amount: storedAmount,
						note: input.note || null,
						status: 'pledged',
					})
					.returning({ id: askContributions.id });

				if (!contribution) {
					throw new TRPCError({
						code: 'INTERNAL_SERVER_ERROR',
						message: 'The contribution could not be created.',
					});
				}

				await transaction.insert(askActivities).values({
					askId: ask.id,
					actorId: ctx.session.user.id,
					contributionId: contribution.id,
					type: 'contribution_created',
					metadata: { amount: storedAmount },
				});

				return {
					contributionId: contribution.id,
					...(await syncAskStatus(
						transaction,
						ask.id,
						ask.goalAmount,
					)),
				};
			});
		}),

	updateContributionStatus: protectedProcedure
		.input(
			z.object({
				contributionId: z.number().int().positive(),
				status: z.enum(['completed', 'cancelled']),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.db.transaction(async (transaction) => {
				const [reference] = await transaction
					.select({ askId: askContributions.askId })
					.from(askContributions)
					.where(eq(askContributions.id, input.contributionId))
					.limit(1);
				if (!reference) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Contribution not found.',
					});
				}
				// Match create/edit lock order so concurrent contributions serialize per Ask.
				const [ask] = await transaction
					.select()
					.from(asks)
					.where(eq(asks.id, reference.askId))
					.limit(1)
					.for('update');
				const [contribution] = await transaction
					.select()
					.from(askContributions)
					.where(eq(askContributions.id, input.contributionId))
					.limit(1)
					.for('update');
				if (!ask || !contribution) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Contribution not found.',
					});
				}
				const result = { ask, contribution };

				const isContributor =
					result.contribution.contributorId === ctx.session.user.id;
				const isOwner = result.ask.createdById === ctx.session.user.id;
				if (
					!canUpdateContributionStatus({
						currentStatus: result.contribution.status,
						nextStatus: input.status,
						isContributor,
						isOwner,
					})
				) {
					throw new TRPCError({
						code:
							isContributor || isOwner ? 'BAD_REQUEST' : (
								'FORBIDDEN'
							),
						message:
							contribution.status !== 'pledged' ?
								'Completed and cancelled contributions cannot be changed.'
							: input.status === 'cancelled' ?
								'Only the contributor can cancel this contribution.'
							:	'Only the contributor or Ask owner can mark this contribution complete.',
					});
				}

				if (result.contribution.status === input.status) {
					return syncAskStatus(
						transaction,
						result.ask.id,
						result.ask.goalAmount,
					);
				}

				await transaction
					.update(askContributions)
					.set({ status: input.status })
					.where(eq(askContributions.id, input.contributionId));
				await transaction.insert(askActivities).values({
					askId: result.ask.id,
					actorId: ctx.session.user.id,
					contributionId: input.contributionId,
					type:
						input.status === 'completed' ?
							'contribution_completed'
						:	'contribution_cancelled',
					metadata: { amount: result.contribution.amount },
				});

				return syncAskStatus(
					transaction,
					result.ask.id,
					result.ask.goalAmount,
				);
			});
		}),

	updateAsk: protectedProcedure
		.input(
			z
				.object({
					askId: z.number().int().positive(),
					title: z.string().trim().min(3).max(256).optional(),
					description: z
						.string()
						.trim()
						.min(10)
						.max(20_000)
						.optional(),
					difficulty: z.number().int().min(1).max(5).optional(),
					estimatedMinutesToComplete: z
						.number()
						.int()
						.positive()
						.max(1_000_000)
						.optional(),
					goalAmount: z.number().positive().max(1_000_000).optional(),
				})
				.refine(
					({ askId: _askId, ...updates }) =>
						Object.values(updates).some(
							(value) => value !== undefined,
						),
					{ message: 'Make at least one change.' },
				),
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.db.transaction(async (transaction) => {
				const [ask] = await transaction
					.select()
					.from(asks)
					.where(eq(asks.id, input.askId))
					.limit(1)
					.for('update');
				if (!ask) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Ask not found.',
					});
				}
				if (ask.createdById !== ctx.session.user.id) {
					throw new TRPCError({
						code: 'FORBIDDEN',
						message: 'Only the Ask owner can update it.',
					});
				}
				if (
					input.goalAmount !== undefined &&
					!isValidContributionAmount(ask.type, input.goalAmount)
				) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							ask.type === 'money' ?
								'Money goals must use at most two decimal places.'
							:	'Non-monetary goals must be whole numbers.',
					});
				}

				const storedGoal =
					input.goalAmount === undefined ?
						ask.goalAmount
					:	toStoredAmount(ask.type, input.goalAmount);
				const [progress] = await transaction
					.select({
						amount: sql<number>`coalesce(sum(${askContributions.amount}), 0)::int`,
					})
					.from(askContributions)
					.where(
						and(
							eq(askContributions.askId, ask.id),
							activeContribution,
						),
					);
				if (storedGoal < (progress?.amount ?? 0)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'The goal cannot be lower than current contributions.',
					});
				}

				const updates = {
					title: input.title,
					description: input.description,
					difficulty: input.difficulty,
					estimatedMinutesToComplete:
						input.estimatedMinutesToComplete,
					goalAmount:
						input.goalAmount === undefined ? undefined : storedGoal,
				};
				const changedFields = Object.entries(updates)
					.filter(
						([field, value]) =>
							value !== undefined &&
							value !== ask[field as keyof typeof updates],
					)
					.map(([field]) => field);
				if (changedFields.length === 0) {
					return syncAskStatus(transaction, ask.id, storedGoal);
				}

				await transaction
					.update(asks)
					.set({
						title: input.title,
						description: input.description,
						difficulty: input.difficulty,
						estimatedMinutesToComplete:
							input.estimatedMinutesToComplete,
						goalAmount:
							input.goalAmount === undefined ?
								undefined
							:	storedGoal,
					})
					.where(eq(asks.id, ask.id));
				await transaction.insert(askActivities).values({
					askId: ask.id,
					actorId: ctx.session.user.id,
					type: 'ask_updated',
					metadata: { fields: changedFields },
				});
				return syncAskStatus(transaction, ask.id, storedGoal);
			});
		}),

	setSaved: protectedProcedure
		.input(
			z.object({
				askId: z.number().int().positive(),
				saved: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.saved) {
				const [ask] = await ctx.db
					.select({ id: asks.id })
					.from(asks)
					.where(eq(asks.id, input.askId))
					.limit(1);
				if (!ask)
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Ask not found.',
					});
				await ctx.db
					.insert(savedAsks)
					.values({ askId: input.askId, userId: ctx.session.user.id })
					.onConflictDoNothing();
			} else {
				await ctx.db
					.delete(savedAsks)
					.where(
						and(
							eq(savedAsks.askId, input.askId),
							eq(savedAsks.userId, ctx.session.user.id),
						),
					);
			}
			return { saved: input.saved };
		}),

	getAsks: publicProcedure
		.input(askBrowseInputSchema)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session?.user?.id;
			if (input.savedOnly && !userId) {
				throw new TRPCError({
					code: 'UNAUTHORIZED',
					message: 'Sign in to view saved Asks.',
				});
			}
			const search =
				input.query ?
					`%${input.query.replace(/[\\%_]/g, '\\$&')}%`
				:	undefined;
			const conditions = and(
				input.filter?.createdById ?
					eq(asks.createdById, input.filter.createdById)
				:	undefined,
				input.type ? eq(asks.type, input.type) : undefined,
				input.status ? eq(asks.status, input.status) : undefined,
				input.maxDifficulty ?
					lte(asks.difficulty, input.maxDifficulty)
				:	undefined,
				input.maxMinutes ?
					lte(asks.estimatedMinutesToComplete, input.maxMinutes)
				:	undefined,
				search ?
					or(
						ilike(asks.title, search),
						ilike(asks.description, search),
					)
				:	undefined,
				input.savedOnly && userId ?
					sql`exists (select 1 from ${savedAsks} where ${savedAsks.askId} = ${asks.id} and ${savedAsks.userId} = ${userId})`
				:	undefined,
			);
			return ctx.db
				.select({
					id: asks.id,
					slug: asks.slug,
					title: asks.title,
					description: asks.description,
					difficulty: asks.difficulty,
					estimatedMinutesToComplete: asks.estimatedMinutesToComplete,
					status: asks.status,
					type: asks.type,
					goalAmount: asks.goalAmount,
					currency: asks.currency,
					createdById: asks.createdById,
					createdAt: asks.createdAt,
					contributedAmount: sql<number>`coalesce(sum(${askContributions.amount}) filter (where ${activeContribution}), 0)::int`,
					completedAmount: sql<number>`coalesce(sum(${askContributions.amount}) filter (where ${askContributions.status} = 'completed'), 0)::int`,
					saved:
						userId ?
							sql<boolean>`exists (select 1 from ${savedAsks} where ${savedAsks.askId} = ${asks.id} and ${savedAsks.userId} = ${userId})`
						:	sql<boolean>`false`,
				})
				.from(asks)
				.leftJoin(askContributions, eq(askContributions.askId, asks.id))
				.where(conditions)
				.groupBy(asks.id)
				.orderBy(desc(asks.createdAt), desc(asks.id))
				.limit(100);
		}),

	getAsk: publicProcedure
		.input(
			z.union([
				z.object({
					id: z.number().int().positive().max(2_147_483_647),
				}),
				z.object({ slug: z.string().min(1).max(256) }),
			]),
		)
		.query(async ({ ctx, input }) => {
			const [result] = await ctx.db
				.select({ ask: asks, creatorName: users.name })
				.from(asks)
				.innerJoin(users, eq(users.id, asks.createdById))
				.where(
					'id' in input ?
						eq(asks.id, input.id)
					:	eq(asks.slug, input.slug),
				)
				.limit(1);

			if (!result) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Ask not found.',
				});
			}

			const contributions = await ctx.db
				.select({
					id: askContributions.id,
					amount: askContributions.amount,
					note: askContributions.note,
					status: askContributions.status,
					createdAt: askContributions.createdAt,
					contributorId: askContributions.contributorId,
					contributorName: users.name,
				})
				.from(askContributions)
				.innerJoin(users, eq(users.id, askContributions.contributorId))
				.where(eq(askContributions.askId, result.ask.id))
				.orderBy(desc(askContributions.createdAt));

			const contributedAmount = contributions
				.filter((contribution) => contribution.status !== 'cancelled')
				.reduce(
					(total, contribution) => total + contribution.amount,
					0,
				);
			const completedAmount = contributions
				.filter((contribution) => contribution.status === 'completed')
				.reduce(
					(total, contribution) => total + contribution.amount,
					0,
				);

			const activities = await ctx.db
				.select({
					id: askActivities.id,
					type: askActivities.type,
					metadata: askActivities.metadata,
					createdAt: askActivities.createdAt,
					actorId: askActivities.actorId,
					actorName: users.name,
					contributionId: askActivities.contributionId,
				})
				.from(askActivities)
				.innerJoin(users, eq(users.id, askActivities.actorId))
				.where(eq(askActivities.askId, result.ask.id))
				.orderBy(desc(askActivities.createdAt), desc(askActivities.id));

			return {
				...result.ask,
				creatorName: result.creatorName,
				contributedAmount,
				completedAmount,
				status: getAskStatus(
					contributedAmount,
					result.ask.goalAmount,
					completedAmount,
				),
				contributions: contributions.map((contribution) => ({
					...contribution,
					// Notes can contain coordination details intended only for these two members.
					note: ctx.session?.user.id === result.ask.createdById ||
						ctx.session?.user.id === contribution.contributorId ? contribution.note : null,
				})),
				activities,
			};
		}),
});
