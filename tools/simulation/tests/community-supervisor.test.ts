import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supervisionPaths, supervisionEnvironment, safeCommunityOutput } from '../src/community-supervisor.ts';

const runId = '2ba5c5e4-f339-4b19-88a2-013c7ed447f1';
const env = { SIM_CREDENTIALS: `.state/runs/${runId}/credentials.json`, SIM_STATE_DIRECTORY: '.state/community-new-run', SIM_PROTECTION_BYPASS_FILE: '.state/protection.json' };

test('supervisor paths bind exactly one run, private program/journals and fresh log', () => {
	const paths = supervisionPaths(env);
	assert.equal(paths.runId, runId);
	assert.ok(paths.log.endsWith('supervision.jsonl'));
	assert.doesNotThrow(() => supervisionPaths({ ...env, SIM_SUPERVISION_LOG: `.state/runs/${runId}/supervision-a4252f76-abfd-4624-a0b6-c73f5410ed44.jsonl` }));
	for (const patch of [
		{ SIM_CREDENTIALS: '.env.local' }, { SIM_CREDENTIALS: `.state/runs/${runId}/../credentials.json` },
		{ SIM_STATE_DIRECTORY: '.state/../production' }, { SIM_STATE_DIRECTORY: '.state/community-x/other' },
		{ SIM_ACTIVITY_FILE: '.state/runs/foreign/activity.jsonl' }, { SIM_SUPERVISION_LOG: '../output.jsonl' },
		{ SIM_SUPERVISION_LOG: '.state/runs/foreign/supervision.jsonl' }, { SIM_PROTECTION_BYPASS_FILE: '.env.staging.local' },
	]) assert.throws(() => supervisionPaths({ ...env, ...patch }));
});

test('supervisor child environment excludes app, database, provider and runtime injection secrets', () => {
	const child = supervisionEnvironment({ ...env, PATH: 'runtime-path', SIM_BROWSER_USERS: '3', STRIPE_SECRET_KEY: 'SECRET_SENTINEL',
		DATABASE_URL: 'DATABASE_SENTINEL', NEXTAUTH_SECRET: 'AUTH_SENTINEL', NODE_OPTIONS: '--inspect', SIM_MODEL_URL: 'https://unapproved.example' });
	assert.equal(child['PATH'], 'runtime-path');
	assert.equal(child['SIM_BROWSER_USERS'], '3');
	assert.ok(!JSON.stringify(child).includes('SENTINEL'));
	assert.ok(!('NODE_OPTIONS' in child));
	assert.ok(!('SIM_MODEL_URL' in child));
});

test('supervisor serializes only exact member/line aliases and fixed diagnostic categories', () => {
	const users = new Set(['member-a']), lines = new Set(['browse-a']);
	assert.deepEqual(safeCommunityOutput({ user: 'member-a', line: 'browse-a', driver: 'browser', outcome: 'success', password: 'SECRET_SENTINEL',
		message: 'PRIVATE_SENTINEL', entity: { password: 'SECRET_SENTINEL' }, token: 'SECRET_SENTINEL' }, users, lines, runId),
		{ user: 'member-a', line: 'browse-a', driver: 'browser', outcome: 'success' });
	assert.equal(safeCommunityOutput({ user: 'SECRET_SENTINEL', line: 'PRIVATE_SENTINEL', reason: 'SECRET_SENTINEL', message: 'PRIVATE_SENTINEL' }, users, lines, runId), undefined);
	assert.equal(safeCommunityOutput('PRIVATE_SENTINEL', users, lines, runId), undefined);
});
