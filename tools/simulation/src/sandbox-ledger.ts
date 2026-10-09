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
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sandbox_attempts(run_id TEXT, operation_id TEXT, actor_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, scenario TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(run_id,operation_id)); CREATE TABLE IF NOT EXISTS sandbox_agent_acknowledgments(run_id TEXT NOT NULL,operation_id TEXT NOT NULL,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,operation_id));');
  }
  get(operationId: string): CheckoutAttempt | undefined {
    const row = this.db.prepare('SELECT operation_id AS operationId,actor_id AS actorId,amount_cents AS amountCents,scenario,state,updated_at AS updatedAt FROM sandbox_attempts WHERE run_id=? AND operation_id=?').get(this.runId, operationId);
    return row as CheckoutAttempt | undefined;
  }
  /** Nonfinancial notice permission is spent before the native click, including failures. */
  acknowledgeAgentNotice(operationId: string, actorId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.get(operationId);
      if (!prior || prior.actorId !== actorId || prior.state !== 'reserved') throw new Error('Agent notice requires the same reserved member operation.');
      const existing = this.db.prepare('SELECT 1 FROM sandbox_agent_acknowledgments WHERE run_id=? AND operation_id=?').get(this.runId, operationId);
      if (existing) throw new Error('Agent notice permission was already consumed; reconcile without clicking again.');
      this.db.prepare('INSERT INTO sandbox_agent_acknowledgments VALUES (?,?,?,?)').run(this.runId, operationId, actorId, Date.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.get(operationId);
      if (!prior || (!['reserved', 'submitted', 'ambiguous'].includes(prior.state) && prior.state !== state)) throw new Error('Final sandbox attempt state cannot be rewritten.');
      if (state === 'submitted' && prior.state !== 'reserved') throw new Error('An admitted operation can only be submitted once.');
      const result = this.db.prepare('UPDATE sandbox_attempts SET state=?,updated_at=? WHERE run_id=? AND operation_id=?').run(state, Date.now(), this.runId, operationId);
      if (Number(result.changes) !== 1) throw new Error('Sandbox state transition was not retained.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  report() { return this.db.prepare('SELECT actor_id AS actorId,operation_id AS operationId,amount_cents AS reservedCents,scenario,state FROM sandbox_attempts WHERE run_id=? ORDER BY updated_at').all(this.runId); }
  /** Narrow atomic finalization. Caller owns native outcome evidence; this method
   * proves only the exact submitted-state transition. Holds remain counted in
   * reserve(), including declined, expired and ambiguous historical attempts. */
  finalizeSubmittedDecline(operationId: string, actorId: string, amountCents: number) {
    if (!operationId || !actorId || !Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Invalid original decline boundary.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.get(operationId);
      if (!prior || prior.actorId !== actorId || prior.amountCents !== amountCents || prior.scenario !== 'decline' || prior.state !== 'submitted')
        throw new Error('Only the exact original submitted decline may be finalized once.');
      const changed = this.db.prepare("UPDATE sandbox_attempts SET state='verified_decline',updated_at=? WHERE run_id=? AND operation_id=? AND actor_id=? AND amount_cents=? AND scenario='decline' AND state='submitted'")
        .run(Date.now(), this.runId, operationId, actorId, amountCents);
      if (Number(changed.changes) !== 1) throw new Error('Original decline transition was not retained.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
