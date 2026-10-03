import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	browserAccounts,
	readCommunityCredentials,
	validateCommunity,
} from '../src/community-config.ts';
import { validateCommunityManifest, assertTerminalCommunityCleanup } from '../src/community-control.ts';
import { CommunityState } from '../src/community-state.ts';
import { Store } from '../src/store.ts';
import { ApiRejection, assertUiOrigin } from '../src/ui-session.ts';
import { protectionSecret } from '../src/protection.ts';
import {
	assertProvisionableRun,
	makeCredentials,
} from '../src/provisioning.ts';

const raw = makeCredentials(
	{ id: 'scripted-test', mode: 'scripted', agent_count: 253 },
	'https://givetogive-staging.vercel.app',
	'isolated-marker',
);
const { credentials } = validateCommunity(raw, {});
const manifest = {
	protocolVersion: 1,
	environment: 'staging',
	origin: raw.origin,
	databaseIdentity: raw.databaseIdentity,
	stripeMode: 'unconfigured',
	paymentsConfigured: false,
	simulationEnabled: true,
	mcpPath: '/mcp',
	runId: raw.runId,
	mode: 'scripted',
	agentCount: 253,
	browserUsers: 3,
	runStatus: 'created',
	members: raw.agents.map(({ id, userId }) => ({ id, userId })),
};

test('community preflight binds the exact server cohort, active run, environment and Stripe test mode', () => {
	assert.doesNotThrow(() => validateCommunityManifest(manifest, credentials));
	for (const patch of [
		{ runId: 'another' },
		{ mode: 'autonomous' },
		{ agentCount: 250 },
		{ browserUsers: 30 },
		{ databaseIdentity: 'production' },
		{ environment: 'production' },
		{ stripeMode: 'live' },
		{ runStatus: 'completed' },
		{ runStatus: 'stopped' },
		{ runStatus: 'cancelled' },
		{ runStatus: undefined },
		{ members: manifest.members.slice(1) },
		{
			members: manifest.members.map((member, index) =>
				index ? member : { ...member, userId: 'someone-else' },
			),
		},
	])
		assert.throws(() =>
			validateCommunityManifest({ ...manifest, ...patch }, credentials),
		);
	assert.throws(() =>
		validateCommunity({ ...raw, mode: 'deterministic' }, {}),
	);
});

test('browser accounts span declared cohorts without fabricating a paid tier', () => {
	const selected = browserAccounts(credentials, 3);
	assert.deepEqual(
		selected.map((member) => member.targetTier),
		['neighbor', 'supporter', 'sustainer'],
	);
	assert.equal(
		new Set(browserAccounts(credentials, 30).map((member) => member.userId))
			.size,
		30,
	);
	assert.equal(credentials.agents.length, 253);
	assert.ok(
		credentials.agents.every((member) => !('paidEntitlement' in member)),
	);
});

test('terminal cleanup attests the entire original hosted cohort without admitting another action', () => {
	for (const runStatus of ['stopped', 'completed', 'cancelled']) {
		const terminal = { ...manifest, runStatus };
		assert.equal(assertTerminalCommunityCleanup(terminal, credentials, 3, 0, 0).runStatus, runStatus);
		assert.throws(() => validateCommunityManifest(terminal, credentials), /cannot restart/);
	}
	for (const runStatus of ['created', 'running', 'paused', 'unknown'])
		assert.throws(() => assertTerminalCommunityCleanup({ ...manifest, runStatus }, credentials, 3, 0, 0));
	const terminal = { ...manifest, runStatus: 'stopped' };
	assert.throws(() => assertTerminalCommunityCleanup(terminal, credentials, 3, 1, 0), /unresolved/);
	assert.throws(() => assertTerminalCommunityCleanup(terminal, credentials, 3, 0, 7), /sync/);
	for (const patch of [{ runId: 'different' }, { databaseIdentity: 'production' }, { browserUsers: 30 }, { members: manifest.members.slice(1) }])
		assert.throws(() => assertTerminalCommunityCleanup({ ...terminal, ...patch }, credentials, 3, 0, 0));
});

