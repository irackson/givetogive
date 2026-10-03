import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	executeActivity,
	ActivitySelectionChanged,
	freshContributionTarget,
	parseActivity,
	type EntityRef,
} from '../src/activity.ts';
import type { UiApi } from '../src/ui-session.ts';
import { ActivityStore } from '../src/activity-store.ts';
import { validateCommunity } from '../src/community-config.ts';
import { Semaphore } from '../src/semaphore.ts';

test('only an authoritative pre-admission browser target change waits; admitted or generic failures remain unresolved', async () => {
	const ask = {
		id: 8,
		type: 'task',
		createdById: 'owner',
		status: 'not_started',
		goalAmount: 1,
		contributedAmount: 0,
	};
	const api: UiApi = {
		userId: 'helper',
		query: async () => [ask],
		mutate: async () => {
			throw new Error('No mutation expected.');
		},
	};
	const [line] = parseActivity(
		JSON.stringify({
			id: 'help',
			user: 'helper',
			action: 'contribute',
			ask: { id: 8 },
			amount: 1,
		}),
	);
	api.query = async () => ask;
	let admissions = 0;
	const hooks = {
		beforeMutation() {
			admissions++;
		},
	};
	assert.deepEqual(
		await executeActivity(api, line!, new Map(), {
			...hooks,
			browserAction: async () => {
				throw new ActivitySelectionChanged();
			},
		}),
		{ outcome: 'waiting' },
	);
	assert.equal(admissions, 0);
	await assert.rejects(
		executeActivity(api, line!, new Map(), {
			...hooks,
			browserAction: async (__line, __ask, admit) => {
				admit!('ask.createContribution');
				throw new ActivitySelectionChanged();
			},
		}),
		ActivitySelectionChanged,
	);
	assert.equal(admissions, 1);
	await assert.rejects(
		executeActivity(api, line!, new Map(), {
			...hooks,
			browserAction: async () => {
				throw new Error('Selector failed');
			},
		}),
		/Selector failed/,
	);
	for (const changed of [
		{ ...ask, contributedAmount: 1 },
		{ ...ask, createdById: 'helper' },
		{ ...ask, paymentEnabled: true },
		{ ...ask, type: 'money' },
		{ ...ask, status: 'complete' },
	]) {
		api.query = async () => changed;
		await assert.rejects(
			freshContributionTarget(api, 8, 1),
			ActivitySelectionChanged,
		);
	}
	api.query = async () => ({ wrong: true });
	await assert.rejects(
		freshContributionTarget(api, 8, 1),
		(error) => !(error instanceof ActivitySelectionChanged),
	);
});

test('recurring owner completion discovers a browser pledge without static references', async () => {
	const ask = {
		id: 8,
		type: 'task',
		createdById: 'owner',
		status: 'in_progress',
		goalAmount: 2,
		contributedAmount: 1,
	};
	const contributions: {
		id: number;
		contributorId: string;
		status: string;
	}[] = [];
	const mutations: unknown[] = [];
	const observed: unknown[] = [];
	const api: UiApi = {
		userId: 'owner',
		query: async (procedure, input) => {
			observed.push({ procedure, input });
			return procedure === 'ask.getAsks' ?
					[ask]
				:	{ ...ask, contributions };
		},
		mutate: async (procedure, input) => {
			mutations.push({ procedure, input });
		},
	};
	const [line] = parseActivity(
		JSON.stringify({
			id: 'deliver',
			user: 'alice',
			action: 'set_contribution_status',
			everySeconds: 30,
			status: 'completed',
			contribution: {
				match: { as: 'owner', ask: { match: { type: 'task' } } },
			},
		}),
	);
	let intents = 0;
	const hooks = {
		beforeMutation() {
			intents++;
		},
	};
	assert.equal(
		(await executeActivity(api, line!, new Map(), hooks)).outcome,
		'waiting',
	);
	assert.equal(intents, 0);
	contributions.push({
		id: 31,
		contributorId: 'browser-ben',
		status: 'pledged',
	});
	const result = await executeActivity(api, line!, new Map(), hooks);
	assert.deepEqual(result.entity, { kind: 'contribution', id: 31, askId: 8 });
	assert.equal(intents, 1);
	assert.deepEqual(mutations, [
		{
			procedure: 'ask.updateContributionStatus',
			input: { contributionId: 31, status: 'completed' },
		},
	]);
	assert.deepEqual(observed[0], {
		procedure: 'ask.getAsks',
		input: { type: 'task', filter: { createdById: 'owner' } },
	});
	contributions[0]!.status = 'completed';
	assert.equal(
		(await executeActivity(api, line!, new Map(), hooks)).outcome,
		'waiting',
	);
	assert.equal(intents, 1);
});

