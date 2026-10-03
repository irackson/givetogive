import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser } from 'playwright';
import { CommunityBrowser } from '../src/community-browser.ts';
import { browserDiagnostic, BrowserWorkflowFailure, BrowserObservationUnavailable } from '../src/browser-observation.ts';
import { parseActivity } from '../src/activity.ts';
import { ApiRejection, UiObservationUnavailable, type UiSession } from '../src/ui-session.ts';
import { observationRetryDelay } from '../src/observation-retry.ts';

function fixture(options: { missingUntilReload?: number; consoleError?: boolean; pageError?: boolean; postReadFailure?: boolean; malformedResponse?: boolean; rejection?: boolean; closeFailure?: boolean; preReadFailure?: boolean; admissionFailure?: Error } = {}) {
	let routeHandler: (route: unknown) => Promise<void>;
	let reloads = 0, sent = 0, intents = 0, closed = 0;
	const listeners = new Map<string, (...args: any[]) => void>();
	const ask = { id: 8, type: 'task' as const, createdById: 'other', status: 'not_started', goalAmount: 5, contributedAmount: 0 };
	const response = { status: () => options.rejection ? 400 : 200, body: async () => new TextEncoder().encode(options.malformedResponse ? '{private-fixture-body' : JSON.stringify(options.rejection ? { error: { message: 'private-response-fixture', data: { httpStatus: 400, code: 'BAD_REQUEST' } } } : { result: { data: {} } })), dispose: async () => {} };
	const route = {
		request: () => ({ url: () => 'https://givetogive-staging.vercel.app/api/trpc/ask.createContribution', method: () => 'POST', headers: () => ({}), isNavigationRequest: () => false }),
		fetch: async () => { sent++; return response; }, fulfill: async () => {}, abort: async () => {},
	};
	const locator = { waitFor: async () => {}, getByLabel: () => ({ fill: async () => {} }) };
	const page = {
		on: (name: string, callback: (...args: any[]) => void) => listeners.set(name, callback),
		goto: async () => {
			if (options.consoleError) listeners.get('console')?.({ type: () => 'error', text: () => 'private cookie fixture' });
			if (options.pageError) listeners.get('pageerror')?.(new Error('private DOM fixture'));
		},
		reload: async () => { reloads++; },
		locator: () => locator,
		getByRole: (role: string, input?: { name?: string }) => {
			if (role === 'dialog') return locator;
			if (input?.name === 'Offer a contribution') return { count: async () => reloads >= (options.missingUntilReload ?? 0) ? 1 : 0, isVisible: async () => true, click: async () => {} };
			if (input?.name === 'Confirm contribution') return { click: async () => routeHandler(route) };
			throw new Error('Unexpected test selector');
		},
	};
	const context = {
		route: async (_pattern: string, handler: typeof routeHandler) => { routeHandler = handler; },
		setExtraHTTPHeaders: async () => {},
		request: { get: async () => ({ json: async () => ({ user: { id: 'member' } }), dispose: async () => {} }) },
		newPage: async () => page,
		close: async () => { closed++; if (options.closeFailure) throw new Error('private close fixture'); },
	};
	const browser = { newContext: async () => context, close: async () => {} } as unknown as Browser;
	const api = {
		origin: 'https://givetogive-staging.vercel.app', userId: 'member', context: { storageState: async () => ({ cookies: [], origins: [] }) },
		query: async () => {
			if (options.preReadFailure || (sent && options.postReadFailure)) throw new UiObservationUnavailable();
			return { ...ask, contributions: sent ? [{ id: 44, contributorId: 'member' }] : [] };
		},
	} as unknown as UiSession;
	const runner = new CommunityBrowser(1, async () => browser);
	const [line] = parseActivity(JSON.stringify({ id: 'help', user: 'member', action: 'contribute', ask: { id: 8 }, amount: 1 }));
	return { run: () => runner.action(api, line!, ask, undefined, () => { if (options.admissionFailure) throw options.admissionFailure; intents++; }),
		counts: () => ({ reloads, sent, intents, closed }) };
}
test('actual CommunityBrowser reloads an eligible stale control twice then sends exactly one UI mutation', async () => {
	const setup = fixture({ missingUntilReload: 2 });
	assert.deepEqual(await setup.run(), { kind: 'contribution', id: 44, askId: 8 });
	assert.deepEqual(setup.counts(), { reloads: 2, sent: 1, intents: 1, closed: 1 });
});
test('persistent missing controls halt without member mutation and retain safe pre-intent phase', async () => {
	const setup = fixture({ missingUntilReload: 3 });
	await assert.rejects(setup.run(), error => {
		assert.ok(error instanceof BrowserWorkflowFailure);
		assert.deepEqual(browserDiagnostic(error), { browserPhase: 'contribution_control', browserMutationAdmitted: false, browserMutationSent: false, browserPageErrors: 0, browserConsoleErrors: 0 });
		assert.equal(observationRetryDelay(error, false, 0), undefined);
		return true;
	});
	assert.deepEqual(setup.counts(), { reloads: 2, sent: 0, intents: 0, closed: 1 });
});
test('browser console errors are never hidden by selector recovery or raw diagnostic bodies', async () => {
	const setup = fixture({ missingUntilReload: 2, consoleError: true });
	await assert.rejects(setup.run(), error => {
		assert.ok(error instanceof BrowserWorkflowFailure);
		assert.equal(browserDiagnostic(error).browserConsoleErrors, 1);
		assert.doesNotMatch(error.message + JSON.stringify(browserDiagnostic(error)), /private cookie fixture/);
		return true;
	});
	assert.deepEqual(setup.counts(), { reloads: 0, sent: 0, intents: 0, closed: 1 });
});
test('pre-intent API observation loss remains bounded-retryable but post-send read/response failures never replay', async () => {
	const before = fixture({ preReadFailure: true });
	await assert.rejects(before.run(), error => {
		assert.ok(error instanceof BrowserObservationUnavailable);
		assert.equal(browserDiagnostic(error).browserPhase, 'contribution_target');
		assert.equal(observationRetryDelay(error, false, 0), 1000);
		return true;
	});
	assert.deepEqual(before.counts(), { reloads: 0, sent: 0, intents: 0, closed: 1 });
	for (const options of [{ postReadFailure: true }, { malformedResponse: true }]) {
		const after = fixture(options);
		await assert.rejects(after.run(), error => {
			assert.ok(error instanceof BrowserWorkflowFailure);
			const diagnostic = browserDiagnostic(error);
			assert.equal(diagnostic.browserMutationAdmitted, true);
			assert.equal(diagnostic.browserMutationSent, true);
			assert.equal(diagnostic.browserPhase, options.postReadFailure ? 'entity_verification' : 'mutation_response');
			assert.equal(observationRetryDelay(error, false, 0), undefined);
			assert.doesNotMatch(error.message + JSON.stringify(diagnostic), /private-fixture-body/);
			return true;
		});
		assert.deepEqual(after.counts(), { reloads: 0, sent: 1, intents: 1, closed: 1 });
	}
});
test('a rejected admission hook is preserved exactly and no POST is forwarded', async () => {
	const failure = new Error('fixed admission stop');
	const setup = fixture({ admissionFailure: failure });
	await assert.rejects(setup.run(), error => error === failure);
	assert.deepEqual(setup.counts(), { reloads: 0, sent: 0, intents: 0, closed: 1 });
});
test('page errors remain visible fixed-count failures and context-close failures cannot expose private bodies', async () => {
	for (const options of [{ pageError: true }, { closeFailure: true }]) {
		const setup = fixture(options);
		await assert.rejects(setup.run(), error => {
			assert.ok(error instanceof BrowserWorkflowFailure);
			const diagnostic = browserDiagnostic(error);
			assert.equal(diagnostic.browserPageErrors, options.pageError ? 1 : 0);
			if (options.closeFailure) {
				assert.equal(diagnostic.browserPhase, 'context_close');
				assert.equal(diagnostic.browserMutationAdmitted, true);
			}
			assert.equal(observationRetryDelay(error, false, 0), undefined);
			assert.doesNotMatch(error.message + JSON.stringify(diagnostic), /private DOM fixture|private close fixture/);
			return true;
		});
		assert.equal(setup.counts().closed, 1);
		assert.equal(setup.counts().sent, options.pageError ? 0 : 1);
	}
});
test('authoritative API rejection retains status/code and fixed browser phase without exposing server text', async () => {
	const setup = fixture({ rejection: true });
	await assert.rejects(setup.run(), error => {
		assert.ok(error instanceof ApiRejection);
		assert.equal(error.status, 400);
		assert.equal(error.code, 'BAD_REQUEST');
		assert.equal(browserDiagnostic(error).browserPhase, 'mutation_response');
		assert.equal(browserDiagnostic(error).browserMutationSent, true);
		assert.equal(observationRetryDelay(error, false, 0), undefined);
		assert.doesNotMatch(error.message + JSON.stringify(browserDiagnostic(error)), /private-response-fixture/);
		return true;
	});
	assert.deepEqual(setup.counts(), { reloads: 0, sent: 1, intents: 1, closed: 1 });
});
