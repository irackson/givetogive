import { env } from '@/env';
import { credentialsSchema } from '@/server/auth/credentials';
import { verifyPassword } from '@/server/auth/password';
import {
	clearRateLimit,
	isRateLimited,
	recordRateLimitAttempt,
} from '@/server/auth/rate-limit';
import { db } from '@/server/db';
import {
	accounts,
	sessions,
	users,
	verificationTokens,
} from '@/server/db/schema';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { sql } from 'drizzle-orm';
import NextAuth, { type DefaultSession } from 'next-auth';
import { type Adapter } from 'next-auth/adapters';
import CredentialsProvider from 'next-auth/providers/credentials';
import DiscordProvider from 'next-auth/providers/discord';

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module 'next-auth' {
	interface Session extends DefaultSession {
		user: {
			id: string;
			// ...other properties
			// role: UserRole;
		} & DefaultSession['user'];
	}

	// interface User {
	//   // ...other properties
	//   // role: UserRole;
	// }
}

/**
 * Auth.js configuration and helpers shared by Server Components, tRPC, and the route handler.
 */
export const { auth, handlers, signIn, signOut } = NextAuth({
	callbacks: {
		session: ({ session, token }) => {
			if (token.sub) session.user.id = token.sub;
			return session;
		},
	},
	adapter: DrizzleAdapter(db, {
		usersTable: users,
		accountsTable: accounts,
		sessionsTable: sessions,
		verificationTokensTable: verificationTokens,
	}) as Adapter,
	...(env.NEXTAUTH_SECRET ? { secret: env.NEXTAUTH_SECRET } : {}),
	session: { strategy: 'jwt' },
	pages: { signIn: '/signin' },
	trustHost: true,
	providers: [
		CredentialsProvider({
			name: 'Email and password',
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' },
			},
			authorize: async (credentials, request) => {
				const parsedCredentials =
					credentialsSchema.safeParse(credentials);
				if (!parsedCredentials.success) return null;

				const { email, password } = parsedCredentials.data;
				if (await isRateLimited('sign-in', email, request.headers))
					return null;
				const [user] = await db
					.select()
					.from(users)
					.where(sql`lower(${users.email}) = ${email}`)
					.limit(1);

				if (
					!user?.hashedPassword ||
					!(await verifyPassword(password, user.hashedPassword)) ||
					!user.emailVerified
				) {
					await recordRateLimitAttempt(
						'sign-in',
						email,
						request.headers,
					);
					return null;
				}
				await clearRateLimit('sign-in', email, request.headers);

				return {
					email: user.email,
					id: user.id,
					image: user.image,
					name: user.name,
				};
			},
		}),
		DiscordProvider({
			clientId: env.DISCORD_CLIENT_ID,
			clientSecret: env.DISCORD_CLIENT_SECRET,
		}),
		/**
		 * ...add more providers here.
		 *
		 * Most other providers require a bit more work than the Discord provider. For example, the
		 * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
		 * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
		 *
		 * @see https://next-auth.js.org/providers/github
		 */
	],
});

/**
 * Compatibility name used throughout the existing application.
 */
export const getServerAuthSession = auth;
