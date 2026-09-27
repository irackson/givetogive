import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from '@playwright/test';

export default async function setup() {
	const origin = new URL(process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3100');
	if (['localhost', '127.0.0.1'].includes(origin.hostname)) return;
	if (process.env['APP_ENV'] !== 'staging' || origin.origin !== 'https://givetogive-staging.vercel.app' || origin.origin !== process.env['APP_URL']) {
		throw new Error('Protection bootstrap is restricted to the isolated staging origin.');
	}
	const value: unknown = JSON.parse(await readFile('tools/simulation/.state/protection.json', 'utf8'));
	if (!value || typeof value !== 'object' || !('vercelProtectionBypass' in value) || typeof value.vercelProtectionBypass !== 'string' || value.vercelProtectionBypass.length < 16) {
		throw new Error('A private staging automation bypass is required.');
	}
	const context = await request.newContext();
	try {
		// The secret is sent once to an exact allowlisted origin. Never put a
		// bypass in global browser headers: those could reach Stripe or OAuth.
		const response = await context.get(origin.origin, { maxRedirects: 0, headers: {
			'x-vercel-protection-bypass': value.vercelProtectionBypass,
			'x-vercel-set-bypass-cookie': 'true',
		} });
		if (![200, 302, 303, 307].includes(response.status())) throw new Error(`Staging access bootstrap failed (${response.status()}).`);
		const state = await context.storageState();
		if (!state.cookies.length || state.cookies.some((cookie) => cookie.domain.replace(/^\./, '') !== origin.hostname)) {
			throw new Error(`Expected a staging-host-only bypass cookie; HTTP ${response.status()}, cookie domains: ${state.cookies.map((cookie) => cookie.domain).join(',') || 'none'}.`);
		}
		await mkdir('tmp/e2e', { recursive: true });
		await writeFile('tmp/e2e/staging-bypass.json', JSON.stringify(state), { mode: 0o600 });
	} finally { await context.dispose(); }
}
