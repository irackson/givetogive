/** Anonymous published views only. No env files, login, fixtures or form submits. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const origin = 'https://givetogive.vercel.app';
export const publicPaths = Object.freeze([
	'/',
	'/asks',
	'/signin',
	'/signup',
	'/forgot-password',
	'/reset-password',
	'/verify-email',
	'/auth-error',
	'/signout',
	'/support',
	'/funds',
	'/giving',
	'/account/billing',
	'/account/receiving',
	'/account/security',
	'/admin',
	'/admin/activity',
	'/admin/simulations',
]);
/** @param {unknown} method */
export function readOnlyMethod(method) {
	return (
		typeof method === 'string' &&
		['GET', 'HEAD', 'OPTIONS'].includes(method)
	);
}
/** @param {unknown} href @param {unknown} kind */
export function publicDetailPath(href, kind) {
	if (
		typeof href !== 'string' ||
		typeof kind !== 'string' ||
		!['asks', 'members'].includes(kind)
	)
		return null;
	const expression = new RegExp(`^/${kind}/[A-Za-z0-9_-]{1,200}$`);
	return expression.test(href) ? href : null;
}
/** Admin's existing shared layout returns to /admin, not its child route.
 * @param {string} route
 */
export function signInCallback(route) {
	return route.startsWith('/admin') ? '/admin' : route;
}

