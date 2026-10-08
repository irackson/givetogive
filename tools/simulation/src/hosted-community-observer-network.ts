// Passive CDP only: no fetch shim, proxy, raw diagnostic persistence or network entrypoint.
import type { CDPSession } from 'playwright';
import { allowedObserverRequest, activityQuery, guard, type ObserverInput } from './hosted-community-observer-evidence.ts';

export type NetworkPhase = 'navigation' | 'freshness' | 'history' | 'cleanup';
type Failure = 'aborted' | 'timeout' | 'other';
type Issue = 'request' | 'body' | 'status' | 'capacity';
export type QueryCapture = { url: string; values: unknown[]; requestStartedAt: number; headersAt: number; finishedAt: number;
 bytes: number; termination: 'finished' | 'proved-query-abort'; phase: NetworkPhase };
type Decode = (url: string, status: number, accept: string, body: Uint8Array, signal?: AbortSignal) => Promise<unknown[]>;
type RecordState = { url: string; accept: string; requestStartedAt: number; phase: NetworkPhase; scoped: boolean;
 status?: number; headersAt?: number; chunks: Buffer[]; queued: Buffer[]; bytes: number; ready: boolean;
 initial?: Promise<void>; streamUnavailable?: boolean; timer?: ReturnType<typeof setTimeout>; terminal?: 'finished' | Failure; finalized: boolean };
type CdpEvent = Record<string, unknown>;
const maximumBytes = 1_048_576, maximumRequests = 2048, maximumActiveBodies = 8;
const object = (raw: unknown): CdpEvent => raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as CdpEvent : {};

