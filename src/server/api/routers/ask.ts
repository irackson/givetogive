import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from 'code/server/api/trpc';
import { asks } from 'code/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export const askRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				title: z.string().min(1),
				description: z.string().min(1),
				estimatedMinutesToComplete: z.number().positive(),
			}),
		)
		.mutation(
			async ({
				ctx,
				input: { title, description, estimatedMinutesToComplete },
			}) => {
				await ctx.db.insert(asks).values({
					title,
					slug: title.toLowerCase().replace(/\s+/g, '-'),
					description,
					estimatedMinutesToComplete,
					status: 'not_started',
					createdById: ctx.session.user.id,
				});
			},
		),

	getAsks: publicProcedure
		.input(
			z.object({
				createdById: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input: { createdById } }) => {
			return ctx.db
				.select()
				.from(asks)
				.where(
					createdById ? eq(asks.createdById, createdById) : undefined,
				)
				.limit(100);
		}),

	getAsk: publicProcedure
		.input(
			z
				.object({
					id: z.number().optional(),
					slug: z.string().optional(),
				})
				.refine((data) => data.id ?? data.slug, {
					message: "Either 'id' or 'slug' must be provided",
				}),
		)
		.query(async ({ ctx, input }) => {
			const ask = await ctx.db
				.select()
				.from(asks)
				.where(
					input.id
						? eq(asks.id, input.id)
						: input.slug
							? eq(asks.slug, input.slug)
							: undefined,
				)
				.limit(1)
				.then((res) => {
					const [ask] = res;
					if (!ask) throw Error('Ask not found');
					return ask;
				});

			return ask;
		}),
});
