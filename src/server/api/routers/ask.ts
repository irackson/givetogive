import { toStoredAmount } from '@/lib/asks';
import { ensureErrMessage } from '@/lib/utils/errorParsing';
import { createSlugBase, createSlugCandidate } from '@/lib/utils/slug';
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import {
	askContributions,
	asks,
	askTypeSchema,
	insertAskSchema,
	selectAskSchema,
	users,
} from '@/server/db/schema';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
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
		type: askTypeSchema,
		goalAmount: z.number().positive('Goal must be positive').max(1_000_000),
		currency: z.string().trim().length(3).toUpperCase().default('USD'),
	})
	.superRefine(({ goalAmount, type }, ctx) => {
		if (type !== 'money' && !Number.isInteger(goalAmount)) {
			ctx.addIssue({
				code: 'custom',
				message: 'Non-monetary goals must be whole numbers.',
				path: ['goalAmount'],
			});
		}
	});

const activeContribution = ne(askContributions.status, 'cancelled');

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
					const [doc] = await ctx.db
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
								input.type === 'money' ? input.currency : null,
							createdById: ctx.session.user.id,
						})
						.returning({ newlyCreatedAskId: asks.id });

					if (!doc)
						throw Error('The database did not return the new Ask');

					return {
						newlyCreatedAskId: doc.newlyCreatedAskId,
						newlyCreatedSlug,
					};
				} catch (error: unknown) {
					if (hasDatabaseErrorCode(error, '23505')) continue;

					const { message, cause } = ensureErrMessage(error);
					console.error({ message, cause });
					throw new TRPCError({
						code: 'INTERNAL_SERVER_ERROR',
						message: `Failed to create ask: ${message}`,
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

				const storedAmount = toStoredAmount(ask.type, input.amount);
				if (storedAmount <= 0) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'Contribution must be positive.',
					});
				}

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

				const nextTotal = contributedAmount + storedAmount;
				await transaction
					.update(asks)
					.set({
						status:
							nextTotal >= ask.goalAmount ?
								'complete'
							:	'in_progress',
					})
					.where(eq(asks.id, ask.id));

				return {
					contributionId: contribution?.id,
					contributedAmount: nextTotal,
					status:
						nextTotal >= ask.goalAmount ?
							'complete'
						:	'in_progress',
				};
			});
		}),

	getAsks: publicProcedure
		.input(
			z.object({
				filter: insertAskSchema.pick({ createdById: true }).optional(),
			}),
		)
		.query(async ({ ctx, input: { filter } }) => {
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
				})
				.from(asks)
				.leftJoin(askContributions, eq(askContributions.askId, asks.id))
				.where(
					filter?.createdById ?
						eq(asks.createdById, filter.createdById)
					:	undefined,
				)
				.groupBy(asks.id)
				.orderBy(desc(asks.createdAt))
				.limit(100);
		}),

	getAsk: publicProcedure
		.input(
			z.union([
				selectAskSchema.pick({ id: true }),
				selectAskSchema.pick({ slug: true }),
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

			return {
				...result.ask,
				creatorName: result.creatorName,
				contributedAmount,
				contributions,
			};
		}),
});