test('recurring cancellation selects only the actor own current nonfinancial pledge', async () => {
	const ask = {
		id: 8,
		type: 'task',
		createdById: 'owner',
		status: 'in_progress',
		goalAmount: 5,
		contributedAmount: 3,
	};
	let type = 'task';
	let paymentEnabled = false;
	const contributions = [
		{ id: 1, contributorId: 'other', status: 'pledged' },
		{ id: 2, contributorId: 'actor', status: 'completed' },
		{ id: 3, contributorId: 'actor', status: 'pledged' },
	];
	let last: unknown;
	const api: UiApi = {
		userId: 'actor',
		query: async (procedure) =>
			procedure === 'ask.getAsks' ?
				[ask]
			:	{ ...ask, type, paymentEnabled, contributions },
		mutate: async (__procedure, input) => {
			last = input;
		},
	};
	const [line] = parseActivity(
		JSON.stringify({
			id: 'cancel',
			user: 'ben',
			action: 'set_contribution_status',
			status: 'cancelled',
			contribution: { match: { as: 'contributor', ask: { match: {} } } },
		}),
	);
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.entity?.id,
		3,
	);
	assert.deepEqual(last, { contributionId: 3, status: 'cancelled' });
	type = 'money';
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
	type = 'task';
	paymentEnabled = true;
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
	assert.throws(() =>
		parseActivity(
			JSON.stringify({
				...line,
				contribution: { match: { as: 'owner', ask: { match: {} } } },
			}),
		),
	);
});

test('dynamic selection rechecks ownership and bounds its observation window', async () => {
	const ask = {
		id: 8,
		type: 'task',
		createdById: 'owner',
		status: 'in_progress',
		goalAmount: 5,
		contributedAmount: 1,
	};
	let reads = 0;
	const api: UiApi = {
		userId: 'owner',
		query: async (procedure) => {
			if (procedure === 'ask.getAsks')
				return Array.from({ length: 100 }, () => ask);
			reads++;
			return {
				...ask,
				createdById: 'changed-owner',
				contributions: [
					{ id: 2, contributorId: 'other', status: 'pledged' },
				],
			};
		},
		mutate: async () => {
			throw new Error('Must not mutate stale authority.');
		},
	};
	const [line] = parseActivity(
		JSON.stringify({
			id: 'complete',
			user: 'ben',
			action: 'set_contribution_status',
			status: 'completed',
			contribution: { match: { as: 'owner', ask: { match: {} } } },
		}),
	);
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
	assert.equal(reads, 20);
});

