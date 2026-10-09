/** Credential-free public smoke. No sign-in, mutations, provider keys or local env files. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = 'https://givetogive.vercel.app';
const paths = ['/', '/asks', '/signin', '/admin'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const diagnostics = { consoleErrors: 0, pageErrors: 0, httpErrors: 0 };
const results = [];
page.on('console', (message) => {
	if (message.type() === 'error') diagnostics.consoleErrors++;
});
page.on('pageerror', () => diagnostics.pageErrors++);
page.on('response', (response) => {
	if (response.status() >= 400) diagnostics.httpErrors++;
});
try {
	// Fail closed if a page unexpectedly attempts any business mutation.
	await context.route('**/*', async (route) => {
		const method = route.request().method();
		if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
			diagnostics.httpErrors++;
			await route.abort();
			return;
		}
		await route.continue();
	});
	for (const path of paths) {
		const response = await page.goto(`${origin}${path}`, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		});
		assert.ok(response, 'Navigation must return a document response');
		assert.equal(
			response?.status(),
			200,
			'Public document must render successfully',
		);
		const finalUrl = new URL(page.url());
		assert.equal(
			finalUrl.origin,
			origin,
			'Navigation must stay on the published site',
		);
		assert.equal(finalUrl.pathname, path === '/admin' ? '/signin' : path);
		if (path === '/admin')
			assert.equal(finalUrl.searchParams.get('callbackUrl'), '/admin');
		await page
			.locator('main')
			.waitFor({ state: 'visible', timeout: 10_000 });
		assert.ok((await page.locator('main').innerText()).trim().length > 0);
		let heroImageDecoded;
		if (path === '/' || path === '/asks') {
			const selector = path === '/' ? '.home-hero__art img' : '.asks-hero__art';
			assert.equal(await page.locator(selector).count(), 1);
			await page.waitForFunction((selector) => {
				const image = document.querySelector(selector);
				return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
			}, selector, { timeout: 10000 });
			heroImageDecoded = true;
		}
		results.push({
			path,
			status: response.status(),
			rendered: true,
			finalPath: finalUrl.pathname,
			...(heroImageDecoded ? { heroImageDecoded } : {}),
		});
	}
	assert.deepEqual(diagnostics, {
		consoleErrors: 0,
		pageErrors: 0,
		httpErrors: 0,
	});
	console.log(
		JSON.stringify({
			kind: 'published-public-browser-smoke',
			origin,
			results,
			diagnostics,
			authenticatedAcceptance: false,
			simulationAcceptance: false,
			paymentAcceptance: false,
		}),
	);
} finally {
	await context.close();
	await browser.close();
}