test('scripted provisioning supports 280 accounts but legacy/model runs remain bounded', () => {
	const run = {
		id: 'new-run',
		mode: 'scripted',
		environment: 'staging',
		database_identity: 'isolated-marker',
		agent_count: 280,
		status: 'created',
	};
	assert.doesNotThrow(() =>
		assertProvisionableRun(run, raw.databaseIdentity),
	);
	assert.throws(() =>
		assertProvisionableRun(
			{ ...run, agent_count: 281 },
			raw.databaseIdentity,
		),
	);
	assert.throws(() =>
		assertProvisionableRun(
			{ ...run, mode: 'autonomous' },
			raw.databaseIdentity,
		),
	);
});

test('pause, individual controls, rate and 30 browser slots survive restart; stop is irrevocable', () => {
	const path = join(
		mkdtempSync(join(tmpdir(), 'g2g-control-')),
		'control.sqlite',
	);
	let store = new Store(path, 'run');
	const users = new Set(
		Array.from({ length: 40 }, (__value, index) => `user-${index}`),
	);
	const browsers = new Set([...users].slice(0, 30));
	let state = new CommunityState(store, users, browsers, 3);
	assert.equal(state.apply({ id: '1', type: 'pause' }), true);
	state.apply({ id: '2', type: 'pause_agent', agentId: 'user-1' });
	state.apply({ id: '3', type: 'set_concurrency', value: 30 });
	state.apply({ id: '4', type: 'set_rate', value: 0.25 });
	assert.throws(() =>
		state.apply({ id: '5', type: 'set_concurrency', value: 31 }),
	);
	assert.throws(() =>
		state.apply({ id: '6', type: 'pause_agent', agentId: 'unknown' }),
	);
	store.close();
	store = new Store(path, 'run');
	try {
		state = new CommunityState(store, users, browsers, 3);
		assert.equal(state.paused, true);
		assert.equal(state.pausedUsers.has('user-1'), true);
		assert.equal(state.browserConcurrency, 30);
		assert.equal(state.rate, 0.25);
		assert.equal(state.apply({ id: '1', type: 'resume' }), false);
		state.apply({ id: '7', type: 'stop' });
		state.apply({ id: '8', type: 'resume' });
		assert.equal(state.stopping, true);
		assert.equal(
			new CommunityState(store, users, browsers, 3).stopping,
			true,
		);
	} finally {
		store.close();
	}
});

test('loopback normal-auth browser tests require the explicit CI role, database and test origin', () => {
	const env = {
		APP_ENV: 'test',
		DATABASE_URL:
			'postgres://givetogive_ci_20260926@localhost/givetogive_ci_20260926',
	};
	assert.doesNotThrow(() => assertUiOrigin('http://127.0.0.1:3100', env));
	for (const patch of [
		{ APP_ENV: 'production' },
		{ DATABASE_URL: 'postgres://admin@localhost/production' },
		{ PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:9000' },
	])
		assert.throws(() =>
			assertUiOrigin('http://127.0.0.1:3100', { ...env, ...patch }),
		);
	assert.throws(() => assertUiOrigin('https://givetogive.vercel.app', env));
	// Unknown server code strings and malformed private files never become diagnostics.
	assert.equal(
		new ApiRejection(400, 'PRIVATE_TEST_SENTINEL').code,
		'UNKNOWN',
	);
	assert.ok(
		!new ApiRejection(400, 'PRIVATE_TEST_SENTINEL').message.includes(
			'PRIVATE_TEST_SENTINEL',
		),
	);
	const malformed = join(
		mkdtempSync(join(tmpdir(), 'g2g-private-')),
		'private.json',
	);
	writeFileSync(malformed, '{"password":"PRIVATE_TEST_SENTINEL",');
	assert.throws(
		() => readCommunityCredentials(malformed),
		(error) =>
			error instanceof Error &&
			!error.message.includes('PRIVATE_TEST_SENTINEL'),
	);
	const prior = process.env['SIM_PROTECTION_BYPASS_FILE'];
	try {
		process.env['SIM_PROTECTION_BYPASS_FILE'] = malformed;
		assert.throws(
			() => protectionSecret(),
			(error) =>
				error instanceof Error &&
				!error.message.includes('PRIVATE_TEST_SENTINEL'),
		);
	} finally {
		if (prior === undefined)
			delete process.env['SIM_PROTECTION_BYPASS_FILE'];
		else process.env['SIM_PROTECTION_BYPASS_FILE'] = prior;
	}
});