test('adaptive script discovers a browser-created Ask on the next observation', async () => {
	const asks: unknown[] = [];
	const mutations: unknown[] = [];
	const api: UiApi = {
		userId: 'helper',
		query: async () => asks,
		mutate: async (procedure, input) => {
			mutations.push({ procedure, input });
			return { contributionId: 27 };
		},
	};
	const [line] = parseActivity(
		'{"id":"help","user":"ben","action":"contribute","ask":{"match":{"type":"task"}},"amount":1,"everySeconds":30}',
	);
	let admitted = 0;
	const hooks = {
		beforeMutation: () => {
			admitted++;
		},
	};
	assert.equal(
		(await executeActivity(api, line!, new Map(), hooks)).outcome,
		'waiting',
	);
	asks.push({
		id: 42,
		type: 'task',
		createdById: 'browser-alice',
		status: 'not_started',
		goalAmount: 2,
		contributedAmount: 0,
	});
	assert.deepEqual(await executeActivity(api, line!, new Map(), hooks), {
		outcome: 'success',
		entity: { kind: 'contribution', id: 27, askId: 42 },
		procedure: 'ask.createContribution',
	});
	assert.equal(admitted, 1);
	assert.deepEqual(mutations, [
		{
			procedure: 'ask.createContribution',
			input: { askId: 42, amount: 1, note: undefined },
		},
	]);
});
test('a stale target is rechecked and completion/self/money targets are not selected', async () => {
	let ask = {
		id: 1,
		type: 'task',
		createdById: 'alice',
		status: 'in_progress',
		goalAmount: 1,
		contributedAmount: 1,
	};
	const api: UiApi = {
		userId: 'alice',
		query: async () => ask,
		mutate: async () => {
			throw new Error('Must not mutate');
		},
	};
	const [line] = parseActivity(
		'{"id":"help","user":"alice","action":"contribute","ask":{"id":1},"amount":1}',
	);
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
	ask = { ...ask, createdById: 'other', status: 'complete' };
	assert.equal(
		(await executeActivity(api, line!, new Map(), { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
});
test('API race rejection is surfaced rather than invented success', async () => {
	const api: UiApi = {
		userId: 'helper',
		query: async () => ({
			id: 1,
			type: 'task',
			createdById: 'owner',
			status: 'not_started',
			goalAmount: 1,
			contributedAmount: 0,
		}),
		mutate: async () => {
			throw new Error('Another user fulfilled this Ask');
		},
	};
	const [line] = parseActivity(
		'{"id":"race","user":"ben","action":"contribute","ask":{"id":1},"amount":1}',
	);
	await assert.rejects(
		executeActivity(api, line!, new Map(), { beforeMutation() {} }),
		/Another user/,
	);
});
test('exact references connect different users and wait for dependencies', async () => {
	const refs = new Map<string, EntityRef>();
	const lines = parseActivity(
		[
			{
				id: 'post',
				user: 'alice',
				action: 'create_ask',
				ref: 'moving',
				input: {
					title: 'Moving help',
					description: 'Help move two boxes please.',
					type: 'task',
					goalAmount: 2,
				},
			},
			{
				id: 'offer',
				user: 'ben',
				action: 'contribute',
				ask: { ref: 'moving' },
				amount: 1,
			},
		]
			.map((line) => JSON.stringify(line))
			.join('\n'),
	);
	const api: UiApi = {
		userId: 'ben',
		query: async () => ({
			id: 7,
			type: 'task',
			createdById: 'alice',
			status: 'not_started',
			goalAmount: 2,
			contributedAmount: 0,
		}),
		mutate: async (procedure) =>
			procedure === 'ask.createAsk' ?
				{ newlyCreatedAskId: 7 }
			:	{ contributionId: 12 },
	};
	assert.equal(
		(await executeActivity(api, lines[1]!, refs, { beforeMutation() {} }))
			.outcome,
		'waiting',
	);
	refs.set(
		'moving',
		(await executeActivity(api, lines[0]!, refs, { beforeMutation() {} }))
			.entity!,
	);
	assert.equal(
		(await executeActivity(api, lines[1]!, refs, { beforeMutation() {} }))
			.entity?.id,
		12,
	);
});
test('scenario rejects identity overrides, unknown routes and reference overwrites', () => {
	for (const value of [
		{ id: 'x', user: 'ben', action: 'admin_delete', userId: 'owner' },
		{
			id: 'x',
			user: 'ben',
			action: 'contribute',
			ask: { id: 1 },
			amount: 1,
			token: 'secret',
		},
		{
			id: 'x',
			user: 'ben',
			action: 'create_ask',
			everySeconds: 30,
			ref: 'reused',
			input: {
				title: 'Help',
				description: 'Please help me move.',
				type: 'task',
				goalAmount: 1,
			},
		},
	])
		assert.throws(() => parseActivity(JSON.stringify(value)));
});
test('pending intent and IDs survive restart; a second controller cannot use the same account', () => {
	const path = join(
		mkdtempSync(join(tmpdir(), 'g2g-activity-')),
		'activity.sqlite',
	);
	const first = new ActivityStore(path, 'run', 'hash');
	const second = new ActivityStore(path, 'run', 'hash');
	try {
		first.claim('alice', 'browser');
		assert.throws(() => second.claim('alice', 'script'), /live controller/);
		first.intent('post', 0, 'ask.createAsk');
		assert.throws(() => first.intent('post', 0, 'ask.createAsk'));
		first.finish(
			'offer',
			0,
			'success',
			{ kind: 'contribution', id: 7 },
			'offer-id',
		);
		assert.equal(second.state('post', 0), 'pending');
		assert.equal(first.journalId, second.journalId);
		assert.equal(second.pendingCount(), 1);
		assert.notEqual(first.owner, second.owner);
		assert.deepEqual(second.refs().get('offer-id'), {
			kind: 'contribution',
			id: 7,
		});
		assert.throws(() => first.finish('offer', 0, 'rejected'), /terminal/);
		assert.deepEqual(second.counts(['offer', 'post']), {
			cycles: 1,
			actions: 1,
			failures: 0,
		});
		assert.throws(
			() => new ActivityStore(path, 'run', 'different-hash'),
			/Scenario changed/,
		);
	} finally {
		second.close();
		first.close();
	}
});
test('dead controller cleanup is atomic, cohort scoped and preserves immutable action history', () => {
	const store = new ActivityStore(join(mkdtempSync(join(tmpdir(), 'g2g-dead-claims-')), 'activity.sqlite'), 'run', 'hash');
	const stopped = () => { throw Object.assign(new Error('Absent process'), { code: 'ESRCH' }); };
	try {
		store.db.prepare('INSERT INTO account_control VALUES (?,?,?,?)').run('alice', 'old-owner', 900001, 'browser');
		store.db.prepare('INSERT INTO account_control VALUES (?,?,?,?)').run('bob', 'old-owner', 900002, 'script');
		store.finish('read', 0, 'success', { kind: 'ask', id: 7 }, 'existing');
		const before = JSON.stringify(store.db.prepare('SELECT * FROM steps').all());
		const journalId = store.journalId;
		const cohort = new Set(['alice', 'bob']);
		assert.equal(store.reviewAbandonedClaims(cohort, stopped), 2);
		assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM account_control').get()!.n, 2);
		assert.equal(store.releaseAbandonedClaims(cohort, stopped), 2);
		assert.equal(store.releaseAbandonedClaims(cohort, stopped), 0);
		assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM steps').all()), before);
		assert.equal(store.journalId, journalId);
		assert.deepEqual(store.refs().get('existing'), { kind: 'ask', id: 7 });
	} finally { store.close(); }
});

test('dead controller cleanup refuses pending intents, foreign accounts and live or ambiguous processes', () => {
	const store = new ActivityStore(join(mkdtempSync(join(tmpdir(), 'g2g-live-claims-')), 'activity.sqlite'), 'run', 'hash');
	const stopped = () => { throw Object.assign(new Error('Absent process'), { code: 'ESRCH' }); };
	try {
		store.db.prepare('INSERT INTO account_control VALUES (?,?,?,?)').run('alice', 'old-owner', 900001, 'browser');
		store.db.prepare('INSERT INTO account_control VALUES (?,?,?,?)').run('bob', 'old-owner', 900002, 'script');
		const cohort = new Set(['alice', 'bob']);
		for (const probe of [() => {}, () => { throw Object.assign(new Error('Uncertain'), { code: 'EPERM' }); }, () => { throw new Error('Uncertain'); }]) {
			assert.throws(() => store.releaseAbandonedClaims(cohort, probe), /live or.*ambiguous/);
			assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM account_control').get()!.n, 2);
		}
		assert.throws(() => store.releaseAbandonedClaims(new Set(['alice']), stopped), /cohort/);
		store.intent('post', 0, 'ask.createAsk');
		assert.throws(() => store.releaseAbandonedClaims(cohort, stopped), /Unresolved mutation/);
		assert.equal(store.state('post', 0), 'pending');
		assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM account_control').get()!.n, 2);
	} finally { store.close(); }
});

test('three-browser default and 30-browser ceiling retain bounded slots', async () => {
	const raw = {
		runId: 'run',
		mode: 'scripted',
		runnerToken: 'synthetic-controller-fixture',
		origin: 'https://givetogive-staging.vercel.app',
		databaseIdentity: 'isolated',
		agents: Array.from({ length: 280 }, (__value, i) => ({
			id: `user-${i}`,
			userId: `id-${i}`,
			email: `${i}@example.invalid`,
			password: 'synthetic-fixture',
		})),
	};
	assert.equal(validateCommunity(raw, {}).settings.browserUsers, 3);
	assert.equal(
		validateCommunity(raw, { browserUsers: 30, browserConcurrency: 30 })
			.settings.browserConcurrency,
		30,
	);
	assert.throws(() => validateCommunity(raw, { browserUsers: 31 }));
	assert.throws(() =>
		validateCommunity(raw, { browserUsers: 3, browserConcurrency: 30 }),
	);
	const pool = new Semaphore(3, 30);
	let active = 0,
		peak = 0;
	await Promise.all(
		Array.from({ length: 30 }, () =>
			pool.run(async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active--;
			}),
		),
	);
	assert.equal(peak, 3);
	pool.resize(30);
	assert.throws(() => pool.resize(31));
});
