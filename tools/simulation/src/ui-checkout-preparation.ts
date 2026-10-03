import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiRejection, type UiApi } from './ui-session.ts';
import type { SandboxPlan } from './sandbox-plan.ts';

type Step = SandboxPlan['steps'][number];
/** Admission precedes the ordinary UI mutation. No cookies, URLs or keys are stored. */
export class UiCheckoutPreparation {
	private readonly db: DatabaseSync;
	private readonly runId: string;
	constructor(path: string, plan: SandboxPlan) {
		this.runId = plan.runId;
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ui_checkout_budget(run_id TEXT PRIMARY KEY,run_budget INTEGER NOT NULL,actor_budget INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_checkout_intent(run_id TEXT,operation_id TEXT,actor_id TEXT NOT NULL,request_hash TEXT NOT NULL,maximum_cents INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(run_id,operation_id));`);
		this.db
			.prepare('INSERT OR IGNORE INTO ui_checkout_budget VALUES (?,?,?)')
			.run(plan.runId, plan.runBudgetCents, plan.actorBudgetCents);
		const saved = this.db
			.prepare(
				'SELECT run_budget,actor_budget FROM ui_checkout_budget WHERE run_id=?',
			)
			.get(plan.runId)!;
		if (
			saved.run_budget !== plan.runBudgetCents ||
			saved.actor_budget !== plan.actorBudgetCents
		) {
			this.db.close();
			throw new Error(
				'An existing financial run budget cannot be changed.',
			);
		}
	}
	state(operationId: string): string | undefined {
		return this.db
			.prepare(
				'SELECT state FROM ui_checkout_intent WHERE run_id=? AND operation_id=?',
			)
			.get(this.runId, operationId)?.state as string | undefined;
	}
	private record(operationId: string, state: string) {
		this.db
			.prepare(
				'UPDATE ui_checkout_intent SET state=? WHERE run_id=? AND operation_id=?',
			)
			.run(state, this.runId, operationId);
	}
	async prepare(session: UiApi, actorId: string, step: Step) {
		if (session.userId !== actorId)
			throw new Error('Checkout requires this actor’s normal session.');
		if (step.checkout.kind !== 'supporter' && !step.checkout.quoteVersion)
			throw new Error(
				'Review and freeze the UI fee quote before financial preparation.',
			);
		if (
			step.checkout.kind === 'supporter' &&
			(step.checkout.tier === 'sustainer' ? 1500 : 500) >
				step.maximumAmountCents
		)
			throw new Error(
				'The fixed tier price exceeds the financial preparation budget.',
			);
		const input = { ...step.checkout, operationId: step.operationId };
		const requestHash = createHash('sha256')
			.update(JSON.stringify(input))
			.digest('hex');
		this.db.exec('BEGIN IMMEDIATE');
		try {
			if (this.state(step.operationId))
				throw new Error(
					'Checkout was already admitted. Reconcile it; never repeat the preparation mutation.',
				);
			const budget = this.db
				.prepare(
					'SELECT run_budget,actor_budget FROM ui_checkout_budget WHERE run_id=?',
				)
				.get(this.runId)!;
			const spent = this.db
				.prepare(
					'SELECT coalesce(sum(maximum_cents),0) AS total,coalesce(sum(CASE WHEN actor_id=? THEN maximum_cents ELSE 0 END),0) AS actor FROM ui_checkout_intent WHERE run_id=?',
				)
				.get(actorId, this.runId)!;
			if (
				!Number.isSafeInteger(step.maximumAmountCents) ||
				step.maximumAmountCents <= 0 ||
				Number(spent.total) + step.maximumAmountCents >
					Number(budget.run_budget) ||
				Number(spent.actor) + step.maximumAmountCents >
					Number(budget.actor_budget)
			)
				throw new Error('Financial preparation budget exhausted.');
			this.db
				.prepare('INSERT INTO ui_checkout_intent VALUES (?,?,?,?,?,?)')
				.run(
					this.runId,
					step.operationId,
					actorId,
					requestHash,
					step.maximumAmountCents,
					'preparing',
				);
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
		try {
			const result = await session.mutate(
				'billing.createCheckout',
				input,
			);
			this.record(step.operationId, 'prepared');
			return result;
		} catch (error) {
			// A 5xx/timeout can follow a successful provider write. Even rejected intents
			// remain admitted: a different intent requires an explicit, reviewed plan.
			this.record(
				step.operationId,
				error instanceof ApiRejection && error.status < 500 ?
					'rejected'
				:	'unresolved',
			);
			throw new Error(
				'Checkout preparation did not resolve. Read the existing operation before any new purchase.',
			);
		}
	}
	close() {
		this.db.close();
	}
}
