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
const releaseBinding = {
	controllerJournalId: '3f9cf0df-7dab-4b51-92f2-08c6402177c2',
	programDigest: 'a'.repeat(64),
};
const { recoveredControllerId: __recoveredControllerId, ...commonReview } = review;
const acknowledgedReview = {
	...commonReview, releaseKind: 'acknowledged-release', lastControllerId: owner, ...releaseBinding,
};

test('control-only checkpoint requires exact paused cohort and current reviewed admin recovery', () => {
	assert.deepEqual(assertCommunityCheckpoint(manifest, credentials, 3, review, owner, 0, 0, now), review);
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

test('acknowledged release requires independent retained journal binding without inventing recovery', () => {
	assert.deepEqual(assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, owner, 0, 0, now, releaseBinding), acknowledgedReview);
	assert.equal('recoveredControllerId' in acknowledgedReview, false);
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, owner, 0, 0, now), /journal binding/);
	for (const binding of [
		null, {}, { ...releaseBinding, extra: true },
		{ ...releaseBinding, controllerJournalId: 'not-a-journal' },
		{ ...releaseBinding, controllerJournalId: '56972458-d119-4cdb-94b3-98547ed44129' },
		{ ...releaseBinding, programDigest: 'b'.repeat(64) },
		{ ...releaseBinding, programDigest: 'A'.repeat(64) },
	]) assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, owner, 0, 0, now, binding), /journal binding/);
});

test('acknowledged release fails closed on owner, release, freshness, cohort and pending ambiguity', () => {
	for (const patch of [
		{ runId: 'foreign' }, { priorControllerId: '56972458-d119-4cdb-94b3-98547ed44129' },
		{ lastControllerId: '56972458-d119-4cdb-94b3-98547ed44129' }, { lastControllerId: null },
		{ releaseKind: 'recovered' }, { controllerId: owner }, { online: true },
		{ controllerJournalId: '56972458-d119-4cdb-94b3-98547ed44129' },
		{ programDigest: 'b'.repeat(64) }, { programDigest: 'bad' },
		{ status: 'running' }, { stopCommandId: 'arbitrary' }, { extra: true },
		{ observedAt: new Date(now - 120001).toISOString() },
		{ observedAt: new Date(now + 1).toISOString() },
	]) assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, { ...acknowledgedReview, ...patch }, owner, 0, 0, now, releaseBinding));
	for (const patch of [
		{ runStatus: 'running' }, { runStatus: 'stopped' }, { runStatus: 'completed' },
		{ runId: 'foreign' }, { databaseIdentity: 'production' }, { members: manifest.members.slice(1) },
	]) assert.throws(() => assertCommunityCheckpoint({ ...manifest, ...patch }, credentials, 3, acknowledgedReview, owner, 0, 0, now, releaseBinding));
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, undefined, 0, 0, now, releaseBinding));
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, owner, 1, 0, now, releaseBinding), /unresolved/);
	assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, acknowledgedReview, owner, 0, 7, now, releaseBinding), /sync/);
	assert.equal(assertCommunityCheckpoint(manifest, credentials, 3, { ...acknowledgedReview, observedAt: new Date(now - 120000).toISOString() }, owner, 0, 0, now, releaseBinding).stopCommandId, '14');
});

test('strict release union neither combines variants nor reinterprets old receipts', () => {
	for (const mixed of [
		{ ...review, releaseKind: 'acknowledged-release', lastControllerId: owner, ...releaseBinding },
		{ ...acknowledgedReview, recoveredControllerId: owner },
		{ ...review, ...releaseBinding },
		commonReview,
	]) assert.throws(() => assertCommunityCheckpoint(manifest, credentials, 3, mixed, owner, 0, 0, now, releaseBinding));
	assert.deepEqual(assertCommunityCheckpoint(manifest, credentials, 3, review, owner, 0, 0, now, releaseBinding), review);
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
	// The review is external evidence; compare it against the runner's own retained journals.
	assert.ok(branch.includes('Date.now(), { controllerJournalId: store.journalId, programDigest: controllerDigest }'));
	assert.ok(source.includes("['run', 'checkpoint'].includes(command) && runStarted"));
});
