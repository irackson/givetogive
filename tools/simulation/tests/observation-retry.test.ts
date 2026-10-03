import assert from 'node:assert/strict';
import test from 'node:test';
import { observationRetryDelay } from '../src/observation-retry.ts';
import { ApiRejection, UiObservationUnavailable, UiSession, type UiApi } from '../src/ui-session.ts';
import type { BrowserContext } from 'playwright';
import { executeActivity, parseActivity } from '../src/activity.ts';

test('observation backoff is finite and never retries an admitted mutation or arbitrary error', () => {
	const error = new UiObservationUnavailable();
	assert.deepEqual([0, 1, 2, 3].map(attempt => observationRetryDelay(error, false, attempt)), [1000, 2000, 4000, undefined]);
	for (const attempt of [-1, NaN, Infinity, 0.5]) assert.equal(observationRetryDelay(error, false, attempt), undefined);
	assert.equal(observationRetryDelay(error, true, 0), undefined);
	for (const failure of [new Error('unknown POST outcome'), new ApiRejection(401, 'UNAUTHORIZED'), new ApiRejection(429, 'TOO_MANY_REQUESTS')])
		assert.equal(observationRetryDelay(failure, false, 0), undefined);
});

test('lost selection GET backs off then selects fresh state; lost POST remains pending without replay', async () => {
	const [line] = parseActivity(JSON.stringify({ id: 'save', user: 'member', action: 'save_ask', ask: { id: 8 }, saved: true }));
	let queries = 0, mutations = 0, pending = false;
	const api: UiApi = {
		userId: 'member',
		query: async () => {
			if (++queries === 1) throw new UiObservationUnavailable();
			return { id: 8, type: 'task', createdById: 'other', status: 'not_started', goalAmount: 2, contributedAmount: 0 };
		},
		mutate: async () => { mutations++; },
	};
	const hooks = { beforeMutation() { pending = true; } };
	await assert.rejects(executeActivity(api, line!, new Map(), hooks), error => {
		assert.equal(observationRetryDelay(error, pending, 0), 1000);
		return true;
	});
	assert.equal(pending, false);
	assert.equal(mutations, 0);
	assert.equal((await executeActivity(api, line!, new Map(), hooks)).outcome, 'success');
	assert.equal(queries, 2);
	assert.equal(mutations, 1);
	pending = false;
	api.mutate = async () => { mutations++; throw new UiObservationUnavailable(); };
	await assert.rejects(executeActivity(api, line!, new Map(), hooks), error => {
		assert.equal(observationRetryDelay(error, pending, 0), undefined);
		return true;
	});
	assert.equal(pending, true);
	assert.equal(mutations, 2);
});

test('member transport labels a lost GET only, keeps POST ambiguity and hides private diagnostics', async () => {
	const origin = 'https://givetogive-staging.vercel.app';
	const methods: string[] = [];
	const context = {
		request: {
			async get(url: string) {
				if (url.endsWith('/api/auth/session')) return {
					ok: () => true, json: async () => ({ user: { id: 'member' } }), dispose: async () => {},
				};
				methods.push('GET');
				throw new Error('Private cookie or provider diagnostic must never be exposed');
			},
			async post() { methods.push('POST'); throw new Error('Private POST diagnostic'); },
		},
	} as unknown as BrowserContext;
	const session = await UiSession.fromBrowser(origin, { id: 'member', userId: 'member', email: 'member@example.test', password: 'private' }, context);
	await assert.rejects(session.query('ask.getAsk', { id: 8 }), error => {
		assert.ok(error instanceof UiObservationUnavailable);
		assert.doesNotMatch(error.message, /cookie|provider|diagnostic/);
		return true;
	});
	await assert.rejects(session.mutate('ask.setSaved', { askId: 8, saved: true }), error => {
		assert.ok(error instanceof Error && !(error instanceof UiObservationUnavailable));
		assert.doesNotMatch(error.message, /Private POST/);
		return true;
	});
	await assert.rejects(session.query('ask.setSaved', {}), /allowlist/);
	assert.deepEqual(methods, ['GET', 'POST']);
});
