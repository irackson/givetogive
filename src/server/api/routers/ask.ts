import { ensureErrMessage } from '@/lib/utils/errorParsing';
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import { asks, insertAskSchema, selectAskSchema } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

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
				input: { title, description, difficulty, estimatedMinutesToComplete },
			}) => {
				const newlyCreatedSlug = title
					.toLowerCase()
					.replace(/\s+/g, '-');
				const { newlyCreatedAskId } = await ctx.db
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
					.returning({
						newlyCreatedAskId: asks.id,
					})
					.then(([doc]) => {
						if (!doc)
							throw Error(
								`Expected doc to be object with newlyCreatedAskId but got ${doc}`,
							);
						return doc;
					})
					.catch((e: unknown) => {
						const { message, cause } = ensureErrMessage(e);
						console.error({ message, cause });
						throw Error(`Failed to create ask: ${message}`, {
							cause,
						});
					});
				return { newlyCreatedAskId, newlyCreatedSlug };
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
