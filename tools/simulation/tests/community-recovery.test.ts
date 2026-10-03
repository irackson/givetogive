import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeCredentials } from '../src/provisioning.ts';
import { validateCommunity } from '../src/community-config.ts';
import { assertCommunityCheckpoint, reviewedCheckpointStop } from '../src/community-recovery.ts';

const raw = makeCredentials({ id: 'recovery-test', mode: 'scripted', agent_count: 253 }, 'https://givetogive-staging.vercel.app', 'isolated-marker');
const { credentials } = validateCommunity(raw, {});
const manifest = {
	protocolVersion: 1, environment: 'staging', origin: raw.origin, databaseIdentity: raw.databaseIdentity,
	stripeMode: 'unconfigured', paymentsConfigured: false, simulationEnabled: true, mcpPath: '/mcp',
	runId: raw.runId, mode: 'scripted', agentCount: 253, browserUsers: 3, runStatus: 'paused',
	members: raw.agents.map(({ id, userId }) => ({ id, userId })),
};
const owner = 'c5d1e0ea-361f-4d4b-8b07-a839bfcd0ea2';
const now = Date.parse('2026-10-03T18:00:00Z');
const review = {
	runId: raw.runId, priorControllerId: owner, recoveredControllerId: owner, status: 'paused',
	controllerId: null, online: false, stopCommandId: '14', observedAt: new Date(now - 1000).toISOString(),
};

test('control-only checkpoint requires exact paused cohort and current reviewed admin recovery', () => {
	assert.equal(assertCommunityCheckpoint(manifest, credentials, 3, review, owner, 0, 0, now).stopCommandId, '14');
	for (const patch of [{ runStatus: 'running' }, { runStatus: 'stopped' }, { runStatus: 'completed' }, { runId: 'foreign' }, { databaseIdentity: 'production' }, { members: manifest.members.slice(1) }])
		assert.throws(() => assertCommunityCheckpoint({ ...manifest, ...patch }, credentials, 3, review, owner, 0, 0, now));
	for (const patch of [
		{ runId: 'foreign' }, { recoveredControllerId: '56972458-d119-4cdb-94b3-98547ed44129' },
		{ controllerId: owner }, { online: true }, { observedAt: new Date(now - 120001).toISOString() },
		{ observedAt: new Date(now + 1).toISOString() }, { status: 'running' }, { stopCommandId: 'arbitrary' },
	]) assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, { ...review, ...patch }, owner, 0, 0, now));
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, review, undefined, 0, 0, now));
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, review, owner, 1, 0, now), /unresolved/);
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, review, owner, 0, 7, now), /sync/);
});

test('checkpoint applies only exact reviewed queued stop, never resume or member work', () => {
	const resume = { id: '13', type: 'resume' };
	const stop = { id: '14', type: 'stop' };
	assert.deepEqual(reviewedCheckpointStop({ cursor: '14', commands: [resume, stop] }, '14'), stop);
	for (const commands of [[], [resume], [{ id: '14', type: 'resume' }], [{ ...stop, id: '15' }]])
		assert.throws(() => reviewedCheckpointStop({ cursor: '15', commands }, '14'), /reviewed queued stop/);
});

test('checkpoint CLI branch contains no member authentication, execution or browser work', () => {
	// Architectural regression: this branch is control-plane only and shares drained shutdown.
	const source = readFileSync(new URL('../src/community-cli.ts', import.meta.url), 'utf8');
	const branch = source.split("if (command === 'checkpoint') {")[1]?.split("if (command === 'preflight' || command === 'run')")[0];
	assert.ok(branch);
	assert.ok(!/UiSession|executeActivity|userLoop|controllerLoop|browsers\.(?:action|opening)/.test(branch));
	assert.ok(branch.includes('reviewedCheckpointStop'));
	assert.ok(branch.includes('reviewAbandonedClaims'));
	assert.ok(source.includes("['run', 'checkpoint'].includes(command) && runStarted"));
});
