import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { loadOptions } from './config.ts';
import { protectionSecret } from './protection.ts';
import { HostedTransport, MemberClient } from './transport.ts';
import { assertSandboxBoundary } from './sandbox-policy.ts';
import { assertClockCredentials, clockBindingOperationId, clockStateSchema, parseClockCommand } from './clock-cohort.ts';

try {
  const command = parseClockCommand(process.argv.slice(2));
  const { credentials } = loadOptions(); const bypass = protectionSecret();
  assertSandboxBoundary(credentials, bypass); assertClockCredentials(credentials);
  if (command.action !== 'read' && process.env.SIM_SANDBOX_CHECKOUT_ENABLED !== '1') throw new Error('Explicit sandbox execution switch required.');
  const hosted = new HostedTransport(credentials, bypass); const manifest = await hosted.manifest();
  if (!manifest.paymentsConfigured || manifest.stripeMode !== 'test') throw new Error('Stripe sandbox is not configured.');
  if (command.action === 'bind') {
    const state = clockStateSchema.parse(await hosted.clock({ action: 'read' }));
    if (state.runId !== credentials.runId || state.status !== 'ready') throw new Error('Named clock must be ready.');
    for (const agent of credentials.agents) {
      const member = new MemberClient(credentials.origin, agent, bypass);
      try {
        await member.connect();
        const result = z.object({ actorId: z.string(), runId: z.string(), clockId: z.string(), livemode: z.literal(false) }).parse(await member.bindTestClock(clockBindingOperationId(credentials.runId!, agent.userId)));
        if (result.actorId !== agent.userId || result.runId !== credentials.runId || result.clockId !== state.clockId) throw new Error('Clock binding identity mismatch.');
        console.log(JSON.stringify({ agentId: agent.id, clockId: state.clockId, result: 'bound', paidEntitlementGranted: false }));
      } finally { await member.close(); }
      await sleep(2000);
    }
  } else {
    let state = clockStateSchema.parse(await hosted.clock(command.action === 'advance' ? command : { action: command.action }));
    if (state.runId !== credentials.runId) throw new Error('Clock run mismatch.');
    // Idempotent command replay returns its original acknowledgement, not necessarily today's clock state.
    if (command.action !== 'read') state = clockStateSchema.parse(await hosted.clock({ action: 'read' }));
    if (state.runId !== credentials.runId) throw new Error('Clock run mismatch.');
    const deadline = Date.now() + 90000;
    while (state.status !== 'ready' && Date.now() < deadline) { await sleep(5000); state = clockStateSchema.parse(await hosted.clock({ action: 'read' })); if (state.runId !== credentials.runId) throw new Error('Clock run mismatch.'); }
    console.log(JSON.stringify({ ...state, billingWebhooksVerified: false, note: 'Clock ready is not proof of a paid renewal; inspect webhook-verified account outcomes.' }));
    if (state.status !== 'ready') process.exitCode = 1;
  }
} catch {
  console.error('Sandbox clock command stopped safely. Check explicit clock scope, tiny-cohort ownership and ready state; preserve and reconcile the same operation ID. No clocks or customer history were deleted.');
  process.exitCode = 1;
}
