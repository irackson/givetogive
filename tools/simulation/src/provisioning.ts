import { createHash, randomBytes } from 'node:crypto';
import { credentialsSchema, type Credentials } from './protocol.ts';
import { assertStagingOrigin } from './config.ts';

export const baselineRunId = 'sim_20260926_baseline';
export function parseProvisionArgs(args: string[]) {
  if ((args.length !== 2 && !(args.length === 3 && args[2] === '--clock-cohort')) || args[0] !== '--run-id' || !/^[a-zA-Z0-9_-]{1,64}$/.test(args[1] ?? ''))
    throw new Error('Usage: node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id <existing-run-id> [--clock-cohort]');
  return args[1]!;
}
export function assertClockProvisioning(run: { id: string; agent_count: number; mode: string }, enabled: boolean) {
  if (enabled && (run.id === baselineRunId || run.agent_count < 1 || run.agent_count > 3 || run.mode !== 'deterministic')) throw new Error('Explicit clock scope is restricted to a fresh deterministic cohort of one to three members, never the baseline.');
}
export function runNamespace(runId: string) { return createHash('sha256').update(runId).digest('hex').slice(0, 16); }
export function fixtureIds(runId: string, index: number) {
  const number = String(index + 1).padStart(3, '0');
  const key = runNamespace(runId);
  return runId === baselineRunId
    ? { id: `bot_${number}`, userId: `synthetic-member-${number}`, email: `neighbor-${number}@givetogive.invalid`, tokenId: `token-bot_${number}` }
    : { id: `bot_${key}_${number}`, userId: `synthetic-${key}-${number}`, email: `neighbor-${key}-${number}@givetogive.invalid`, tokenId: `agent-${key}-${number}` };
}
export function targetTier(index: number, population: number): 'neighbor' | 'supporter' | 'sustainer' {
  return index < Math.round(population * .6) ? 'neighbor' : index < Math.round(population * .85) ? 'supporter' : 'sustainer';
}
export function credentialsPath(runId: string) {
  return runId === baselineRunId ? 'tools/simulation/.state/staging-credentials.json' : `tools/simulation/.state/runs/${runId}/credentials.json`;
}
export function assertProvisionableRun(run: { id: string; mode: string; environment: string; database_identity: string; agent_count: number; status: string }, databaseIdentity: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(run.id) || !['autonomous', 'deterministic', 'scripted'].includes(run.mode) || run.environment !== 'staging' || run.database_identity !== databaseIdentity || !Number.isInteger(run.agent_count) || run.agent_count < 1 || run.agent_count > (run.mode === 'scripted' ? 280 : 100))
    throw new Error('Run configuration does not match the isolated staging environment.');
  if (['completed', 'stopped', 'cancelled'].includes(run.status)) throw new Error('Finished runs cannot be provisioned or restarted. Create a new run.');
}
export function makeCredentials(run: { id: string; mode: 'autonomous' | 'deterministic' | 'scripted'; agent_count: number }, origin: string, databaseIdentity: string): Credentials {
  assertStagingOrigin(origin);
  const random = () => randomBytes(32).toString('hex');
  return credentialsSchema.parse({ origin, databaseIdentity, runId: run.id, mode: run.mode, runnerToken: random(), agents: Array.from({ length: run.agent_count }, (_, index) => ({ ...fixtureIds(run.id, index), targetTier: targetTier(index, run.agent_count), token: random(), password: random() })) });
}
export function validateSavedCredentials(raw: unknown, expected: { runId: string; mode: string; origin: string; databaseIdentity: string; population: number }) {
  const value = credentialsSchema.parse(raw);
  assertStagingOrigin(value.origin);
  if (value.runId !== expected.runId || value.databaseIdentity !== expected.databaseIdentity || new URL(value.origin).origin !== new URL(expected.origin).origin || value.agents.length !== expected.population || (value.mode && value.mode !== expected.mode)) throw new Error('Existing credential file belongs to another environment or run configuration.');
  for (const [index, agent] of value.agents.entries()) {
    const ids = fixtureIds(expected.runId, index);
    if (agent.id !== ids.id || agent.userId !== ids.userId || agent.email !== ids.email || !agent.password) throw new Error('Saved synthetic account identity is not the expected run-scoped fixture.');
  }
  return value;
}
