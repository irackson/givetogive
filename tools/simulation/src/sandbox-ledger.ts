import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CheckoutScenario } from './sandbox-policy.ts';

export type CheckoutAttempt = { operationId: string; actorId: string; amountCents: number; scenario: CheckoutScenario; state: string; updatedAt: number };
/** No card data, URLs, Stripe keys, browser traces, or raw provider responses are persisted here. */
export class SandboxLedger {
  private db: DatabaseSync;
  private runId: string; private runBudgetCents: number; private actorBudgetCents: number;
  constructor(path: string, runId: string, runBudgetCents: number, actorBudgetCents: number) {
    if (![runBudgetCents, actorBudgetCents].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000)) throw new Error('Invalid finite sandbox budget.');
    this.runId = runId; this.runBudgetCents = runBudgetCents; this.actorBudgetCents = actorBudgetCents;
    mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sandbox_attempts(run_id TEXT, operation_id TEXT, actor_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, scenario TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(run_id,operation_id));');
  }
  get(operationId: string): CheckoutAttempt | undefined {
    const row = this.db.prepare('SELECT operation_id AS operationId,actor_id AS actorId,amount_cents AS amountCents,scenario,state,updated_at AS updatedAt FROM sandbox_attempts WHERE run_id=? AND operation_id=?').get(this.runId, operationId);
    return row as CheckoutAttempt | undefined;
  }
  reserve(operationId: string, actorId: string, amountCents: number, scenario: CheckoutScenario) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Invalid sandbox amount.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.get(operationId)) throw new Error('This Checkout has already been admitted; reconcile it instead of submitting again.');
      const run = this.db.prepare('SELECT coalesce(sum(amount_cents),0) AS amount FROM sandbox_attempts WHERE run_id=?').get(this.runId)!;
      const actor = this.db.prepare('SELECT coalesce(sum(amount_cents),0) AS amount FROM sandbox_attempts WHERE run_id=? AND actor_id=?').get(this.runId, actorId)!;
      if (Number(run.amount) + amountCents > this.runBudgetCents || Number(actor.amount) + amountCents > this.actorBudgetCents) throw new Error('Sandbox run or member budget exhausted.');
      this.db.prepare('INSERT INTO sandbox_attempts VALUES (?,?,?,?,?,?,?)').run(this.runId, operationId, actorId, amountCents, scenario, 'reserved', Date.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  update(operationId: string, state: 'submitted' | 'verified_success' | 'verified_decline' | 'verified_authentication_failure' | 'canceled_unpaid' | 'ambiguous') {
    const prior = this.get(operationId);
    if (!prior || (!['reserved', 'submitted', 'ambiguous'].includes(prior.state) && prior.state !== state)) throw new Error('Final sandbox attempt state cannot be rewritten.');
    if (state === 'submitted' && prior.state !== 'reserved') throw new Error('An admitted operation can only be submitted once.');
    this.db.prepare('UPDATE sandbox_attempts SET state=?,updated_at=? WHERE run_id=? AND operation_id=?').run(state, Date.now(), this.runId, operationId);
  }
  report() { return this.db.prepare('SELECT actor_id AS actorId,operation_id AS operationId,amount_cents AS reservedCents,scenario,state FROM sandbox_attempts WHERE run_id=? ORDER BY updated_at').all(this.runId); }
  close() { this.db.close(); }
}
