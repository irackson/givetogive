import { z } from 'zod';
import type { Credentials } from './protocol.ts';
import { checkoutScenarios } from './sandbox-policy.ts';

export const sandboxPlanSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  runBudgetCents: z.number().int().min(100).max(1_000_000),
  actorBudgetCents: z.number().int().min(100).max(100_000),
  steps: z.array(z.object({
    operationId: z.uuid(), agentId: z.string().min(1), scenario: z.enum(checkoutScenarios),
    maximumAmountCents: z.number().int().min(100).max(100_000),
    expectedTier: z.enum(['neighbor', 'supporter', 'sustainer']).optional(),
    checkout: z.object({ kind: z.enum(['ask', 'fund', 'supporter']), askId: z.number().int().positive().optional(), fundId: z.uuid().optional(),
      tier: z.enum(['supporter', 'sustainer']).optional(), grossAmount: z.number().int().min(100).max(100_000).optional(), recurring: z.boolean().default(false), quoteVersion: z.string().min(1).max(80).optional() }).strict(),
  }).strict()).min(1).max(30),
}).strict();
export type SandboxPlan = z.infer<typeof sandboxPlanSchema>;
export function validateSandboxPlan(raw: unknown, credentials: Credentials): SandboxPlan {
  const parsed = sandboxPlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid fixed sandbox plan. Use UUID operation IDs and finite cent budgets; no raw cards, URLs or secrets.');
  const plan = parsed.data;
  if (plan.runId !== credentials.runId || new Set(plan.steps.map(step => step.operationId)).size !== plan.steps.length) throw new Error('Run mismatch or repeated operation IDs in sandbox plan.');
  let total = 0; const actors = new Map<string, number>();
  for (const step of plan.steps) {
    const actor = credentials.agents.find(agent => agent.id === step.agentId);
    if (!actor?.email?.endsWith('@givetogive.invalid')) throw new Error('Each sandbox step requires its own provisioned synthetic actor.');
    const input = step.checkout;
    if (input.kind === 'supporter' ? !input.tier || input.askId || input.fundId || input.grossAmount : !input.grossAmount || Boolean(input.tier) || (input.kind === 'ask' ? !input.askId || input.fundId || input.recurring : !input.fundId || input.askId)) throw new Error('Invalid type-specific sandbox checkout.');
    if (input.grossAmount && input.grossAmount > step.maximumAmountCents) throw new Error('Declared amount exceeds the step budget.');
    if (input.kind === 'supporter' && (input.tier === 'sustainer' ? 1500 : 500) > step.maximumAmountCents) throw new Error('The fixed supporter price exceeds the step budget.');
    total += step.maximumAmountCents;
    actors.set(step.agentId, (actors.get(step.agentId) ?? 0) + step.maximumAmountCents);
  }
  if (total > plan.runBudgetCents || [...actors.values()].some(sum => sum > plan.actorBudgetCents)) throw new Error('Plan exceeds its run or actor budget before any provider request.');
  return plan;
}
