import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateSandboxPlan } from '../src/sandbox-plan.ts';
import { assertClockCredentials, clockBindingOperationId, parseClockCommand } from '../src/clock-cohort.ts';
import { assertClockProvisioning, parseProvisionArgs } from '../src/provisioning.ts';
import { allowedTools, decisionSchema, type Credentials } from '../src/protocol.ts';
import { modelSafePaymentResult } from '../src/transport.ts';
const credentials: Credentials = { runId: 'tiny', mode: 'deterministic', clockControl: true, origin: 'https://givetogive-staging.vercel.app', databaseIdentity: 'isolated-db', runnerToken: 'r'.repeat(32), agents: [{ id: 'one', userId: 'synthetic-one', token: 't'.repeat(32), email: 'one@givetogive.invalid' }] };
const plan = () => ({ runId: 'tiny', runBudgetCents: 1000, actorBudgetCents: 1000, steps: [{ operationId: randomUUID(), agentId: 'one', scenario: 'success', maximumAmountCents: 500, checkout: { kind: 'ask', askId: 1, grossAmount: 500 } }] });

test('sandbox plans reject arbitrary identities, raw cards/URLs, duplicate operation IDs and upfront overspending', () => {
  validateSandboxPlan(plan(), credentials);
  const base = plan();
  for (const patch of [{ runId: 'other' }, { runBudgetCents: 100 }, { actorBudgetCents: 100 }, { url: 'https://evil.example' }, { card: 'never' }, { steps: [base.steps[0], base.steps[0]] }]) assert.throws(() => validateSandboxPlan({ ...base, ...patch }, credentials));
  for (const patch of [{ agentId: 'victim' }, { scenario: 'custom' }, { maximumAmountCents: 499 }, { checkout: { kind: 'supporter', grossAmount: 500 } }]) assert.throws(() => validateSandboxPlan({ ...base, steps: [{ ...base.steps[0], ...patch }] }, credentials));
});
test('clock opt-in cannot elevate baseline/large/autonomous cohorts or existing normal runner credentials', () => {
  assert.equal(parseProvisionArgs(['--run-id', 'tiny', '--clock-cohort']), 'tiny');
  assertClockProvisioning({ id: 'tiny', agent_count: 3, mode: 'deterministic' }, true);
  for (const run of [{ id: 'sim_20260926_baseline', agent_count: 3, mode: 'deterministic' }, { id: 'tiny', agent_count: 4, mode: 'deterministic' }, { id: 'tiny', agent_count: 3, mode: 'autonomous' }]) assert.throws(() => assertClockProvisioning(run, true));
  assertClockCredentials(credentials);
  assert.throws(() => assertClockCredentials({ ...credentials, clockControl: false }));
  assert.throws(() => assertClockCredentials({ ...credentials, mode: 'autonomous' }));
  assert.equal(clockBindingOperationId('tiny', 'one'), clockBindingOperationId('tiny', 'one'));
  assert.notEqual(clockBindingOperationId('tiny', 'one'), clockBindingOperationId('tiny', 'two'));
  assert.notEqual(clockBindingOperationId('tiny', 'one'), clockBindingOperationId('other', 'one'));
  assert.equal(parseClockCommand(['advance', '--operation-id', randomUUID(), '--to', '2030-01-01T00:00:00Z']).action, 'advance');
  assert.throws(() => parseClockCommand(['delete']));
});
test('private Checkout/clock harness controls are never model tools', () => {
  for (const name of ['get_test_checkout_context', 'get_test_checkout_outcome', 'bind_test_clock', 'advance_test_clock']) {
    assert.ok(!(allowedTools as readonly string[]).includes(name));
    assert.equal(decisionSchema.safeParse({ tool: name, argumentsJson: '{}', summary: '', memory: '', wakeAfterSeconds: 10 }).success, false);
  }
  const filtered = modelSafePaymentResult({ operationId: 'one', url: 'https://checkout.stripe.com/private', result: { checkoutUrl: 'opaque', client_secret: 'private', state: 'pending' } });
  assert.deepEqual(filtered, { operationId: 'one', result: { state: 'pending' } });
});
