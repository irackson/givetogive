import { env } from '@/env';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import {
	credentialsSchema,
	registrationSchema,
} from '@/server/auth/credentials';
import { sendAuthEmail } from '@/server/auth/email';
import { hashPassword } from '@/server/auth/password';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import { createAuthToken, hashAuthToken } from '@/server/auth/tokens';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import { authTokens, users } from '@/server/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

function createAuthUrl(pathname: string, token: string) {
	const configuredUrl =
		process.env['VERCEL_PROJECT_PRODUCTION_URL'] ?? env.NEXTAUTH_URL;
	const baseUrl =
		configuredUrl.startsWith('http') ? configuredUrl : (
			`https://${configuredUrl}`
		);
	const url = new URL(pathname, baseUrl);
	url.searchParams.set('token', token);
	return url.toString();
}

async function deliverToken(
	email: string,
	userId: string,
	purpose: 'email_verification' | 'password_reset',
) {
	const { token } = await createAuthToken(userId, purpose);
	const url = createAuthUrl(
		purpose === 'email_verification' ? '/verify-email' : '/reset-password',
		token,
	);

	try {
		return await sendAuthEmail({ to: email, url, purpose });
	} catch (error) {
		console.error('Auth email delivery failed', error);
		return {
			delivered: false,
			previewUrl: env.NODE_ENV === 'development' ? url : undefined,
		};
	}
}

function tooManyRequests() {
	return new TRPCError({
		code: 'TOO_MANY_REQUESTS',
		message: 'Too many attempts. Please wait 15 minutes and try again.',
	});
}

export const userRouter = createTRPCRouter({
	register: publicProcedure
		.input(registrationSchema)
		.mutation(async ({ ctx, input: { email, name, password } }) => {
			if (
				!(await recordRateLimitAttempt('register', email, ctx.headers))
			) {
				throw tooManyRequests();
			}

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
			let userId: string;

			try {
				const [user] = await ctx.db
					.insert(users)
					.values({
						email,
						emailVerified: null,
						hashedPassword,
						name,
					})
					.returning({ id: users.id });
				if (!user)
					throw new Error(
						'The database did not return the new user.',
					);
				userId = user.id;
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

			const delivery = await deliverToken(
				email,
				userId,
				'email_verification',
			);
			return {
				success: true,
				emailDelivered: delivery.delivered,
				verificationUrl: delivery.previewUrl,
			};
		}),

	requestPasswordReset: publicProcedure
		.input(credentialsSchema.pick({ email: true }))
		.mutation(async ({ ctx, input: { email } }) => {
			if (
				!(await recordRateLimitAttempt(
					'password-reset',
					email,
					ctx.headers,
				))
			) {
				throw tooManyRequests();
			}

			const [user] = await ctx.db
				.select({
					id: users.id,
					email: users.email,
					hashedPassword: users.hashedPassword,
				})
				.from(users)
				.where(sql`lower(${users.email}) = ${email}`)
				.limit(1);
			let previewUrl: string | undefined;

			if (user?.hashedPassword) {
				const delivery = await deliverToken(
					user.email,
					user.id,
					'password_reset',
				);
				previewUrl = delivery.previewUrl;
			}

			return {
				success: true,
				message:
					'If an account exists for that email, a reset link has been sent.',
				previewUrl,
			};
		}),

	resendVerification: publicProcedure
		.input(credentialsSchema.pick({ email: true }))
		.mutation(async ({ ctx, input: { email } }) => {
			if (
				!(await recordRateLimitAttempt(
					'verify-email',
					email,
					ctx.headers,
				))
			) {
				throw tooManyRequests();
			}

			const [user] = await ctx.db
				.select({
					id: users.id,
					email: users.email,
					emailVerified: users.emailVerified,
					hashedPassword: users.hashedPassword,
				})
				.from(users)
				.where(sql`lower(${users.email}) = ${email}`)
				.limit(1);
			let previewUrl: string | undefined;

			if (user?.hashedPassword && !user.emailVerified) {
				const delivery = await deliverToken(
					user.email,
					user.id,
					'email_verification',
				);
				previewUrl = delivery.previewUrl;
			}

			return {
				success: true,
				message:
					'If that account still needs verification, a new link has been sent.',
				previewUrl,
			};
		}),

	verifyEmail: publicProcedure
		.input(z.object({ token: z.string().min(32).max(128) }))
		.mutation(async ({ ctx, input: { token } }) => {
			const tokenHash = hashAuthToken(token);
			const [record] = await ctx.db
				.select({ id: authTokens.id, userId: authTokens.userId })
				.from(authTokens)
				.where(
					and(
						eq(authTokens.tokenHash, tokenHash),
						eq(authTokens.purpose, 'email_verification'),
						gt(authTokens.expiresAt, new Date()),
					),
				)
				.limit(1);

			if (!record) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'This verification link is invalid or has expired.',
				});
			}

			await ctx.db.transaction(async (transaction) => {
				await transaction
					.update(users)
					.set({ emailVerified: new Date() })
					.where(eq(users.id, record.userId));
				await transaction
					.delete(authTokens)
					.where(eq(authTokens.id, record.id));
			});

			return { success: true };
		}),

	resetPassword: publicProcedure
		.input(
			z.object({
				token: z.string().min(32).max(128),
				password: credentialsSchema.shape.password,
			}),
		)
		.mutation(async ({ ctx, input: { token, password } }) => {
			const tokenHash = hashAuthToken(token);
			const [record] = await ctx.db
				.select({ id: authTokens.id, userId: authTokens.userId })
				.from(authTokens)
				.where(
					and(
						eq(authTokens.tokenHash, tokenHash),
						eq(authTokens.purpose, 'password_reset'),
						gt(authTokens.expiresAt, new Date()),
					),
				)
				.limit(1);

			if (!record) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'This password reset link is invalid or has expired.',
				});
			}

			const hashedPassword = await hashPassword(password);
			await ctx.db.transaction(async (transaction) => {
				await transaction
					.update(users)
					.set({ hashedPassword })
					.where(eq(users.id, record.userId));
				await transaction
					.delete(authTokens)
					.where(
						and(
							eq(authTokens.userId, record.userId),
							eq(authTokens.purpose, 'password_reset'),
						),
					);
			});

			return { success: true };
		}),
});
