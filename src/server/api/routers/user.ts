import { env } from '@/env';
import { applicationEnvironment } from '@/lib/environment';
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import {
	credentialsSchema,
	registrationSchema,
} from '@/server/auth/credentials';
import { sendAuthEmail } from '@/server/auth/email';
import { hashPassword } from '@/server/auth/password';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import { createAuthToken, hashAuthToken } from '@/server/auth/tokens';
import { hasDatabaseErrorCode } from '@/server/db/errors';
import { askContributions, asks, authTokens, users } from '@/server/db/schema';
import { supporterRecognition } from '@/server/payments/coverage';
import { recordEvent } from '@/server/observability/events';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

function createAuthUrl(pathname: string, token: string) {
	const configuredUrl =
		env.APP_URL ??
		process.env['VERCEL_PROJECT_PRODUCTION_URL'] ??
		env.NEXTAUTH_URL;
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
		// Database/provider errors can contain query parameters or authentication links.
		console.error(
			'Auth email delivery failed',
			error instanceof Error ? error.name : 'UnknownError',
		);
		return {
			delivered: false,
			previewUrl:
				(
					env.NODE_ENV === 'development' &&
					applicationEnvironment() === 'development'
				) ?
					url
				:	undefined,
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
	getProfile: publicProcedure
		.input(
			z.object({
				id: z.string().min(1).max(255),
				page: z.number().int().min(1).max(10000).default(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Explicit projection keeps account credentials and contact details private.
			const [member] = await ctx.db
				.select({
					id: users.id,
					name: users.name,
					bio: users.bio,
					location: users.location,
					joinedAt: users.joinedAt,
					showSupporterBadge: users.showSupporterBadge,
					emailConfirmed: sql<boolean>`${users.emailVerified} IS NOT NULL`,
				})
				.from(users)
				.where(eq(users.id, input.id))
				.limit(1);

			if (!member) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Member not found.',
				});
			}

			const isOwner = ctx.session?.user.id === member.id;
			const recognition = await supporterRecognition(member.id, ctx.db);
			const ownSupporterTier = recognition.tier;
			const { showSupporterBadge, ...publicMember } = member;
			const historyFilter = and(
				eq(askContributions.contributorId, member.id),
				isOwner ? undefined : eq(askContributions.status, 'completed'),
			);
			const [history, [contributionStats], [askStats]] =
				await Promise.all([
					ctx.db
						.select({
							id: askContributions.id,
							amount: askContributions.amount,
							status: askContributions.status,
							createdAt: askContributions.createdAt,
							askSlug: asks.slug,
							askTitle: asks.title,
							askType: asks.type,
							currency: asks.currency,
						})
						.from(askContributions)
						.innerJoin(asks, eq(asks.id, askContributions.askId))
						.where(historyFilter)
						.orderBy(
							desc(askContributions.createdAt),
							desc(askContributions.id),
						)
						.limit(20)
						.offset((input.page - 1) * 20),
					ctx.db
						.select({
							completed: sql<number>`count(*) filter (where ${askContributions.status} = 'completed')::int`,
							pledged: sql<number>`count(*) filter (where ${askContributions.status} = 'pledged')::int`,
							cancelled: sql<number>`count(*) filter (where ${askContributions.status} = 'cancelled')::int`,
						})
						.from(askContributions)
						.where(eq(askContributions.contributorId, member.id)),
					ctx.db
						.select({ total: sql<number>`count(*)::int` })
						.from(asks)
						.where(eq(asks.createdById, member.id)),
				]);
			const completed = contributionStats?.completed ?? 0;
			const pledged = contributionStats?.pledged ?? 0;
			const cancelled = contributionStats?.cancelled ?? 0;

			return {
				...publicMember,
				supporterTier:
					showSupporterBadge && ownSupporterTier !== 'neighbor' ?
						ownSupporterTier
					:	null,
				...(isOwner ?
					{
						showSupporterBadge,
						ownSupporterTier,
						ownRecognitionStatus: recognition.status,
					}
				:	{}),
				isOwner,
				history,
				historyTotal:
					isOwner ? completed + pledged + cancelled : completed,
				stats: {
					asksPosted: askStats?.total ?? 0,
					completed,
					// Pending and cancelled offers are visible only to their contributor.
					...(isOwner ? { pledged, cancelled } : {}),
				},
			};
		}),

	updateProfile: protectedProcedure
		.input(
			z.object({
				name: z.string().trim().min(2).max(80),
				bio: z.string().trim().max(500),
				location: z.string().trim().max(120),
				showSupporterBadge: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.db.transaction(async (tx) => {
				const [profile] = await tx
					.update(users)
					.set({
						name: input.name,
						bio: input.bio || null,
						location: input.location || null,
						...(input.showSupporterBadge === undefined ?
							{}
						:	{ showSupporterBadge: input.showSupporterBadge }),
					})
					.where(eq(users.id, ctx.session.user.id))
					.returning({ id: users.id });
				if (!profile) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'Member not found.',
					});
				}
				await recordEvent(
					{
						actorId: ctx.session.user.id,
						entityType: 'user',
						entityId: ctx.session.user.id,
						action: 'profile_updated',
						outcome: 'success',
						summary: 'Member updated their profile preferences.',
					},
					tx,
				);
				return profile;
			});
		}),

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
			await ctx.db.transaction(async (transaction) => {
				const [record] = await transaction
					.delete(authTokens)
					.where(
						and(
							eq(authTokens.tokenHash, tokenHash),
							eq(authTokens.purpose, 'email_verification'),
							gt(authTokens.expiresAt, new Date()),
						),
					)
					.returning({ userId: authTokens.userId });
				if (!record) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'This verification link is invalid or has expired.',
					});
				}
				await transaction
					.update(users)
					.set({ emailVerified: new Date() })
					.where(eq(users.id, record.userId));
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
			const hashedPassword = await hashPassword(password);
			await ctx.db.transaction(async (transaction) => {
				const [record] = await transaction
					.delete(authTokens)
					.where(
						and(
							eq(authTokens.tokenHash, tokenHash),
							eq(authTokens.purpose, 'password_reset'),
							gt(authTokens.expiresAt, new Date()),
						),
					)
					.returning({ userId: authTokens.userId });
				if (!record) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'This password reset link is invalid or has expired.',
					});
				}
				await transaction
					.update(users)
					.set({
						hashedPassword,
						sessionVersion: sql`${users.sessionVersion} + 1`,
					})
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
