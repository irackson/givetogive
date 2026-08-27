import { ensureErrMessage } from '@/lib/utils/errorParsing';
import { createSlugBase, createSlugCandidate } from '@/lib/utils/slug';
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import { asks, insertAskSchema, selectAskSchema } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const MAX_SLUG_ATTEMPTS = 100;

export const askRouter = createTRPCRouter({
	createAsk: protectedProcedure
		.input(
			insertAskSchema.pick({
				title: true,
				description: true,
				difficulty: true,
				estimatedMinutesToComplete: true,
			}),
		)
		.mutation(
			async ({
				ctx,
				input: {
					title,
					description,
					difficulty,
					estimatedMinutesToComplete,
				},
			}) => {
				const slugBase = createSlugBase(title);

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
								title,
								slug: newlyCreatedSlug,
								description,
								difficulty,
								estimatedMinutesToComplete,
								status: 'not_started',
								createdById: ctx.session.user.id,
							})
							.returning({ newlyCreatedAskId: asks.id });

						if (!doc) {
							throw Error(
								'The database did not return the new Ask',
							);
						}

						return {
							newlyCreatedAskId: doc.newlyCreatedAskId,
							newlyCreatedSlug,
						};
					} catch (error: unknown) {
						if (hasDatabaseErrorCode(error, '23505')) continue;

						const { message, cause } = ensureErrMessage(error);
						console.error({ message, cause });
						throw Error(`Failed to create ask: ${message}`, {
							cause,
						});
					}
				}

				throw Error(
					`Failed to create ask: could not find a unique slug after ${MAX_SLUG_ATTEMPTS} attempts`,
				);
			},
		),

	getAsks: publicProcedure
		.input(
			z.object({
				filter: insertAskSchema
					.pick({
						createdById: true,
					})
					.optional(),
			}),
		)
		.query(async ({ ctx, input: { filter } }) => {
			return ctx.db
				.select()
				.from(asks)
				.where(
					filter?.createdById ?
						eq(asks.createdById, filter.createdById)
					:	undefined,
				)
				.limit(100);
		}),

	getAsk: publicProcedure
		.input(
			z.union([
				selectAskSchema.pick({
					id: true,
				}),
				selectAskSchema.pick({
					slug: true,
				}),
			]),
		)
		.query(async ({ ctx, input }) => {
			const ask = await ctx.db
				.select()
				.from(asks)
				.where(
					'id' in input ?
						eq(asks.id, input.id)
					:	eq(asks.slug, input.slug),
				)
				.limit(1)
				.then((res) => {
					const [ask] = res;
					if (!ask)
						throw Error(
							`Ask ${'id' in input ? `with id '${input.id}'` : `with slug '${input.slug}`}' not found`,
						);
					return ask;
				});

			return ask;
		}),
});
