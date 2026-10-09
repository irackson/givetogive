/** One explicitly owned AgentMail fixture; normal hosted UI only. Never writes
 * database state directly, captures auth URLs/screenshots, or performs payments. */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { freemem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { encryptionKey, seal, unseal } from './auth-email-envelope.mjs';

const origin = 'https://givetogive-staging.vercel.app',
	repository = 'irackson/givetogive';
// MUI required fields expose the visible asterisk in their accessible label.
export function authFieldLabel(name: 'Name' | 'Email' | 'Password') {
	return new RegExp(`^${name}\\s*\\*?$`);
}
export const authEmailInput = z
	.object({
		purpose: z.literal('owned-agentmail-hosted-auth'),
		nonce: z.uuid(),
		headSha: z.string().regex(/^[a-f0-9]{40}$/),
		issuedAt: z.iso.datetime(),
		phase: z.enum(['signup-resend', 'verify-signin']),
		email: z.literal(
			'ian-4303+givetogive-hosted-1791530445337@agentmail.to',
		),
		password: z.string().min(16).max(128),
		bypass: z.string().min(20).max(256),
		deploymentId: z.string().regex(/^dpl_[a-zA-Z0-9]+$/),
		memberId: z.string().min(1).max(128).optional(),
		oldLink: z.string().optional(),
		replacementLink: z.string().optional(),
	})
	.strict();
type Input = z.infer<typeof authEmailInput>;
function guard(value: unknown): asserts value {
	if (!value)
		throw Error(
			'Hosted auth acceptance stopped; private diagnostics withheld; no automatic retry.',
		);
}
export function receivedAuthLink(raw: string | undefined) {
	guard(typeof raw === 'string');
	const url = new URL(raw);
	guard(
		url.origin === origin &&
			!url.username &&
			!url.password &&
			url.pathname === '/verify-email' &&
			!url.hash &&
			url.searchParams.size === 1 &&
			/^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get('token') ?? ''),
	);
	return url.href;
}
export function validateHostedAuthInput(
	raw: unknown,
	headSha: string,
	phase: string,
	nonce: string,
	now = Date.now(),
) {
	const input = authEmailInput.parse(raw),
		age = now - Date.parse(input.issuedAt);
	guard(
		input.headSha === headSha &&
			input.phase === phase &&
			input.nonce === nonce &&
			age >= 0 &&
			age <= 1200000,
	);
	if (input.phase === 'signup-resend')
		guard(!input.memberId && !input.oldLink && !input.replacementLink);
	else
		guard(
			input.memberId &&
				receivedAuthLink(input.oldLink) !==
					receivedAuthLink(input.replacementLink),
		);
	return input;
}
export function hostedAuthContext(
	env: NodeJS.ProcessEnv,
	platform: string,
	nodeMajor: number,
) {
	guard(
		platform === 'linux' &&
			nodeMajor === 24 &&
			env['GITHUB_REPOSITORY'] === repository &&
			env['GITHUB_REF'] === 'refs/heads/main' &&
			env['GITHUB_EVENT_NAME'] === 'workflow_dispatch' &&
			env['GITHUB_ACTOR'] === 'irackson' &&
			env['GITHUB_TRIGGERING_ACTOR'] === 'irackson' &&
			env['GITHUB_RUN_ATTEMPT'] === '1' &&
			env['GITHUB_JOB'] === 'auth-email' &&
			/^[a-f0-9]{40}$/.test(env['GITHUB_SHA'] ?? '') &&
			env['AUTH_EXPECTED_SHA'] === env['GITHUB_SHA'] &&
			/^[1-9][0-9]*$/.test(env['AUTH_RELEASE_ID'] ?? '') &&
			z.uuid().safeParse(env['AUTH_NONCE']).success &&
			['signup-resend', 'verify-signin'].includes(
				env['AUTH_PHASE'] ?? '',
			) &&
			freemem() >= 2.5 * 1024 ** 3,
	);
	return {
		sha: env['GITHUB_SHA']!,
		releaseId: env['AUTH_RELEASE_ID']!,
		nonce: env['AUTH_NONCE']!,
		phase: env['AUTH_PHASE']!,
	};
}
async function privateDraft(
	releaseId: string,
	nonce: string,
	sha: string,
	token: string,
) {
	const url = `https://api.github.com/repos/${repository}/releases/${releaseId}`;
	const r = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
		},
		redirect: 'error',
		signal: AbortSignal.timeout(30000),
	});
	guard(r.ok);
	const d = (await r.json()) as {
		id: number;
		draft: boolean;
		tag_name: string;
		target_commitish: string;
		assets: { id: number; name: string; size: number; digest: string }[];
	};
	guard(
		String(d.id) === releaseId &&
			d.draft &&
			d.tag_name === `auth-email-${nonce}` &&
			d.target_commitish === sha &&
			d.assets.length <= 4,
	);
	const anonymous = await fetch(url, {
		redirect: 'manual',
		signal: AbortSignal.timeout(30000),
	});
	try {
		guard(anonymous.status === 404);
	} finally {
		await anonymous.body?.cancel();
	}
	return d;
}
async function downloadInput(
	binding: ReturnType<typeof hostedAuthContext>,
	token: string,
) {
	const draft = await privateDraft(
			binding.releaseId,
			binding.nonce,
			binding.sha,
			token,
		),
		name = `auth-input-${binding.phase}.g2genc`;
	const files = draft.assets.filter((a) => a.name === name);
	guard(files.length === 1 && files[0]!.size > 36 && files[0]!.size < 65536);
	const file = files[0]!,
		url = `https://api.github.com/repos/${repository}/releases/assets/${file.id}`;
	const anonymous = await fetch(url, {
		redirect: 'manual',
		signal: AbortSignal.timeout(30000),
	});
	try {
		guard(anonymous.status === 404);
	} finally {
		await anonymous.body?.cancel();
	}
	let r = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/octet-stream',
		},
		redirect: 'manual',
		signal: AbortSignal.timeout(30000),
	});
	if ([302, 307].includes(r.status)) {
		const location = new URL(r.headers.get('location') ?? '');
		guard(
			location.protocol === 'https:' &&
				location.hostname === 'release-assets.githubusercontent.com' &&
				!location.username &&
				!location.password,
		);
		await r.body?.cancel();
		r = await fetch(location, {
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
		});
	}
	guard(r.ok);
	const bytes = Buffer.from(await r.arrayBuffer());
	guard(
		bytes.length === file.size &&
			`sha256:${createHash('sha256').update(bytes).digest('hex')}` ===
				file.digest,
	);
	return bytes;
}
async function browserAcceptance(input: Input) {
	let stage = 'launch';
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const result: Record<string, unknown> = {
		phase: input.phase,
		normalHostedUI: true,
		bypassVerification: false,
		manualRelay: false,
		screenshots: false,
		payments: 0,
	};
	const errors = {
			page: 0,
			console: 0,
			unexpectedHttp: 0,
			expectedInvalidLink: 0,
		},
		posts: Record<string, number> = {};
	const monitor = setInterval(() => {
		if (freemem() < 1.5 * 1024 ** 3) void browser.close();
	}, 1000);
	monitor.unref();
	try {
		await context.route('**/*', async (route) => {
			const request = route.request(),
				url = new URL(request.url()),
				headers = { ...request.headers() };
			delete headers['x-vercel-protection-bypass'];
			if (url.origin === origin) {
				headers['x-vercel-protection-bypass'] = input.bypass;
				if (
					request.method() === 'POST' &&
					url.pathname.startsWith('/api/trpc/')
				) {
					const allowed =
						input.phase === 'signup-resend' ?
							['user.register', 'user.resendVerification']
						:	['user.verifyEmail'];
					const method = url.pathname.slice('/api/trpc/'.length);
					guard(allowed.includes(method));
					posts[method] = (posts[method] ?? 0) + 1;
					guard(
						posts[method]! <=
							(method === 'user.verifyEmail' ? 3 : 1),
					);
				}
			}
			await route.continue({ headers });
		});
		const page = await context.newPage();
		page.setDefaultTimeout(30000);
		page.on('pageerror', () => errors.page++);
		page.on('console', (m) => {
			if (m.type() === 'error') errors.console++;
		});
		page.on('response', (r) => {
			if (r.status() >= 400) {
				const u = new URL(r.url());
				if (
					input.phase === 'verify-signin' &&
					r.status() === 400 &&
					u.origin === origin &&
					u.pathname === '/api/trpc/user.verifyEmail'
				)
					errors.expectedInvalidLink++;
				else errors.unexpectedHttp++;
			}
		});
		if (input.phase === 'signup-resend') {
			stage = 'signup-navigation';
			guard(
				(
					await page.goto(origin + '/signup', {
						waitUntil: 'networkidle',
					})
				)?.status() === 200,
			);
			stage = 'signup-fields';
			await page
				.getByLabel(authFieldLabel('Name'))
				.fill('Hosted AgentMail acceptance');
			await page.getByLabel(authFieldLabel('Email')).fill(input.email);
			await page
				.getByLabel(authFieldLabel('Password'))
				.fill(input.password);
			stage = 'signup-submit';
			const pending = page.waitForResponse(
				(r) =>
					new URL(r.url()).pathname === '/api/trpc/user.register' &&
					r.request().method() === 'POST',
			);
			await page
				.getByRole('button', { name: 'Create account', exact: true })
				.click();
			const response = await pending;
			guard(response.ok());
			stage = 'signup-delivery-ui';
			await page
				.getByRole('alert')
				.filter({
					hasText:
						'Account created. Check your email for a verification link.',
				})
				.waitFor();
			guard(
				(await page
					.getByRole('link', {
						name: 'Open the development verification link',
						exact: true,
					})
					.count()) === 0,
			);
			result['hostedRegistrationDelivered'] = true;
			stage = 'resend-navigation';
			guard(
				(
					await page.goto(origin + '/verify-email', {
						waitUntil: 'networkidle',
					})
				)?.status() === 200,
			);
			stage = 'resend-fields';
			await page.getByLabel(authFieldLabel('Email')).fill(input.email);
			stage = 'resend-submit';
			const resend = page.waitForResponse(
				(r) =>
					new URL(r.url()).pathname ===
						'/api/trpc/user.resendVerification' &&
					r.request().method() === 'POST',
			);
			await page
				.getByRole('button', {
					name: 'Send verification link',
					exact: true,
				})
				.click();
			const resent = await resend;
			guard(resent.ok());
			stage = 'resend-delivery-ui';
			await page
				.getByRole('alert')
				.filter({
					hasText:
						'If that account still needs verification, a new link has been requested.',
				})
				.waitFor();
			guard(
				(await page
					.getByRole('link', {
						name: 'Open the development verification link',
						exact: true,
					})
					.count()) === 0,
			);
			result['hostedResendAccepted'] = true;
			guard(
				posts['user.register'] === 1 &&
					posts['user.resendVerification'] === 1 &&
					!errors.console,
			);
		} else {
			stage = 'superseded-link';
			guard(
				(
					await page.goto(receivedAuthLink(input.oldLink), {
						waitUntil: 'networkidle',
					})
				)?.status() === 200,
			);
			await page
				.getByRole('alert')
				.filter({
					hasText:
						'This verification link is invalid or has expired.',
				})
				.waitFor();
			result['supersededLinkRejected'] = true;
			stage = 'replacement-link';
			guard(
				(await page
					.getByRole('button', {
						name: 'Send verification link',
						exact: true,
					})
					.count()) === 0,
			);
			guard(
				(
					await page.goto(receivedAuthLink(input.replacementLink), {
						waitUntil: 'networkidle',
					})
				)?.status() === 200,
			);
			await page
				.getByRole('alert')
				.filter({ hasText: 'Email verified. You can now sign in.' })
				.waitFor();
			result['replacementLinkVerified'] = true;
			stage = 'consumed-link';
			await page.reload({ waitUntil: 'networkidle' });
			await page
				.getByRole('alert')
				.filter({
					hasText:
						'This verification link is invalid or has expired.',
				})
				.waitFor();
			result['consumedLinkRejected'] = true;
			stage = 'password-signin';
			guard(
				(await page
					.getByRole('button', {
						name: 'Send verification link',
						exact: true,
					})
					.count()) === 0,
			);
			guard(
				(
					await page.goto(origin + '/signin?callbackUrl=%2Fasks', {
						waitUntil: 'networkidle',
					})
				)?.status() === 200,
			);
			await page.getByLabel(authFieldLabel('Email')).fill(input.email);
			await page
				.getByLabel(authFieldLabel('Password'))
				.fill(input.password);
			await page
				.getByRole('button', { name: 'Sign in', exact: true })
				.click();
			await page.waitForURL(
				(u) => u.origin === origin && u.pathname === '/asks',
			);
			const r = await context.request.get(origin + '/api/auth/session', {
				headers: { 'x-vercel-protection-bypass': input.bypass },
			});
			guard(r.ok());
			const session = await r.json();
			guard(
				session.user?.id === input.memberId &&
					session.user.email === input.email &&
					session.user.role === 'member',
			);
			result['normalPasswordSignIn'] = true;
			result['ownSessionIdentityVerified'] = true;
			result['noSecondEmailRequested'] = true;
			guard(
				posts['user.verifyEmail'] === 3 &&
					errors.expectedInvalidLink === 2 &&
					errors.console <= 2,
			);
		}
		stage = 'final-diagnostics';
		guard(
			errors.page === 0 &&
				errors.unexpectedHttp === 0 &&
				freemem() >= 1.5 * 1024 ** 3,
		);
		return { ...result, passed: true, diagnostics: errors, posts };
	} catch {
		// Only fixed stage names and counts are retained, never DOM, URLs or errors.
		return {
			...result,
			passed: false,
			stage,
			diagnostics: errors,
			posts,
			privateDetailsWithheld: true,
			automaticRetryAllowed: false,
		};
	} finally {
		clearInterval(monitor);
		await context.close();
		await browser.close();
	}
}
export async function executeHostedAuthEmail() {
	const b = hostedAuthContext(
			process.env,
			process.platform,
			Number(process.versions.node.split('.')[0]),
		),
		token = process.env['AUTH_RECOVERY_TOKEN'];
	guard(token && token.length >= 20);
	const key = encryptionKey(process.env['AUTH_BUNDLE_KEY']);
	let encrypted: Buffer | undefined;
	let result: Record<string, unknown> = {
		passed: false,
		privateDetailsWithheld: true,
	};
	try {
		encrypted = await downloadInput(b, token);
		const input = validateHostedAuthInput(
			unseal(encrypted, key, 65536),
			b.sha,
			b.phase,
			b.nonce,
		);
		encrypted.fill(0);
		const draft = await privateDraft(b.releaseId, b.nonce, b.sha, token);
		guard(
			!draft.assets.some(
				(a) => a.name === `auth-result-${b.phase}.g2genc`,
			),
		);
		const available = await fetch(
			origin + '/api/trpc/billing.availability',
			{
				headers: { 'x-vercel-protection-bypass': input.bypass },
				redirect: 'error',
				signal: AbortSignal.timeout(30000),
			},
		);
		guard(available.ok);
		const gates = (await available.json()).result?.data?.json;
		guard(gates?.environment === 'staging' && gates.livemode === false);
		try {
			result = await browserAcceptance(input);
		} catch {
			result = {
				phase: b.phase,
				passed: false,
				privateDetailsWithheld: true,
				automaticRetryAllowed: false,
			};
		}
		const output = seal(
			{
				...result,
				nonce: b.nonce,
				headSha: b.sha,
				workflowRunId: process.env['GITHUB_RUN_ID'],
				deploymentId: input.deploymentId,
				observedAt: new Date().toISOString(),
			},
			key,
		);
		try {
			const upload = await fetch(
				`https://uploads.github.com/repos/${repository}/releases/${b.releaseId}/assets?name=auth-result-${b.phase}.g2genc`,
				{
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Content-Type': 'application/octet-stream',
					},
					body: new Uint8Array(output),
					redirect: 'error',
					signal: AbortSignal.timeout(30000),
				},
			);
			guard(upload.status === 201);
			const asset = (await upload.json()) as {
				id: number;
				size: number;
				digest: string;
			};
			const after = await privateDraft(
				b.releaseId,
				b.nonce,
				b.sha,
				token,
			);
			guard(
				after.assets.some(
					(a) =>
						a.id === asset.id &&
						a.size === output.length &&
						a.digest ===
							`sha256:${createHash('sha256').update(output).digest('hex')}`,
				),
			);
		} finally {
			output.fill(0);
		}
		guard(result['passed'] === true);
		return {
			passed: true,
			phase: b.phase,
			encryptedPrivateResultRetained: true,
			paymentActions: 0,
			rawArtifactsUploaded: 0,
		};
	} finally {
		encrypted?.fill(0);
		key.fill(0);
	}
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (process.argv.length === 2)
		console.log(JSON.stringify({ execute: false, externalRequests: 0 }));
	else if (
		process.argv.length === 3 &&
		process.argv[2] === '--execute-hosted'
	)
		executeHostedAuthEmail()
			.then((r) => console.log(JSON.stringify(r)))
			.catch(() => {
				console.error(
					'Hosted auth acceptance stopped; private details withheld; do not rerun.',
				);
				process.exitCode = 1;
			});
	else {
		console.error('Invalid hosted auth action.');
		process.exitCode = 1;
	}
}
