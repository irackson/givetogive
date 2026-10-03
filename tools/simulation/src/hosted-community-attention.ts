import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { requireHosted } from './hosted-community-policy.ts';

export type Attention = 'member_halted' | 'supervisor_exited' | 'invalid_supervision_record' | 'invalid_telemetry_record';
/** Strictly bounded parsing of the existing sanitized supervision stream; no DOM/provider data. */
export class HostedAttention {
 private offset = 0;
 private partial = '';
 private stopped = false;
 constructor(privateMembers: ReadonlySet<string>, privateLines: ReadonlySet<string>, onAttention: (kind: Attention) => void,
  onStarted: (pid: number) => void = () => {}) {
  this.members = privateMembers; this.lines = privateLines; this.attention = onAttention; this.started = onStarted;
 }
 private members: ReadonlySet<string>;
 private lines: ReadonlySet<string>;
 private attention: (kind: Attention) => void;
 private started: (pid: number) => void;
 private reject(kind: Attention) { if (!this.stopped) { this.stopped = true; this.attention(kind); } }
 feed(bytes: Buffer) {
  if (this.stopped) return;
  if (bytes.length > 65536) return this.reject('invalid_supervision_record');
  this.partial += bytes.toString('utf8');
  let newline: number;
  while ((newline = this.partial.indexOf('\n')) >= 0) {
   const line = this.partial.slice(0, newline); this.partial = this.partial.slice(newline + 1);
   if (line.length > 65536) return this.reject('invalid_supervision_record');
   let item: Record<string, unknown>;
   try { const value: unknown = JSON.parse(line); requireHosted(value && typeof value === 'object' && !Array.isArray(value)); item = value as Record<string, unknown>; }
   catch { return this.reject('invalid_supervision_record'); }
   if (item.started === true && Number.isSafeInteger(item.ownedProcessId) && Number(item.ownedProcessId) > 0) this.started(Number(item.ownedProcessId));
   const candidate = item.attention && typeof item.attention === 'object' ? item.attention as Record<string, unknown> : item;
   if ((candidate.outcome === 'paused' || candidate.state === 'paused') && typeof candidate.user === 'string' && this.members.has(candidate.user) &&
    typeof candidate.line === 'string' && this.lines.has(candidate.line)) this.reject('member_halted');
   if (this.stopped) return;
  }
  if (this.partial.length > 65536) this.reject('invalid_supervision_record');
 }
 poll(path: string) {
  try {
   const size = statSync(path).size;
   if (size < this.offset) return this.reject('invalid_supervision_record');
   if (size === this.offset || this.stopped) return;
   const bytes = Buffer.alloc(Math.min(65536, size - this.offset)), fd = openSync(path, 'r');
   try { const count = readSync(fd, bytes, 0, bytes.length, this.offset); this.offset += count; this.feed(bytes.subarray(0, count)); }
   finally { closeSync(fd); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reject('invalid_supervision_record'); }
 }
 exited(code: number | null, elapsedMilliseconds: number, durationSeconds: number) {
  if (this.partial.length) return this.reject('invalid_supervision_record');
  if (code !== 0 || elapsedMilliseconds < durationSeconds * 1000) this.reject('supervisor_exited');
 }
 finalize(path: string) {
  // Bound final log catch-up at 16MiB; truncated/backlogged evidence fails rather than disappearing.
  try {
   const size = statSync(path).size; requireHosted(size - this.offset <= 16 * 1024 * 1024);
   for (let chunk = 0; !this.stopped && this.offset < size && chunk < 256; chunk++) {
    const before = this.offset; this.poll(path); requireHosted(this.stopped || this.offset > before);
   }
   requireHosted(this.stopped || this.offset === size);
  } catch { this.reject('invalid_supervision_record'); }
 }
}
/** Actual event state disambiguates halted 401/403 actors from ordinary rejected races in stdout. */
export class HostedTelemetryAttention {
 private sequence = 0;
 private stopped = false;
 private members: ReadonlySet<string>;
 private attention: (kind: Attention) => void;
 constructor(members: ReadonlySet<string>, attention: (kind: Attention) => void) { this.members = members; this.attention = attention; }
 private reject(kind: Attention) { if (!this.stopped) { this.stopped = true; this.attention(kind); } }
 feed(rows: { sequence: number; body: string }[]) {
  if (this.stopped) return;
  if (rows.length > 100) return this.reject('invalid_telemetry_record');
  for (const row of rows) {
   if (!Number.isSafeInteger(row.sequence) || row.sequence <= this.sequence || row.body.length > 65536) return this.reject('invalid_telemetry_record');
   let event: Record<string, unknown>;
   try { const value: unknown = JSON.parse(row.body); requireHosted(value && typeof value === 'object' && !Array.isArray(value)); event = value as Record<string, unknown>; }
   catch { return this.reject('invalid_telemetry_record'); }
   this.sequence = row.sequence;
   if (event.kind === 'action_result' && event.state === 'paused' && typeof event.agentId === 'string' && this.members.has(event.agentId)) return this.reject('member_halted');
  }
 }
 poll(path: string, runId: string) {
  if (this.stopped) return 0;
  let db: DatabaseSync | undefined;
  try {
   db = new DatabaseSync(path, { readOnly: true });
   const rows = db.prepare('SELECT sequence,body FROM events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(runId, this.sequence);
   this.feed(rows.map(row => ({ sequence: Number(row.sequence), body: String(row.body) })));
   return rows.length;
  } catch { this.reject('invalid_telemetry_record'); return 0; }
  finally { db?.close(); }
 }
 finalize(path: string, runId: string) {
  for (let batch = 0; batch < 256; batch++) if (this.poll(path, runId) < 100 || this.stopped) return;
  this.reject('invalid_telemetry_record');
 }
}
/** Linux metadata only, never /proc command lines or environment. Bind PID reuse via kernel start ticks. */
export function linuxProcessIdentity(raw: string, pid: number) {
 const end = raw.lastIndexOf(')'), start = raw.indexOf('(');
 requireHosted(Number(raw.slice(0, start).trim()) === pid && start > 0 && end > start);
 const fields = raw.slice(end + 1).trim().split(/\s+/);
 requireHosted(/^[0-9]+$/.test(fields[1] ?? '') && /^[0-9]+$/.test(fields[19] ?? ''));
 return { pid, parentPid: Number(fields[1]), startTicks: fields[19]!, state: fields[0] };
}
