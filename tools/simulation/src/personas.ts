import type { AgentCredentials, Persona } from './protocol.ts';

export function makePersonas(accounts: AgentCredentials[], seed: number): Persona[] {
  const interests = ['gardening', 'cooking', 'repairs', 'transport', 'tutoring', 'art', 'childcare', 'technology', 'food access', 'community events'];
  const dispositions = ['patient and generous', 'practical and task-focused', 'curious and sociable', 'cautious with money', 'busy but dependable'];
  return accounts.map((account, i) => ({
    id: account.id, name: `Synthetic neighbor ${i + 1}`, tier: account.targetTier ?? (i < Math.round(accounts.length * .6) ? 'neighbor' : i < Math.round(accounts.length * .85) ? 'supporter' : 'sustainer'),
    interests: [interests[(i + seed) % interests.length]!, interests[(i * 3 + seed + 1) % interests.length]!],
    disposition: dispositions[i % dispositions.length]!, budgetCents: 1000 + (i % 10) * 1000, availableMinutes: 15 + (i % 5) * 30,
    goal: ['Find a relevant Ask, save it, and offer practical help.', 'Create an Ask for something you genuinely need in this synthetic community; respond to helpers.', 'Find neighbors with shared interests and contribute within your budget.', 'Explore community funds and keep track of your contributions.'][i % 4]!,
  }));
}
