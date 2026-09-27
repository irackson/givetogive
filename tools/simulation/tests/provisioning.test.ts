import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProvisionableRun, baselineRunId, credentialsPath, fixtureIds, makeCredentials, parseProvisionArgs, targetTier, validateSavedCredentials } from '../src/provisioning.ts';

test('provisioning requires an explicit safe existing-run ID and isolates every identity', () => {
  assert.equal(parseProvisionArgs(['--run-id', 'run-123']), 'run-123');
  for (const args of [[], ['--run-id', '../escape'], ['--run-id', 'valid', '--force']]) assert.throws(() => parseProvisionArgs(args));
  assert.equal(credentialsPath(baselineRunId), 'tools/simulation/.state/staging-credentials.json');
  assert.equal(credentialsPath('run-123'), 'tools/simulation/.state/runs/run-123/credentials.json');
  const identities = ['one', 'two'].flatMap(run => Array.from({ length: 100 }, (_, i) => fixtureIds(run, i)));
  for (const field of ['id', 'userId', 'email', 'tokenId'] as const) assert.equal(new Set(identities.map(row => row[field])).size, 200);
  assert.ok(identities.every(row => row.id.length <= 64 && row.tokenId.length <= 64));
});
test('provisioning refuses production, terminal runs, unsupported modes, and mismatched saved credentials', () => {
  const run = { id: 'run-123', mode: 'deterministic' as const, environment: 'staging', database_identity: 'stage-identity', agent_count: 10, status: 'created' };
  assert.doesNotThrow(() => assertProvisionableRun(run, 'stage-identity'));
  for (const patch of [{ status: 'completed' }, { status: 'stopped' }, { status: 'cancelled' }, { environment: 'production' }, { mode: 'unknown' }, { agent_count: 101 }, { database_identity: 'other' }]) assert.throws(() => assertProvisionableRun({ ...run, ...patch }, 'stage-identity'));
  const origin = 'https://givetogive-staging.vercel.app';
  const credentials = makeCredentials(run, origin, 'stage-identity');
  assert.equal(credentials.mode, 'deterministic');
  assert.equal(credentials.agents.length, 10);
  assert.equal(new Set(credentials.agents.map(agent => agent.token)).size, 10);
  const expected = { runId: run.id, mode: run.mode, origin, databaseIdentity: 'stage-identity', population: 10 };
  assert.deepEqual(validateSavedCredentials(credentials, expected), credentials);
  assert.throws(() => validateSavedCredentials(credentials, { ...expected, runId: 'different' }));
  assert.throws(() => validateSavedCredentials(credentials, { ...expected, population: 100 }));
  assert.throws(() => makeCredentials(run, 'https://givetogive.vercel.app', 'stage-identity'));
});
test('all ramp cohorts include three target tiers without granting entitlements', () => {
  for (const count of [10, 25, 100]) assert.equal(new Set(Array.from({ length: count }, (_, i) => targetTier(i, count))).size, 3);
  const hundred = Array.from({ length: 100 }, (_, i) => targetTier(i, 100));
  assert.equal(hundred.filter(tier => tier === 'neighbor').length, 60);
  assert.equal(hundred.filter(tier => tier === 'supporter').length, 25);
  assert.equal(hundred.filter(tier => tier === 'sustainer').length, 15);
});
