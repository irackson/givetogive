import { createEnv } from '@t3-oss/env-nextjs';
import { vercel } from '@t3-oss/env-nextjs/presets-zod';
import { z } from 'zod';

export const env = createEnv({
	extends: [vercel()],
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		APP_ENV: z
			.enum(['development', 'staging', 'production', 'test'])
			.optional(),
		APP_URL: z.string().url().optional(),
		CRON_SECRET: z.string().min(32).optional(),
		DATABASE_URL_UNPOOLED: z.string().url().optional(),
		DATABASE_IDENTITY: z.string().optional(),
		SIMULATION_ENABLED: z.enum(['true', 'false']).optional(),
		STAGING_ACCESS_SECRET: z.string().min(32).optional(),
		ADMIN_ENCRYPTION_KEY: z.string().min(32).optional(),
		STRIPE_SECRET_KEY: z.string().optional(),
		STRIPE_WEBHOOK_SECRET: z.string().optional(),
		STRIPE_V2_WEBHOOK_SECRET: z.string().optional(),
		STRIPE_PORTAL_CONFIGURATION_ID: z.string().optional(),
		STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID: z.string().optional(),
		STRIPE_PLATFORM_ACCOUNT_ID: z.string().optional(),
		STRIPE_PUBLISHABLE_KEY: z.string().optional(),
		STRIPE_SUPPORTER_PRICE_ID: z.string().optional(),
		STRIPE_SUSTAINER_PRICE_ID: z.string().optional(),
		STRIPE_PROCESSING_BPS: z.coerce
			.number()
			.int()
			.min(0)
			.max(5000)
			.optional(),
		STRIPE_PROCESSING_FIXED_CENTS: z.coerce
			.number()
			.int()
			.min(0)
			.max(10000)
			.optional(),
		PAYMENTS_ENABLED: z.enum(['true', 'false']).optional(),
		SUPPORTERS_ENABLED: z.enum(['true', 'false']).optional(),
		FUNDS_ENABLED: z.enum(['true', 'false']).optional(),
		STRIPE_LIVE_APPROVED: z.enum(['true', 'false']).optional(),
		DATABASE_DATABASE: z.string(),
		DATABASE_USER: z.string(),
		DATABASE_PASSWORD: z.string(),
		DATABASE_HOST: z.string(),
		DATABASE_URL: z.string().url(),
		NODE_ENV: z.enum(['development', 'production']).default('development'),
		NEXTAUTH_SECRET:
			process.env.NODE_ENV === 'production' ?
				z.string()
			:	z.string().optional(),
		NEXTAUTH_URL: z.preprocess(
			// This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
			// Since NextAuth.js automatically uses the VERCEL_URL if present.
			(str) => process.env['VERCEL_URL'] ?? str,
			// VERCEL_URL doesn't include `https` so it cant be validated as a URL
			process.env['VERCEL'] ? z.string() : z.string().url(),
		),
		DISCORD_CLIENT_ID: z.string(),
		DISCORD_CLIENT_SECRET: z.string(),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		GOOGLE_REFRESH_TOKEN: z.string().optional(),
		GMAIL_SENDER: z.string().optional(),
		AUTH_EMAIL_TEST_MODE: z.enum(['true']).optional(),
		RESEND_API_KEY: z.string().optional(),
		AUTH_EMAIL_FROM: z.string().optional(),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		APP_ENV: process.env['APP_ENV'],
		APP_URL: process.env['APP_URL'],
		CRON_SECRET: process.env['CRON_SECRET'],
		DATABASE_URL_UNPOOLED: process.env['DATABASE_URL_UNPOOLED'],
		DATABASE_IDENTITY: process.env['DATABASE_IDENTITY'],
		SIMULATION_ENABLED: process.env['SIMULATION_ENABLED'],
		STAGING_ACCESS_SECRET: process.env['STAGING_ACCESS_SECRET'],
		ADMIN_ENCRYPTION_KEY: process.env['ADMIN_ENCRYPTION_KEY'],
		STRIPE_SECRET_KEY: process.env['STRIPE_SECRET_KEY'],
		STRIPE_WEBHOOK_SECRET: process.env['STRIPE_WEBHOOK_SECRET'],
		STRIPE_V2_WEBHOOK_SECRET: process.env['STRIPE_V2_WEBHOOK_SECRET'],
		STRIPE_PORTAL_CONFIGURATION_ID:
			process.env['STRIPE_PORTAL_CONFIGURATION_ID'],
		STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID:
			process.env['STRIPE_CANCELLATION_PORTAL_CONFIGURATION_ID'],
		STRIPE_PLATFORM_ACCOUNT_ID: process.env['STRIPE_PLATFORM_ACCOUNT_ID'],
		STRIPE_PUBLISHABLE_KEY: process.env['STRIPE_PUBLISHABLE_KEY'],
		STRIPE_SUPPORTER_PRICE_ID: process.env['STRIPE_SUPPORTER_PRICE_ID'],
		STRIPE_SUSTAINER_PRICE_ID: process.env['STRIPE_SUSTAINER_PRICE_ID'],
		STRIPE_PROCESSING_BPS: process.env['STRIPE_PROCESSING_BPS'],
		STRIPE_PROCESSING_FIXED_CENTS:
			process.env['STRIPE_PROCESSING_FIXED_CENTS'],
		PAYMENTS_ENABLED: process.env['PAYMENTS_ENABLED'],
		SUPPORTERS_ENABLED: process.env['SUPPORTERS_ENABLED'],
		FUNDS_ENABLED: process.env['FUNDS_ENABLED'],
		STRIPE_LIVE_APPROVED: process.env['STRIPE_LIVE_APPROVED'],
		DATABASE_DATABASE: process.env['DATABASE_DATABASE'],
		DATABASE_USER: process.env['DATABASE_USER'],
		DATABASE_PASSWORD: process.env['DATABASE_PASSWORD'],
		DATABASE_HOST: process.env['DATABASE_HOST'],
		DATABASE_URL: process.env['DATABASE_URL'],
		NODE_ENV: process.env.NODE_ENV,
		NEXTAUTH_SECRET: process.env['NEXTAUTH_SECRET'],
		NEXTAUTH_URL: process.env['NEXTAUTH_URL'],
		DISCORD_CLIENT_ID: process.env['DISCORD_CLIENT_ID'],
		DISCORD_CLIENT_SECRET: process.env['DISCORD_CLIENT_SECRET'],
		GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
		GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
		GOOGLE_REFRESH_TOKEN: process.env['GOOGLE_REFRESH_TOKEN'],
		GMAIL_SENDER: process.env['GMAIL_SENDER'],
		AUTH_EMAIL_TEST_MODE: process.env['AUTH_EMAIL_TEST_MODE'],
		RESEND_API_KEY: process.env['RESEND_API_KEY'],
		AUTH_EMAIL_FROM: process.env['AUTH_EMAIL_FROM'],
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
	isServer: typeof window === 'undefined',
});
