import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentCheckpoint, AgentState, SimulationEvent } from './protocol.ts';

export class Store {
  db: DatabaseSync;
  runId: string;
  constructor(path: string, runId: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.runId = runId;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS checkpoints(run_id TEXT, agent_id TEXT, body TEXT NOT NULL, PRIMARY KEY(run_id,agent_id));
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, run_id TEXT, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS controls(run_id TEXT, id TEXT, PRIMARY KEY(run_id,id));
      CREATE TABLE IF NOT EXISTS metadata(run_id TEXT, key TEXT, value TEXT, PRIMARY KEY(run_id,key));`);
  }
  checkpoint(value: AgentCheckpoint) {
    this.db.prepare('INSERT INTO checkpoints VALUES (?,?,?) ON CONFLICT(run_id,agent_id) DO UPDATE SET body=excluded.body').run(this.runId, value.id, JSON.stringify(value));
  }
  load(id: string): AgentCheckpoint | undefined {
    const result = this.db.prepare('SELECT body FROM checkpoints WHERE run_id=? AND agent_id=?').get(this.runId, id);
    return result ? JSON.parse(String(result.body)) as AgentCheckpoint : undefined;
  }
  event(agentId: string, state: AgentState, kind: string, summary: string, data: Record<string, unknown> = {}, correlationId: string = randomUUID()): SimulationEvent {
    const id = randomUUID();
    const event: SimulationEvent = { id, agentId, sequence: 0, kind, state, occurredAt: new Date().toISOString(), correlationId, summary: summary.slice(0, 300), data };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('INSERT INTO events(id,run_id,body) VALUES (?,?,?)').run(id, this.runId, '{}');
      event.sequence = Number(row.lastInsertRowid);
      this.db.prepare('UPDATE events SET body=? WHERE id=?').run(JSON.stringify(event), id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return event;
  }
  pendingEvents(): SimulationEvent[] {
    return this.db.prepare('SELECT body FROM events WHERE run_id=? AND delivered=0 ORDER BY sequence LIMIT 100').all(this.runId).map((row) => JSON.parse(String(row.body)) as SimulationEvent);
  }
  acknowledge(ids: string[]) {
    const statement = this.db.prepare('UPDATE events SET delivered=1 WHERE id=? AND run_id=?');
    this.db.exec('BEGIN');
    try { for (const id of ids) statement.run(id, this.runId); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  hasCommand(id: string) { return !!this.db.prepare('SELECT id FROM controls WHERE run_id=? AND id=?').get(this.runId, id); }
  acknowledgeCommand(id: string) { this.db.prepare('INSERT OR IGNORE INTO controls VALUES (?,?)').run(this.runId, id); }
  meta(key: string, value?: string): string | undefined {
    if (value !== undefined) this.db.prepare('INSERT INTO metadata VALUES (?,?,?) ON CONFLICT(run_id,key) DO UPDATE SET value=excluded.value').run(this.runId, key, value);
    return this.db.prepare('SELECT value FROM metadata WHERE run_id=? AND key=?').get(this.runId, key)?.value as string | undefined;
  }
  report() {
    const agents = this.db.prepare('SELECT body FROM checkpoints WHERE run_id=?').all(this.runId).map((row) => JSON.parse(String(row.body)) as AgentCheckpoint);
    return { runId: this.runId, agents: agents.map(({ memories: _memory, observation: _observation, pendingAction, ...agent }) => ({ ...agent, hasAmbiguousAction: !!pendingAction })), events: this.db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN delivered=0 THEN 1 ELSE 0 END) AS pending FROM events WHERE run_id=?').get(this.runId) };
  }
  close() { this.db.close(); }
}