/** Fixed categories only. URLs, headers, error strings and bodies never enter this summary. */
export class ObserverNetwork {
 readonly diagnostics = { rawFailedRequests: 0, expectedSuccessfulQueryAborts: 0, unqualifiedFailedRequests: 0,
  rawBodyFailures: 0, decodedQueries: 0, captureUnavailable: 0, capacityFailures: 0, nonSuccessResponses: 0,
  phases: { navigation: 0, freshness: 0, history: 0, cleanup: 0 }, failures: { aborted: 0, timeout: 0, other: 0 },
  bodyFailurePhases: { navigation: 0, freshness: 0, history: 0, cleanup: 0 },
  statusPhases: { navigation: 0, freshness: 0, history: 0, cleanup: 0 },
  captureStages: { unavailable: 0, deadline: 0, bytes: 0, decode: 0, scope: 0, delivery: 0 } };
 private phase: NetworkPhase = 'navigation';
 private closed = false;
 private records = new Map<string, RecordState>();
 private pending = new Set<Promise<void>>();
 private readonly session: Pick<CDPSession, 'on' | 'off' | 'send'>;
 private readonly input: ObserverInput;
 private readonly decode: Decode;
 private readonly onCapture: (value: QueryCapture) => void;
 private readonly onIssue: (issue: Issue) => void;
 private readonly signal?: AbortSignal;
 constructor(session: Pick<CDPSession, 'on' | 'off' | 'send'>, input: ObserverInput, decode: Decode,
  onCapture: (value: QueryCapture) => void, onIssue: (issue: Issue) => void, signal?: AbortSignal) {
  this.session = session; this.input = input; this.decode = decode; this.onCapture = onCapture; this.onIssue = onIssue; this.signal = signal;
 }
 setPhase(phase: NetworkPhase) { guard(['navigation','freshness','history','cleanup'].includes(phase)); this.phase = phase; }
 private active() { return !this.closed && !this.signal?.aborted; }
 private retain(task: Promise<void>) { this.pending.add(task); void task.then(() => this.pending.delete(task), () => this.pending.delete(task)); }
 private issue(issue: Issue) { if (this.active()) this.onIssue(issue); }
 private erase(record: RecordState) {
  if (record.timer) clearTimeout(record.timer);
  for (const bytes of [...record.chunks, ...record.queued]) bytes.fill(0);
  record.chunks = []; record.queued = []; record.url = ''; record.accept = '';
 }
 private bodyFailure(record: RecordState, unavailable = false) {
  if (record.finalized) return;
  record.finalized = true; this.diagnostics.rawBodyFailures++;
  this.diagnostics.bodyFailurePhases[this.phase]++;
  if (unavailable) this.diagnostics.captureUnavailable++;
  this.issue('body'); this.erase(record);
 }
 private requestFailure(record: RecordState | undefined, kind: Failure) {
  this.diagnostics.unqualifiedFailedRequests++; this.issue('request');
  if (record) { record.terminal = kind; }
 }
 private request = (raw: unknown) => {
  if (!this.active()) return;
  const event = object(raw), request = object(event.request), id = event.requestId;
  if (typeof id !== 'string' || typeof request.url !== 'string' || typeof request.method !== 'string') { this.issue('capacity'); return; }
  if (this.records.has(id) || this.records.size >= maximumRequests) {
   this.diagnostics.capacityFailures++; this.issue('capacity'); return;
  }
  const headers = object(request.headers), rawAccept = headers['trpc-accept'] ?? headers['Trpc-Accept'] ?? '';
  const accept = rawAccept === 'application/jsonl' ? 'application/jsonl' : rawAccept === '' ? '' : rawAccept === 'application/json' ? 'application/json' : 'unknown';
  const scoped = request.method === 'GET' && allowedObserverRequest(request.url, 'GET', this.input)
   && new URL(request.url).pathname.startsWith('/api/trpc/');
  this.records.set(id, { url: scoped ? request.url : '', accept: scoped ? accept : '',
   requestStartedAt: Date.now(), phase: this.phase, scoped, chunks: [], queued: [], bytes: 0, ready: false, finalized: false });
 };
 private response = (raw: unknown) => {
  if (!this.active()) return;
  const event = object(raw), response = object(event.response), id = event.requestId;
  if (typeof id !== 'string') return;
  const record = this.records.get(id); if (!record) return;
  record.status = Number(response.status); record.headersAt = Date.now();
  if (record.status >= 400) { this.diagnostics.nonSuccessResponses++; this.diagnostics.statusPhases[this.phase]++; this.issue('status'); }
  if (!record.scoped || record.status !== 200) return;
  if ([...this.records.values()].filter(item => item.scoped && item.initial && !item.finalized).length >= maximumActiveBodies) {
   this.diagnostics.capacityFailures++; this.issue('capacity'); this.bodyFailure(record); return;
  }
  record.timer = setTimeout(() => {if(this.active()&&!record.finalized){this.diagnostics.captureStages.deadline++;this.bodyFailure(record,true);}},5000);
  record.initial = (async () => {
   let bytes: Buffer | undefined;
   try {
    let result;
    try { result = await this.session.send('Network.streamResourceContent', { requestId: id }); }
    catch {
     // Chromium may finish a small response before streaming can be enabled.
     // Only a later loadingFinished event permits reading its existing body.
     if (this.active() && !record.finalized) record.streamUnavailable = true;
     return;
    }
    if (!this.active() || record.finalized) return;
    guard(typeof result.bufferedData === 'string');
    bytes = this.base64(result.bufferedData);
    record.bytes += bytes.length; guard(record.bytes <= maximumBytes);
    record.chunks.push(bytes, ...record.queued); bytes = undefined; record.queued = []; record.ready = true;
   } catch { if (this.active()&&!record.finalized) {this.diagnostics.captureStages.unavailable++;this.bodyFailure(record,true);} }
   finally { bytes?.fill(0); }
  })();
  this.retain(record.initial);
 };
 private base64(value: string) {
  guard(value.length <= 4 * Math.ceil(maximumBytes / 3));
  const bytes = Buffer.from(value, 'base64');
  try { guard(bytes.toString('base64') === value && bytes.length <= maximumBytes); return bytes; }
  catch (error) { bytes.fill(0); throw error; }
 }
 private data = (raw: unknown) => {
  if (!this.active()) return;
  const event = object(raw), record = typeof event.requestId === 'string' ? this.records.get(event.requestId) : undefined;
  if (!record?.initial || record.finalized || typeof event.data !== 'string') return;
  let bytes: Buffer | undefined;
  try {
   bytes = this.base64(event.data); record.bytes += bytes.length; guard(record.bytes <= maximumBytes);
   (record.ready ? record.chunks : record.queued).push(bytes); bytes = undefined;
  } catch { bytes?.fill(0); this.diagnostics.captureStages.bytes++;this.bodyFailure(record); }
 };
 private finished = (raw: unknown) => this.terminate(raw, 'finished');
 private failed = (raw: unknown) => {
  if (!this.active()) return;
  const event = object(raw), kind: Failure = event.errorText === 'net::ERR_ABORTED' && event.canceled === true ? 'aborted'
   : event.errorText === 'net::ERR_TIMED_OUT' ? 'timeout' : 'other';
  this.diagnostics.rawFailedRequests++; this.diagnostics.phases[this.phase]++; this.diagnostics.failures[kind]++;
  this.terminate(raw, kind);
 };
 private terminate(raw: unknown, termination: 'finished' | Failure) {
  if (!this.active()) return;
  const event = object(raw), record = typeof event.requestId === 'string' ? this.records.get(event.requestId) : undefined;
  if (!record || record.terminal) { if (termination !== 'finished') this.requestFailure(record, termination); return; }
  record.terminal = termination;
  if (!record.scoped || record.status !== 200 || !record.initial || record.finalized || (termination !== 'finished' && termination !== 'aborted')) {
   if (termination !== 'finished') this.requestFailure(record, termination);
   if (record.scoped && record.status === 200 && !record.finalized) this.bodyFailure(record, true);
   record.finalized = true; this.erase(record); return;
  }
  this.retain((async () => {
   let body: Buffer | undefined;
   let stage:'unavailable'|'bytes'|'decode'|'scope'|'delivery'='bytes';
   try {
    await record.initial; guard(this.active() && !record.finalized);
    if (record.streamUnavailable) {
     stage='unavailable';guard(termination === 'finished');
     const result = await this.session.send('Network.getResponseBody', { requestId: event.requestId as string });
     guard(this.active() && !record.finalized && typeof result.body === 'string' && typeof result.base64Encoded === 'boolean');
     guard(result.body.length <= (result.base64Encoded ? 4 * Math.ceil(maximumBytes / 3) : maximumBytes));
     body = result.base64Encoded ? this.base64(result.body) : Buffer.from(result.body, 'utf8');
     guard(body.length > 0 && body.length <= maximumBytes);
     // The completed body is authoritative; never append partial stream chunks.
    } else {
     guard(record.ready);body = Buffer.concat(record.chunks);
     guard(body.length === record.bytes && body.length > 0 && body.length <= maximumBytes);
    }
    if (termination === 'aborted') guard(record.accept === 'application/jsonl');
    stage='decode';const values = await this.decode(record.url, 200, record.accept, body, this.signal);
    guard(this.active() && !record.finalized);stage='scope';this.validateValues(record.url, values);stage='delivery';
    this.onCapture({ url: record.url, values, requestStartedAt: record.requestStartedAt, headersAt: record.headersAt!,
     finishedAt: Date.now(), bytes: body.length, termination: termination === 'aborted' ? 'proved-query-abort' : 'finished', phase: record.phase });
    this.diagnostics.decodedQueries++;
    if (termination === 'aborted') this.diagnostics.expectedSuccessfulQueryAborts++;
    record.finalized = true;
   } catch {
    if (this.active()) { if(!record.finalized)this.diagnostics.captureStages[stage]++;if (termination !== 'finished') this.requestFailure(record, termination); this.bodyFailure(record,stage === 'unavailable'); }
   } finally { body?.fill(0); this.erase(record); }
  })());
 }
 private validateValues(url: string, values: unknown[]) {
  const names = new URL(url).pathname.slice('/api/trpc/'.length).split(','); guard(values.length === names.length);
  for (const [index, name] of names.entries()) {
   const value = object(values[index]);
   if (name === 'admin.simulation') {
    const run = object(value.run); guard(run.id === this.input.runId && run.environment === 'staging' && run.databaseIdentity === this.input.databaseIdentity);
   } else {
    const query = activityQuery(url,index); guard(Array.isArray(value.items) && value.items.length <= 100);
    guard(Number.isFinite(new Date(value.observedAt as string).getTime()));
    guard(value.items.every(raw => {
     const item = object(raw);
     return Number.isSafeInteger(item.id) && Number(item.id) > 0 && item.runId === this.input.runId
      && (this.input.cohort.some(member => member.userId === item.actorId) || item.actorId === this.input.admin.userId)
      && Number.isFinite(new Date(item.occurredAt as string).getTime()) && Number.isFinite(new Date(item.createdAt as string).getTime())
      && (query.actorId === undefined || item.actorId === query.actorId)
      && (query.entityId === undefined || (item.entityId === query.entityId && item.entityType === query.entityType));
    }));
   }
  }
 }
 async start() {
  guard(this.active());
  this.session.on('Network.requestWillBeSent', this.request); this.session.on('Network.responseReceived', this.response);
  this.session.on('Network.dataReceived', this.data); this.session.on('Network.loadingFinished', this.finished); this.session.on('Network.loadingFailed', this.failed);
  try { await this.session.send('Network.enable'); guard(this.active()); }
  catch { this.close(); throw new Error('Observer passive capture unavailable; private details withheld.'); }
 }
 async settle(timeoutMilliseconds = 5000) {
  guard(Number.isInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 5000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([(async()=>{
   while(this.pending.size||[...this.records.values()].some(record=>record.scoped&&record.status===200&&!record.finalized)){
    guard(this.active());
    if(this.pending.size)await Promise.all([...this.pending]);
    else await new Promise<void>(resolve=>setTimeout(resolve,10));
   }
  })(), new Promise<never>((__unused, reject) => {
   timer = setTimeout(() => reject(new Error('Observer passive read deadline exceeded; private details withheld.')), timeoutMilliseconds);
  })]); } finally { if (timer) clearTimeout(timer); }
 }
 close() {
  if (this.closed) return;
  this.phase = 'cleanup'; this.closed = true;
  this.session.off('Network.requestWillBeSent', this.request); this.session.off('Network.responseReceived', this.response);
  this.session.off('Network.dataReceived', this.data); this.session.off('Network.loadingFinished', this.finished); this.session.off('Network.loadingFailed', this.failed);
  for (const record of this.records.values()) this.erase(record); this.records.clear();
 }
}
