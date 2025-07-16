import { ensureErrMessage } from '@/lib/utils/errorParsing';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { insertUserSchema, users } from '@/server/db/schema';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const userRouter = createTRPCRouter({
	register: publicProcedure
		.input(
			insertUserSchema.pick({ email: true }).extend({
				password: z.string().min(8),
				name: z.string().min(1, 'Name is required'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const hashed = await bcrypt.hash(input.password, 10);

			try {
				await ctx.db.insert(users).values({
					email: input.email,
					name: input.name,
					hashedPassword: hashed,
				});
			} catch (e) {
				const { message, cause } = ensureErrMessage(e);
				console.error({ message, cause });
				throw new Error(message);
			}
		}),
});
