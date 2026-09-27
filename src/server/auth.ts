import { env } from '@/env';
import { credentialsSchema } from '@/server/auth/credentials';
import { verifyPassword } from '@/server/auth/password';
import { recordRateLimitAttempt } from '@/server/auth/rate-limit';
import {
	activeSession,
	refreshIdentityToken,
} from '@/server/auth/session-policy';
import { db } from '@/server/db';
import {
	accounts,
	sessions,
	users,
	verificationTokens,
} from '@/server/db/schema';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq, sql } from 'drizzle-orm';
import NextAuth, { AuthError, type DefaultSession } from 'next-auth';
import { type Adapter } from 'next-auth/adapters';
import CredentialsProvider from 'next-auth/providers/credentials';
import DiscordProvider from 'next-auth/providers/discord';

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
// Both next-auth and next-auth/react re-export the core Session type.
declare module '@auth/core/types' {
	interface Session extends DefaultSession {
		/** Always supplied by Auth.js; optional only for trusted legacy server callers. */
		access?: 'active' | 'billing_only';
		user: {
			id: string;
			role: 'member' | 'admin';
			sessionVersion: number;
			authenticatedAt: number;
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
export const {
	auth: getBillingAuthSession,
	handlers,
	signIn,
	signOut,
} = NextAuth({
	callbacks: {
		jwt: async ({ token, user }) => {
			const id = user?.id ?? token.sub;
			if (!id) return null;
			const current = await db.query.users.findFirst({
				where: eq(users.id, id),
				columns: {
					id: true,
					sessionVersion: true,
					role: true,
					frozenAt: true,
					emailVerified: true,
				},
			});
			return refreshIdentityToken(token, current, Boolean(user));
		},
		session: ({ session, token }) => {
			session.access =
				token['access'] === 'billing_only' ? 'billing_only' : 'active';
			if (token.sub) session.user.id = token.sub;
			session.user.role = token['role'] === 'admin' ? 'admin' : 'member';
			session.user.sessionVersion =
				typeof token['sessionVersion'] === 'number' ?
					token['sessionVersion']
				:	0;
			session.user.authenticatedAt =
				typeof token['authenticatedAt'] === 'number' ?
					token['authenticatedAt']
				:	0;
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
	logger: {
		error: (error) => {
			if (
				error instanceof AuthError &&
				error.type === 'CredentialsSignin'
			)
				return;
			// Never serialize Auth.js causes: a database/provider failure can include secrets.
			console.error(
				'Authentication failed',
				error instanceof AuthError ? error.type : 'UnknownError',
			);
		},
	},
	session: { strategy: 'jwt' },
	pages: { signIn: '/signin', signOut: '/signout', error: '/auth-error' },
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
				if (
					!(await recordRateLimitAttempt(
						'sign-in',
						email,
						request.headers,
						11,
					))
				)
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
					return null;
				}

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
export async function auth() {
	return activeSession(await getBillingAuthSession());
}
export const getServerAuthSession = auth;
