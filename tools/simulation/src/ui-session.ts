import {
	request,
	type APIRequestContext,
	type BrowserContext,
} from 'playwright';
import superjson from 'superjson';
import { assertStagingOrigin } from './config.ts';
import { sessionUserId } from './browser.ts';
import { protectionHeaders } from './protection.ts';

export type UiAccount = {
	id: string;
	userId: string;
	email: string;
	password: string;
};
export const uiQueries = new Set([
	'ask.getAsks',
	'ask.getAsk',
	'billing.availability',
	'billing.quote',
	'billing.askFunding',
	'billing.funds',
	'billing.fund',
	'billing.myOverview',
	'billing.myPayments',
	'billing.payment',
	'billing.mySubscriptions',
	'billing.supporterChangeStatus',
	'billing.listSupporterChanges',
	'billing.myRecipient',
]);
export const uiMutations = new Set([
	'ask.createAsk',
	'ask.setSaved',
	'ask.createContribution',
	'ask.updateContributionStatus',
	// Financial scenarios use normal member cookie auth, never operator/MCP tools.
	// Their caller must durably admit the operation and enforce a sandbox budget.
	'billing.createCheckout',
	'billing.cancelCheckout',
	'billing.previewSupporterChange',
	'billing.confirmSupporterChange',
	'billing.createFundCancellationPortal',
	'billing.enableAskPayments',
	'billing.createPortal',
	'billing.createRecipientSession',
	'billing.createRecipientDashboardLink',
]);
export class ApiRejection extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string) {
		const safeCode =
			(
				[
					'BAD_REQUEST',
					'UNAUTHORIZED',
					'FORBIDDEN',
					'NOT_FOUND',
					'TIMEOUT',
					'CONFLICT',
					'PRECONDITION_FAILED',
					'PAYLOAD_TOO_LARGE',
					'UNPROCESSABLE_CONTENT',
					'TOO_MANY_REQUESTS',
					'INTERNAL_SERVER_ERROR',
					'SERVICE_UNAVAILABLE',
					'HTTP_ERROR',
				].includes(code)
			) ?
				code
			:	'UNKNOWN';
		super(`The UI API rejected the action (${status}, ${safeCode}).`);
		this.status = status;
		this.code = safeCode;
	}
}
export interface UiApi {
	userId: string;
	query(procedure: string, input: unknown): Promise<unknown>;
	mutate(procedure: string, input: unknown): Promise<unknown>;
}
/** A failed allowlisted GET is distinguishable from an uncertain member POST. */
export class UiObservationUnavailable extends Error {
	constructor() {
		super('Member UI observation is unavailable; private response details withheld.');
	}
}
export function assertUiOrigin(
	origin: string,
	environment: NodeJS.ProcessEnv = process.env,
) {
	const url = new URL(origin);
	// Dedicated Playwright CI is a loopback-only exception. The community CLI
	// separately requires an attested HTTPS staging origin and never uses this path.
	if (
		url.protocol === 'http:' &&
		['127.0.0.1', 'localhost'].includes(url.hostname) &&
		!url.username &&
		!url.password &&
		url.pathname === '/' &&
		!url.search &&
		!url.hash &&
		environment['APP_ENV'] === 'test'
	) {
		const database = new URL(environment['DATABASE_URL'] ?? 'about:blank');
		if (
			database.pathname === '/givetogive_ci_20260926' &&
			database.username === 'givetogive_ci_20260926' &&
			url.origin ===
				new URL(
					environment['PLAYWRIGHT_BASE_URL'] ??
						'http://127.0.0.1:3100',
				).origin
		)
			return;
	}
	assertStagingOrigin(origin);
}

