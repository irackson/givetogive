import { defineConfig, devices } from '@playwright/test';
import { loadEnvFile } from 'node:process';

// Never fall back to the production-like root .env.local for browser tests.
if (!process.env['DATABASE_URL']) loadEnvFile('.env.ci.local');
const testEnvironment = process.env['APP_ENV'];
const testDatabase =
	testEnvironment === 'test' ? 'givetogive_ci_20260926'
	: testEnvironment === 'staging' ? 'givetogive_staging_20260926'
	: undefined;
const databaseUrl = new URL(process.env['DATABASE_URL'] ?? 'about:blank');
const browserOrigin = new URL(process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3100');
const localBrowser = ['localhost', '127.0.0.1'].includes(browserOrigin.hostname);
if (!localBrowser && (testEnvironment !== 'staging' || browserOrigin.origin !== process.env['APP_URL'] || browserOrigin.origin !== 'https://givetogive-staging.vercel.app')) {
	throw new Error('Browser tests may only target loopback or the exact isolated staging origin.');
}
if (
	!testDatabase ||
	databaseUrl.pathname !== `/${testDatabase}` ||
	databaseUrl.username !== testDatabase
) {
	throw new Error(
		'Browser tests require the explicitly isolated CI or staging database and role.',
	);
}

export default defineConfig({
	globalSetup: './tests/e2e/protected-stage-setup.ts',
	testDir: './tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	forbidOnly: Boolean(process.env['CI']),
	retries: process.env['CI'] ? 2 : 0,
	reporter: process.env['CI'] ? 'github' : 'list',
	use: {
		baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3100',
		...(!localBrowser ? { storageState: 'tmp/e2e/staging-bypass.json' } : {}),
		// Authentication and TOTP flows carry secrets in network/DOM snapshots.
		// Use explicit redacted screenshots, never persistent raw browser traces.
		trace: 'off',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	...(process.env['PLAYWRIGHT_BASE_URL'] ?
		{}
	:	{
			webServer: {
				command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
				url: 'http://127.0.0.1:3100',
				timeout: 120_000,
				reuseExistingServer: false,
				env: {
					...process.env,
					AUTH_EMAIL_TEST_MODE: 'true',
					APP_URL: 'http://127.0.0.1:3100',
					NEXTAUTH_URL: 'http://127.0.0.1:3100',
				},
			},
		}),
});
