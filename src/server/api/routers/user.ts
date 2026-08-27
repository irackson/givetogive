import { registrationSchema } from '@/server/auth/credentials';
import { hashPassword } from '@/server/auth/password';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import { users } from '@/server/db/schema';
import { sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const userRouter = createTRPCRouter({
	register: publicProcedure
		.input(registrationSchema)
		.mutation(async ({ ctx, input: { email, name, password } }) => {
			const [existingUser] = await ctx.db
				.select({ id: users.id })
				.from(users)
				.where(sql`lower(${users.email}) = ${email}`)
				.limit(1);

			if (existingUser) {
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'An account already exists for that email address.',
				});
			}

			const hashedPassword = await hashPassword(password);

			try {
				await ctx.db.insert(users).values({
					email,
					hashedPassword,
					name,
				});
			} catch (error: unknown) {
				if (hasDatabaseErrorCode(error, '23505')) {
					throw new TRPCError({
						code: 'CONFLICT',
						message:
							'An account already exists for that email address.',
					});
				}

				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Unable to create the account.',
					cause: error,
				});
			}

			return { success: true };
		}),
});
