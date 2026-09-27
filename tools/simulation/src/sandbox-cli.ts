import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadOptions } from './config.ts';
import { protectionSecret } from './protection.ts';
import { HostedTransport, MemberClient } from './transport.ts';
import { validateSandboxPlan } from './sandbox-plan.ts';
import { assertSandboxBoundary, checkoutOutcomeSchema } from './sandbox-policy.ts';
import { SandboxLedger } from './sandbox-ledger.ts';
import { SandboxCheckoutExecutor, matchingSandboxOutcome } from './sandbox-checkout.ts';
import { StripeCheckoutDriver } from './stripe-checkout-driver.ts';

try {
  const args = process.argv.slice(2); const execute = args.includes('--execute');
  const reconcile = args.includes('--reconcile');
  const index = args.indexOf('--plan'); const path = index >= 0 ? args[index + 1] : undefined;
  if (!path || (execute && reconcile) || args.some((arg, i) => !['--execute', '--reconcile', '--plan'].includes(arg) && i !== index + 1)) throw new Error('Use --plan <local-json-file> [--execute | --reconcile]. Default only validates the plan.');
  const { credentials, options } = loadOptions(); const bypass = protectionSecret();
  assertSandboxBoundary(credentials, bypass);
  const plan = validateSandboxPlan(JSON.parse(readFileSync(path, 'utf8')), credentials);
  if (!execute && !reconcile) console.log(JSON.stringify({ runId: plan.runId, steps: plan.steps.length, maximumReservedCents: plan.steps.reduce((sum, step) => sum + step.maximumAmountCents, 0), providerContacted: false, executionEnabled: false }));
  else {
    if (execute && process.env.SIM_SANDBOX_CHECKOUT_ENABLED !== '1') throw new Error('Execution also requires SIM_SANDBOX_CHECKOUT_ENABLED=1.');
    const hosted = new HostedTransport(credentials, bypass); const manifest = await hosted.manifest();
    if (!manifest.paymentsConfigured || manifest.stripeMode !== 'test' || ['stopped', 'completed', 'cancelled'].includes(manifest.runStatus ?? '')) throw new Error('An active protected staging run with configured TEST payments is required.');
    const ledger = new SandboxLedger(join(options.stateDirectory, 'sandbox-checkout.sqlite'), plan.runId, plan.runBudgetCents, plan.actorBudgetCents);
    try {
      for (const step of plan.steps) {
        const prior = ledger.get(step.operationId);
        if (prior && !reconcile) {
          // Do not reinterpret a prior result under a changed plan or skip a newly asserted tier expectation.
          // Remove completed steps from the next reviewed plan; the same ledger still counts their budget.
          throw new Error('A previous sandbox attempt is unresolved. Read its existing operation outcome; never resubmit it.');
        }
        const actor = credentials.agents.find(agent => agent.id === step.agentId)!;
        const member = new MemberClient(credentials.origin, actor, bypass);
        try {
          const tools = await member.connect();
          if (reconcile) {
            if (!prior || prior.actorId !== actor.userId || prior.scenario !== step.scenario || prior.amountCents > step.maximumAmountCents) throw new Error('Reconciliation must match the existing admitted operation.');
            const outcome = checkoutOutcomeSchema.parse(await member.sandboxRead('outcome', step.operationId));
            if (outcome.actorId !== actor.userId || outcome.operationId !== step.operationId) throw new Error('Outcome identity mismatch.');
            const state = matchingSandboxOutcome(step.scenario, outcome);
            if (!state || (step.expectedTier && outcome.effectiveTier !== step.expectedTier)) throw new Error('Existing outcome is not yet authoritative or does not match the expected tier.');
            ledger.update(step.operationId, state);
            console.log(JSON.stringify({ agentId: step.agentId, operationId: step.operationId, result: state, effectiveTier: outcome.effectiveTier, reconciliationOnly: true }));
            await sleep(2000);
            continue;
          }
          if (!tools.some(tool => tool.name === 'prepare_checkout')) throw new Error('Sandbox payment preparation is disabled.');
          await member.call('prepare_checkout', step.checkout, step.operationId); // Stable UUID, ignored opaque result.
          const executor = new SandboxCheckoutExecutor(ledger, () => new StripeCheckoutDriver(bypass!, actor.email!));
          const result = await executor.execute({ context: id => member.sandboxRead('context', id), outcome: id => member.sandboxRead('outcome', id) },
            { credentials, actorId: actor.userId, operationId: step.operationId, protectionBypass: bypass!, maximumAmountCents: step.maximumAmountCents }, step.scenario);
          if (step.expectedTier && result.effectiveTier !== step.expectedTier) throw new Error('Webhook-verified effective tier does not match the scenario expectation.');
          console.log(JSON.stringify({ agentId: step.agentId, ...result }));
        } finally { await member.close(); }
        await sleep(2000); // Serial functional testing, not Stripe sandbox load testing.
      }
      console.log(JSON.stringify({ runId: plan.runId, attempts: ledger.report(), note: 'Evidence covers these fixed scenarios only; no automatic deletion or paid-tier fabrication.' }));
    } finally { ledger.close(); }
  }
} catch {
  // Never propagate provider/Playwright/Zod input errors with secrets or card fixtures.
  console.error('Sandbox Checkout command stopped safely. Validate the plan, run credentials and feature configuration; inspect the redacted local ledger and reconcile existing operations before retrying.');
  process.exitCode = 1;
}
