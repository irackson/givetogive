import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EntityRef } from './activity.ts';

/** Durable intent/outcome journal. A pending mutation is never blindly replayed. */
export class ActivityStore {
	readonly db: DatabaseSync;
	readonly owner = randomUUID();
	readonly journalId: string;
	readonly runId: string;
	constructor(path: string, runId: string, digest: string) {
		this.runId = runId;
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS programs(run_id TEXT PRIMARY KEY,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal_identity(run_id TEXT PRIMARY KEY,id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_control(user_id TEXT PRIMARY KEY,owner TEXT,pid INTEGER,driver TEXT);
      CREATE TABLE IF NOT EXISTS steps(run_id TEXT,line_id TEXT,iteration INTEGER,state TEXT,procedure TEXT,entity TEXT,PRIMARY KEY(run_id,line_id,iteration));
      CREATE TABLE IF NOT EXISTS refs(run_id TEXT,name TEXT,entity TEXT,PRIMARY KEY(run_id,name));`);
		this.db
			.prepare('INSERT OR IGNORE INTO programs VALUES (?,?)')
			.run(runId, digest);
		this.db
			.prepare('INSERT OR IGNORE INTO journal_identity VALUES (?,?)')
			.run(runId, randomUUID());
		this.journalId = String(
			this.db
				.prepare('SELECT id FROM journal_identity WHERE run_id=?')
				.get(runId)!.id,
		);
		if (
			this.db
				.prepare('SELECT digest FROM programs WHERE run_id=?')
				.get(runId)?.digest !== digest
		) {
			this.db.close();
			throw new Error(
				'Scenario changed: create a new run instead of rewriting its history.',
			);
		}
	}
	claim(userId: string, driver: 'script' | 'browser') {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const prior = this.db
				.prepare(
					'SELECT owner,pid FROM account_control WHERE user_id=?',
				)
				.get(userId);
			if (prior && prior.owner !== this.owner) {
				let live = true;
				try {
					process.kill(Number(prior.pid), 0);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ESRCH')
						live = false;
				}
				if (live)
					throw new Error(
						'This account already has a live controller.',
					);
			}
			this.db
				.prepare(
					'INSERT INTO account_control VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid,driver=excluded.driver',
				)
				.run(userId, this.owner, process.pid, driver);
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	refs(): Map<string, EntityRef> {
		return new Map(
			this.db
				.prepare('SELECT name,entity FROM refs WHERE run_id=?')
				.all(this.runId)
				.map((row) => [
					String(row.name),
					JSON.parse(String(row.entity)) as EntityRef,
				]),
		);
	}
	state(line: string, iteration: number) {
		return this.db
			.prepare(
				'SELECT state FROM steps WHERE run_id=? AND line_id=? AND iteration=?',
			)
			.get(this.runId, line, iteration)?.state as string | undefined;
	}
	last(line: string) {
		const row = this.db
			.prepare(
				'SELECT iteration,state FROM steps WHERE run_id=? AND line_id=? ORDER BY iteration DESC LIMIT 1',
			)
			.get(this.runId, line);
		return row ?
				{ iteration: Number(row.iteration), state: String(row.state) }
			:	undefined;
	}
	counts(lines: string[]) {
		const statement = this.db.prepare(
			'SELECT state,COUNT(*) AS count FROM steps WHERE run_id=? AND line_id=? GROUP BY state',
		);
		const counts = { cycles: 0, actions: 0, failures: 0 };
		for (const line of lines)
			for (const row of statement.all(this.runId, line)) {
				if (row.state === 'success') {
					counts.cycles += Number(row.count);
					counts.actions += Number(row.count);
				}
				if (row.state === 'rejected') {
					counts.cycles += Number(row.count);
					counts.failures += Number(row.count);
				}
			}
		return counts;
	}
	intent(line: string, iteration: number, procedure: string) {
		if (this.state(line, iteration))
			throw new Error(
				'This action already has a recorded outcome or unresolved intent.',
			);
		this.db
			.prepare('INSERT INTO steps VALUES (?,?,?,?,?,NULL)')
			.run(this.runId, line, iteration, 'pending', procedure);
	}
	finish(
		line: string,
		iteration: number,
		outcome: 'success' | 'rejected',
		entity?: EntityRef,
		ref?: string,
	) {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const prior = this.state(line, iteration);
			if (prior && prior !== 'pending')
				throw new Error(
					'A terminal action result cannot be overwritten.',
				);
			this.db
				.prepare(
					'INSERT INTO steps VALUES (?,?,?,?,NULL,?) ON CONFLICT(run_id,line_id,iteration) DO UPDATE SET state=excluded.state,entity=excluded.entity',
				)
				.run(
					this.runId,
					line,
					iteration,
					outcome,
					entity ? JSON.stringify(entity) : null,
				);
			if (outcome === 'success' && ref && entity) {
				this.db
					.prepare('INSERT INTO refs VALUES (?,?,?)')
					.run(this.runId, ref, JSON.stringify(entity));
			}
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	release() {
		this.db
			.prepare('DELETE FROM account_control WHERE owner=?')
			.run(this.owner);
	}
	/** Call only after exact hosted terminal attestation and an empty outbox. */
	releaseAbandonedClaims(
		cohort: ReadonlySet<string>,
		probe: (pid: number) => void = (pid) => { process.kill(pid, 0); },
	) {
		return this.reviewOrReleaseAbandonedClaims(cohort, probe, true);
	}
	reviewAbandonedClaims(
		cohort: ReadonlySet<string>,
		probe: (pid: number) => void = (pid) => { process.kill(pid, 0); },
	) {
		return this.reviewOrReleaseAbandonedClaims(cohort, probe, false);
	}
	private reviewOrReleaseAbandonedClaims(cohort: ReadonlySet<string>, probe: (pid: number) => void, release: boolean) {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			if (this.pendingCount())
				throw new Error('Unresolved mutation retained; local claims cannot be cleaned.');
			const claims = this.db.prepare('SELECT user_id,pid FROM account_control').all();
			for (const claim of claims) {
				if (!cohort.has(String(claim.user_id)) || !Number.isSafeInteger(claim.pid) || Number(claim.pid) <= 0)
					throw new Error('A recorded account or process differs from the reviewed cohort.');
				let stopped = false;
				try { probe(Number(claim.pid)); }
				catch (error) { stopped = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
				if (!stopped)
					throw new Error('A recorded controller is live or its process presence is ambiguous.');
			}
			const removed = release ? this.db.prepare('DELETE FROM account_control').run().changes : claims.length;
			this.db.exec('COMMIT');
			return Number(removed);
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	pendingCount() {
		return Number(
			this.db
				.prepare(
					'SELECT COUNT(*) AS count FROM steps WHERE run_id=? AND state=?',
				)
				.get(this.runId, 'pending')?.count ?? 0,
		);
	}
	close() {
		this.release();
		this.db.close();
	}
}