export async function capturePublicWalkthrough() {
	assert.ok(
		freemem() >= 2.5 * 1024 ** 3,
		'Browser startup memory floor not met',
	);
	const root = fileURLToPath(new URL('../', import.meta.url));
	const namespace = `walkthrough-public-${randomUUID()}`;
	const directory = path.join(root, 'tmp', namespace, 'production');
	await mkdir(path.join(directory, 'images'), { recursive: true });
	const manifest = {
		kind: 'anonymous-public-walkthrough',
		baseURL: origin,
		origin,
		environment: 'production',
		status: 'capturing',
		cleanup: 'no-fixtures',
		readOnly: true,
		authenticated: false,
		mutationRequests: 0,
		errors: /** @type {string[]} */ ([]),
		startedAt: new Date().toISOString(),
		capturedAt: /** @type {string | null} */ (null),
		fixtureDisclosure:
			'Current public records only, including any historical demonstration accounts or Asks already published; they are not proof of real community adoption. This capture creates no fixtures, sign-ins or writes. Protected-route screenshots show the access boundary, not authenticated features. Recovery pages have no tokens. No paid-state, email-delivery or simulation acceptance is claimed.',
		views: /** @type {Array<{ index: number, title: string, caption: string, route: string, finalPath: string, status: number, image: string, imageSha256: string, capturedAt: string, viewport: {width: number, height: number}, dialogIds: string[], authenticatedViewCaptured: boolean }>} */ ([]),
	};
	const browser = await chromium.launch({ headless: true });
	let lowMemory = false;
	let timedOut = false;
	const deadline = setTimeout(
		() => {
			timedOut = true;
			void browser.close().catch(() => {});
		},
		10 * 60 * 1000,
	);
	deadline.unref();
	const monitor = setInterval(() => {
		if (freemem() < 1.5 * 1024 ** 3) {
			lowMemory = true;
			void browser.close().catch(() => {});
		}
	}, 1000);
	monitor.unref();
	try {
		/** @type {string | null} */
		let askDetail = null;
		/** @type {string | null} */
		let memberDetail = null;
		for (const viewport of [
			{ width: 1440, height: 1000 },
			{ width: 390, height: 844 },
		]) {
			const context = await browser.newContext({
				viewport,
				reducedMotion: 'reduce',
			});
			try {
				await context.route('**/*', async (route) => {
					if (!readOnlyMethod(route.request().method())) {
						manifest.mutationRequests++;
						await route.abort();
					} else await route.continue();
				});
				const page = await context.newPage();
				page.on('console', (message) => {
					if (message.type() === 'error')
						manifest.errors.push('browser-console-error');
				});
				page.on('pageerror', () =>
					manifest.errors.push('browser-page-error'),
				);
				page.on('response', (response) => {
					if (response.status() >= 400)
						manifest.errors.push(`http-${response.status()}`);
				});
				/** @type {string[]} */
				const routes = [...publicPaths];
				if (askDetail) routes.push(askDetail);
				if (memberDetail) routes.push(memberDetail);
				for (let position = 0; position < routes.length; position++) {
					const route = routes[position];
					assert.ok(route, 'Expected a bounded route');
					const response = await page.goto(origin + route, {
						waitUntil: 'networkidle',
						timeout: 45000,
					});
					assert.equal(
						response?.status(),
						200,
						'Public document must render',
					);
					const final = new URL(page.url());
					assert.equal(
						final.origin,
						origin,
						'Navigation must remain on published origin',
					);
					const protectedRoute =
						route.startsWith('/admin') ||
						route.startsWith('/account/') ||
						route === '/giving';
					assert.equal(
						final.pathname,
						protectedRoute ? '/signin' : route,
						'Unexpected route outcome',
					);
					if (protectedRoute)
						assert.equal(
							final.searchParams.get('callbackUrl'),
							signInCallback(route),
						);
					await page
						.locator('main')
						.waitFor({ state: 'visible', timeout: 10000 });
					assert.ok(
						(await page.locator('main').innerText()).trim().length >
							0,
					);
					await page.evaluate(async () => {
						await document.fonts.ready;
					});
					if (route === '/' || route === '/asks') {
						const selector =
							route === '/' ?
								'.home-hero__art img'
							:	'.asks-hero__art';
						await page.waitForFunction(
							(selector) => {
								const image = document.querySelector(selector);
								return (
									image instanceof HTMLImageElement &&
									image.complete &&
									image.naturalWidth > 0
								);
							},
							selector,
							{ timeout: 10000 },
						);
					}
					if (route === '/asks' && !askDetail) {
						for (const href of await page
							.locator('main a[href]')
							.evaluateAll((links) =>
								links.map((link) => link.getAttribute('href')),
							)) {
							askDetail ??= publicDetailPath(href, 'asks');
						}
						if (askDetail) routes.push(askDetail);
					}
					if (route === askDetail && !memberDetail) {
						for (const href of await page
							.locator('main a[href]')
							.evaluateAll((links) =>
								links.map((link) => link.getAttribute('href')),
							)) {
							memberDetail ??= publicDetailPath(href, 'members');
						}
						if (memberDetail) routes.push(memberDetail);
					}
					const index = manifest.views.length + 1;
					const image = path.join(
						directory,
						'images',
						`${String(index).padStart(3, '0')}.png`,
					);
					const bytes = await page.screenshot({
						path: image,
						fullPage: true,
						animations: 'disabled',
						mask: [
							page.getByText(
								/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
							),
						],
					});
					manifest.views.push({
						index,
						title: `${route} - ${viewport.width === 390 ? 'mobile' : 'desktop'}`,
						caption:
							protectedRoute ?
								'Anonymous access redirects to sign in; authenticated view not captured.'
							: (
								['/verify-email', '/reset-password'].includes(
									route,
								)
							) ?
								'Tokenless recovery state; no verification or password change requested.'
							:	'Current published anonymous view; no interactions submitted.',
						route,
						finalPath: final.pathname,
						status: response.status(),
						image: path.relative(root, image).replaceAll('\\', '/'),
						imageSha256: createHash('sha256')
							.update(bytes)
							.digest('hex'),
						capturedAt: new Date().toISOString(),
						viewport,
						dialogIds: [],
						authenticatedViewCaptured: false,
					});
				}
			} finally {
				await context.close();
			}
		}
		assert.equal(
			manifest.mutationRequests,
			0,
			'Unexpected mutation attempt',
		);
		assert.deepEqual(manifest.errors, [], 'Capture has runtime errors');
		assert.equal(lowMemory, false, 'Browser running memory floor violated');
		assert.equal(timedOut, false, 'Capture deadline violated');
		manifest.status = 'complete';
	} catch {
		manifest.status = 'failed';
		manifest.errors.push(
			lowMemory ? 'memory-floor-violated'
			: timedOut ? 'capture-deadline-violated'
			: 'capture-incomplete',
		);
	} finally {
		clearInterval(monitor);
		clearTimeout(deadline);
		await browser.close();
		manifest.capturedAt = new Date().toISOString();
		await writeFile(
			path.join(directory, 'manifest.json'),
			JSON.stringify(manifest),
			{ flag: 'wx' },
		);
	}
	return {
		status: manifest.status,
		views: manifest.views.length,
		mutationRequests: manifest.mutationRequests,
		errors: manifest.errors,
		manifest: path
			.relative(root, path.join(directory, 'manifest.json'))
			.replaceAll('\\', '/'),
		paymentAcceptance: false,
		emailDeliveryAcceptance: false,
		simulationAcceptance: false,
	};
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	assert.deepEqual(
		process.argv.slice(2),
		['--capture-readonly'],
		'Explicit read-only capture flag required',
	);
	const result = await capturePublicWalkthrough();
	console.log(JSON.stringify(result));
	if (result.status !== 'complete') process.exitCode = 1;
}
