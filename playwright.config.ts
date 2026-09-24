import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	forbidOnly: Boolean(process.env['CI']),
	retries: process.env['CI'] ? 2 : 0,
	reporter: process.env['CI'] ? 'github' : 'list',
	use: {
		baseURL: 'http://127.0.0.1:3100',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
		url: 'http://127.0.0.1:3100',
		timeout: 120_000,
		reuseExistingServer: false,
		env: {
			...process.env,
			AUTH_EMAIL_TEST_MODE: 'true',
			NEXTAUTH_URL: 'http://127.0.0.1:3100',
		},
	},
});
