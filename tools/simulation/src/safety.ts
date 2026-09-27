import { type Decision, type Persona, type AgentCheckpoint } from './protocol.ts';

export function validatedArguments(decision: Decision, persona: Persona, checkpoint: AgentCheckpoint): Record<string, unknown> {
  const input = JSON.parse(decision.argumentsJson) as unknown;
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Tool arguments must be an object.');
  function inspect(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(userId|actorId|contributorId|createdById|role|admin|authorization|password|token|secret|apiKey|livemode)$/i.test(key))
        throw new Error(`Identity or privileged argument ${key} is not available to agents.`);
      inspect(child);
    }
  }
  inspect(input);
  const args = input as Record<string, unknown>;
  if (decision.tool === 'prepare_checkout') {
    const amount = checkoutBudget(args);
    if (amount !== undefined && (!Number.isSafeInteger(amount) || Number(amount) <= 0 || Number(amount) > persona.budgetCents - checkpoint.spentCents))
      throw new Error('Action exceeds the per-user monetary budget or uses invalid minor units.');
  }
  return args;
}

// Reserve a full monthly charge when preparing subscriptions, even before payment.
export function checkoutBudget(args: Record<string, unknown>): number {
  const value = args.grossAmount ?? args.amountCents ?? args.amount ?? (args.kind === 'supporter' ? args.tier === 'sustainer' ? 1500 : 500 : 0);
  return typeof value === 'number' ? value : NaN;
}

export function redact(value: unknown, secrets: string[]): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets.filter((entry) => entry.length > 3)) text = text.split(secret).join('[redacted]');
  return text.replace(/(?:sk|rk|whsec|g2g)_[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/https:\/\/(?:checkout|billing)\.stripe\.com\/[^\s"<>]+/g, '[private payment link]');
}
