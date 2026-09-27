import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalModel, assertStagingOrigin, validateManifest } from '../src/config.ts';
import { credentialsSchema, decisionSchema, type AgentCheckpoint } from '../src/protocol.ts';
import { Store } from '../src/store.ts';
import { Semaphore } from '../src/semaphore.ts';
import { makePersonas } from '../src/personas.ts';
import { checkoutBudget, redact, validatedArguments } from '../src/safety.ts';
import { protectionHeaders } from '../src/protection.ts';
import { safeBrowsePath, sessionUserId } from '../src/browser.ts';
import { flushOutbox } from '../src/outbox.ts';

const credentials = { origin: 'https://givetogive-staging.vercel.app', databaseIdentity: 'isolated-test-database', runnerToken: 'r'.repeat(32), agents: [{ id: 'member-001', userId: 'user-001', token: 't'.repeat(32) }] };
const checkpoint: AgentCheckpoint = { id: 'member-001', state: 'idle', cycles: 0, actions: 0, failures: 0, nextWakeAt: 0, memories: [], observation: '', paused: false, spentCents: 0 };

test('production and cloud inference targets are rejected', () => {
  for (const url of ['https://givetogive.vercel.app', 'https://givetogive.com', 'http://givetogive-staging.vercel.app', 'https://user:password@givetogive-staging.vercel.app', 'https://givetogive-staging.vercel.app/mcp']) assert.throws(() => assertStagingOrigin(url));
  assert.doesNotThrow(() => assertStagingOrigin(credentials.origin));
  assert.throws(() => assertLocalModel('https://api.openai.com/v1'));
  assert.throws(() => assertLocalModel('http://192.168.1.1/v1'));
  assert.doesNotThrow(() => assertLocalModel('http://127.0.0.1:8089/v1'));
});
test('all safety attestations and exact database identity are required', () => {
  const manifest = { protocolVersion: 1, environment: 'staging', origin: credentials.origin, databaseIdentity: credentials.databaseIdentity, stripeMode: 'test', paymentsConfigured: true, simulationEnabled: true, mcpPath: '/mcp' };
  assert.doesNotThrow(() => validateManifest(manifest, credentials));
  assert.throws(() => validateManifest({ ...manifest, databaseIdentity: 'production' }, credentials));
  assert.throws(() => validateManifest({ ...manifest, stripeMode: 'live' }, credentials));
  assert.throws(() => validateManifest({ ...manifest, simulationEnabled: false }, credentials));
  assert.doesNotThrow(() => validateManifest({ ...manifest, stripeMode: 'unconfigured', paymentsConfigured: false }, credentials));
  assert.throws(() => validateManifest({ ...manifest, stripeMode: 'unconfigured', paymentsConfigured: true }, credentials));
});
test('accounts, tokens, and private state are independent', () => {
  assert.throws(() => credentialsSchema.parse({ ...credentials, agents: [credentials.agents[0], credentials.agents[0]] }));
  const accounts = Array.from({ length: 100 }, (_, i) => ({ id: `user-${i}`, userId: `id-${i}`, token: `${i}`.padStart(25, 'x') }));
  const personas = makePersonas(accounts, 20260926);
  assert.equal(new Set(personas.map((p) => p.id)).size, 100);
  assert.equal(personas.filter((p) => p.tier === 'neighbor').length, 60);
  assert.equal(personas.filter((p) => p.tier === 'supporter').length, 25);
  assert.equal(personas.filter((p) => p.tier === 'sustainer').length, 15);
});
test('checkpoints, pending mutations, and unsent events survive reopening', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'g2g-simulation-')), 'state.sqlite');
  const first = new Store(path, 'run-test');
  first.checkpoint({ ...checkpoint, memories: ['private member one'], pendingAction: { correlationId: 'op-1', tool: 'create_ask', argumentsJson: '{}' } });
  first.checkpoint({ ...checkpoint, id: 'member-002', memories: ['private member two'] });
  const event = first.event(checkpoint.id, 'acting', 'test', 'Test event');
  first.close();
  const second = new Store(path, 'run-test');
  assert.deepEqual(second.load('member-001')?.memories, ['private member one']);
  assert.equal(second.load('member-001')?.pendingAction?.correlationId, 'op-1');
  assert.deepEqual(second.load('member-002')?.memories, ['private member two']);
  assert.equal(second.pendingEvents()[0]?.id, event.id);
  second.acknowledge([event.id]); assert.equal(second.pendingEvents().length, 0);
  second.acknowledgeCommand('command-1'); assert.equal(second.hasCommand('command-1'), true);
  second.close();
});
test('model/tool concurrency is bounded and no queued members are dropped', async () => {
  const pool = new Semaphore(2); let active = 0; let peak = 0; const finished: number[] = [];
  await Promise.all(Array.from({ length: 100 }, (_, index) => pool.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1)); finished.push(index); active--;
  })));
  assert.equal(peak, 2); assert.equal(finished.length, 100); assert.equal(pool.active, 0); assert.equal(pool.waiting, 0);
  assert.throws(() => pool.resize(100));
});
test('untrusted model output cannot supply identity, overdraw budgets, or navigate away', () => {
  const persona = makePersonas(credentials.agents, 1)[0]!;
  const decision = decisionSchema.parse({ tool: 'prepare_checkout', argumentsJson: '{"amountCents":500}', summary: 'Contribute', memory: '', wakeAfterSeconds: 30 });
  assert.deepEqual(validatedArguments(decision, persona, checkpoint), { amountCents: 500 });
  assert.throws(() => validatedArguments({ ...decision, argumentsJson: '{"amountCents":9999999}' }, persona, checkpoint));
  assert.throws(() => validatedArguments({ ...decision, argumentsJson: '{"grossAmount":9999999}' }, persona, checkpoint));
  assert.throws(() => validatedArguments({ ...decision, argumentsJson: '{"grossAmount":"500"}' }, persona, checkpoint));
  assert.equal(checkoutBudget({ kind: 'supporter', tier: 'sustainer' }), 1500);
  assert.equal(checkoutBudget({ kind: 'supporter', tier: 'supporter' }), 500);
  assert.throws(() => validatedArguments({ ...decision, argumentsJson: '{"nested":{"userId":"someone-else"}}' }, persona, checkpoint));
  assert.throws(() => safeBrowsePath('//evil.example', credentials.origin));
  assert.throws(() => safeBrowsePath('/admin', credentials.origin));
  assert.throws(() => safeBrowsePath('/asks/../../admin', credentials.origin));
  assert.equal(safeBrowsePath('/asks?type=task', credentials.origin).pathname, '/asks');
});
test('credentials never appear in redacted logs', () => {
  const secret = 'private-secret-token-123';
  assert.equal(redact(`failure ${secret}`, [secret]), 'failure [redacted]');
  assert.equal(redact('Open https://checkout.stripe.com/c/pay/cs_test_secret for checkout', []), 'Open [private payment link] for checkout');
  assert.deepEqual(protectionHeaders(secret), { 'x-vercel-protection-bypass': secret });
  assert.deepEqual(protectionHeaders(), {});
});

test('browser authentication treats null as signed out and requires an exact structured account ID', () => {
  for (const value of [null, undefined, {}, { user: null }, { user: { id: 4 } }, 'fake user']) assert.equal(sessionUserId(value), undefined);
  assert.equal(sessionUserId({ user: { id: 'member-001' } }), 'member-001');
});

test('shutdown flush drains more than one hundred events and retains unacknowledged telemetry', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'g2g-outbox-')), 'state.sqlite');
  const store = new Store(path, 'run-outbox');
  try {
    for (let i = 0; i < 205; i++) store.event('runner', 'idle', 'heartbeat', 'Synthetic batch test');
    const sizes: number[] = [];
    await flushOutbox(store, async events => { sizes.push(events.length); return events.map(event => event.id); });
    assert.deepEqual(sizes, [100, 100, 5]);
    store.event('runner', 'paused', 'run_completed', 'Completion retained');
    await assert.rejects(flushOutbox(store, async () => []), /No telemetry acknowledged/);
    assert.equal(store.pendingEvents().length, 1);
  } finally { store.close(); }
});
