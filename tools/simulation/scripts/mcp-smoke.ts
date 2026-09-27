import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadOptions } from '../src/config.ts';
import { HostedTransport, MemberClient } from '../src/transport.ts';
import { protectionSecret } from '../src/protection.ts';

const { credentials } = loadOptions();
if (!credentials.runId?.startsWith('sim-smoke-deterministic-')) throw new Error('Only an explicitly provisioned synthetic deterministic smoke run is allowed.');
const bypass = protectionSecret();
const manifest = await new HostedTransport(credentials, bypass).manifest();
assert.equal(manifest.paymentsConfigured, false, 'This smoke is deliberately nonfinancial.');
const first = new MemberClient(credentials.origin, credentials.agents[0]!, bypass);
const second = new MemberClient(credentials.origin, credentials.agents[1]!, bypass);
try {
  const tools = await first.connect(); await second.connect();
  assert.ok(!tools.some(tool => tool.name === 'prepare_checkout'));
  const found = await first.call('search_asks', { type: 'task' }, randomUUID()) as { items: { id: number }[] };
  const askId = found.items[0]?.id;
  assert.ok(askId);
  const correlationId = randomUUID();
  const args = { askId, saved: true };
  const results = await Promise.all([first.call('save_ask', args, correlationId), first.call('save_ask', args, correlationId)]);
  assert.deepEqual(results[0], results[1]);
  const own = await first.call('get_operation_status', { correlationId }, randomUUID()) as { status: string };
  assert.equal(own.status, 'completed');
  assert.deepEqual(await second.call('get_operation_status', { correlationId }, randomUUID()), { status: 'not_found' });
  await assert.rejects(first.call('save_ask', { ...args, userId: credentials.agents[1]!.userId }, randomUUID()));
  console.log(JSON.stringify({ runId: credentials.runId, authenticatedActors: 2, idempotentSave: true, crossAccountOperationHidden: true, forgedActorRejected: true, paymentToolsHidden: true, correlationId }));
} finally { await first.close(); await second.close(); }