/** Member activity has exactly the same cookie auth and tRPC procedures as the UI. */
export class UiSession implements UiApi {
	readonly userId: string;
	readonly origin: string;
	readonly context: APIRequestContext;
	private constructor(
		userId: string,
		origin: string,
		context: APIRequestContext,
	) {
		this.userId = userId;
		this.origin = origin;
		this.context = context;
	}
	static async signIn(origin: string, account: UiAccount, bypass?: string) {
		assertUiOrigin(origin);
		const context = await request.newContext({
			baseURL: origin,
			extraHTTPHeaders: protectionHeaders(bypass),
			timeout: 30000,
		});
		try {
			const csrfResponse = await context.get('/api/auth/csrf', {
				maxRedirects: 0,
			});
			let csrf: { csrfToken?: string };
			try {
				if (!csrfResponse.ok())
					throw new Error('Normal sign-in CSRF request failed.');
				csrf = await csrfResponse.json();
			} finally {
				await csrfResponse.dispose();
			}
			if (!csrf.csrfToken)
				throw new Error('Normal sign-in CSRF token is missing.');
			const response = await context.post(
				'/api/auth/callback/credentials',
				{
					form: {
						csrfToken: csrf.csrfToken,
						email: account.email,
						password: account.password,
						callbackUrl: `${origin}/asks`,
					},
					headers: { 'X-Auth-Return-Redirect': '1' },
					maxRedirects: 0,
				},
			);
			try {
				if (response.status() >= 400)
					throw new Error('Normal member sign-in failed.');
			} finally {
				await response.dispose();
			}
			const session = new UiSession(account.userId, origin, context);
			await session.verifyIdentity();
			return session;
		} catch {
			await context.dispose();
			throw new Error(
				'Normal member sign-in or identity verification failed; private request details withheld.',
			);
		}
	}
	/** Uses a browser's own cookie jar; callers must close the browser context. */
	static async fromBrowser(
		origin: string,
		account: UiAccount,
		context: BrowserContext,
	) {
		assertUiOrigin(origin);
		const session = new UiSession(account.userId, origin, context.request);
		await session.verifyIdentity();
		return session;
	}
	async verifyIdentity() {
		let response;
		try {
			response = await this.context.get(
				`${this.origin}/api/auth/session`,
				{ maxRedirects: 0 },
			);
		} catch {
			throw new Error(
				'Normal session identity request failed; private details withheld.',
			);
		}
		try {
			const identity: unknown =
				response.ok() ? await response.json() : null;
			if (sessionUserId(identity) !== this.userId)
				throw new Error(
					'Normal session identity does not match this participant.',
				);
		} catch {
			throw new Error(
				'Normal session identity could not be verified; private response details withheld.',
			);
		} finally {
			await response.dispose();
		}
	}
	query(procedure: string, input: unknown) {
		return this.call(procedure, input, false);
	}
	mutate(procedure: string, input: unknown) {
		return this.call(procedure, input, true);
	}
	private async call(procedure: string, input: unknown, mutation: boolean) {
		if (!(mutation ? uiMutations : uiQueries).has(procedure))
			throw new Error('Procedure is outside the member UI allowlist.');
		try {
			const serialized = superjson.serialize(input);
			const path = `${this.origin}/api/trpc/${procedure}`;
			const response =
				mutation ?
					await this.context.post(path, {
						data: serialized,
						maxRedirects: 0,
						maxRetries: 0,
					})
				:	await this.context.get(
						`${path}?input=${encodeURIComponent(JSON.stringify(serialized))}`,
						{ maxRedirects: 0, maxRetries: 0 },
					);
			try {
				const body = await response.json();
				if (body.error)
					throw new ApiRejection(
						response.status(),
						String(body.error.json?.data?.code ?? 'UNKNOWN'),
					);
				if (!response.ok() || !body.result?.data)
					throw new Error('UI API returned an unresolved result.');
				return superjson.deserialize(body.result.data);
			} finally {
				await response.dispose();
			}
		} catch (error) {
			if (error instanceof ApiRejection) throw error;
			if (!mutation) throw new UiObservationUnavailable();
			throw new Error(
				'Member UI request outcome is unresolved; private request/response details withheld.',
			);
		}
	}
	async close() {
		await this.context.dispose();
	}
}
