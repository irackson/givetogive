// Import has no entrypoint, private file reads, auth, browser or network actions.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, existsSync, mkdirSync, readdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freemem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserType, Page, CDPSession, ConsoleMessage } from 'playwright';
import { ObserverNetwork } from './hosted-community-observer-network.ts';
import { jsonlStreamConsumer } from '@trpc/server/unstable-core-do-not-import';
import observerSuperjson from 'superjson';
import { UiSession } from './ui-session.ts';
import { protectionHeaders } from './protection.ts';
import { communityContinuity } from './community-evidence.ts';
import { runnerFiles, selectFullRunApproval, containedPath } from './hosted-community-policy.ts';
import { guard, validateObserverInput, observerPath, memoryAdmission, assertObserverSource, allowedObserverRequest, suppressedShellPrefetch,
 freshnessEvidence, assertJournalOwnership, expectedObserverBrowserIds, activityQuery, type ObserverInput, type LocalSuccess, type HostedSuccess, type Rendered } from './hosted-community-observer-evidence.ts';

export type ObserverOptions = { toolsDirectory: string; outputName: string; signal?: AbortSignal };
export type ObserverDiagnostics = { consoleErrors: number; pageErrors: number; failedRequests: number;
 nonSuccessResponses: number; blockedRequests: number; feedBodyErrors: number };
type HostedRunResponse = { run: { id:string;environment:string;databaseIdentity:string;status:string;settings?:{controllerId?:unknown} };
 online:unknown;agents:{id:string;userId:string;state:unknown}[] };
type HostedActivity = { id:number;runId:string;action:string;details?:{outcome?:unknown};actorId:string|null;externalId:string;
 occurredAt:Date|string;createdAt:Date|string;entityType?:string;entityId?:string };
type ActivityPage = { items:HostedActivity[];observedAt:Date|string };
type RpcEnvelope = { error?:unknown;result?:{data:ReturnType<typeof observerSuperjson.serialize>} };
type ObserverWindow = Window & { __communityObserver:{samples:Map<number,Rendered>;observer:MutationObserver} };
const cancelled = () => new Error('Observer cancelled; private details withheld.');
/** Cancellation stops new admission; already initiated work is tracked through bounded cleanup. */
export class ObserverCancellation {
 readonly controller = new AbortController();
 readonly pending = new Set<Promise<unknown>>();
 cleanupFailed = false;
 private readonly parent?: AbortSignal;
 private readonly relay = () => this.cancel();
 constructor(parent?: AbortSignal) {
  this.parent = parent;
  if (parent?.aborted) this.cancel(); else parent?.addEventListener('abort', this.relay, { once: true });
 }
 get signal() { return this.controller.signal; }
 require() { if (this.signal.aborted) throw cancelled(); }
 cancel() { if (!this.signal.aborted) this.controller.abort(); }
 detach() { this.parent?.removeEventListener('abort', this.relay); }
 async run<T>(factory: () => Promise<T>, lateCleanup?: (value: T) => Promise<unknown>): Promise<T> {
  this.require();
  let rejectAbort: (reason: Error) => void = () => undefined;
  const abort = new Promise<never>((__unused, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(cancelled());
  this.signal.addEventListener('abort', onAbort, { once: true });
  let produced: { value: T } | undefined, closing: Promise<unknown> | undefined;
  const closeLate = () => closing ??= Promise.resolve().then(() => lateCleanup!(produced!.value));
  const retain = (promise: Promise<unknown>) => {
   this.pending.add(promise);
   void promise.then(() => this.pending.delete(promise), () => { this.cleanupFailed = true; this.pending.delete(promise); });
  };
  // Defer the factory until the listener is attached, rechecking admission in that microtask.
  const work = Promise.resolve().then(() => { this.require(); return factory(); }).then(value => { produced = { value }; return value; });
  retain(work.then(async () => { if (this.signal.aborted && lateCleanup) await closeLate(); }, () => undefined));
  try { const value = await Promise.race([work, abort]); this.require(); return value; }
  finally {
   this.signal.removeEventListener('abort', onAbort);
   // Also cover cancellation between resolution and the awaiting caller's assignment.
   if (this.signal.aborted && produced && lateCleanup) retain(closeLate());
  }
 }
 wait(milliseconds: number) { return this.run(() => sleep(milliseconds, undefined, { signal: this.signal })); }
}
export async function boundedObserverCleanup(tasks: Promise<unknown>[], timeoutMilliseconds = 35000): Promise<boolean> {
 guard(Number.isInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 35000);
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([Promise.allSettled(tasks).then(values => values.every(value => value.status === 'fulfilled')),
  new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMilliseconds); })]);
 } finally { if (timer) clearTimeout(timer); }
}
export async function boundedObserverReads(tasks: Promise<void>[], timeoutMilliseconds = 5000, signal?: AbortSignal) {
 guard(Number.isInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 5000);
 const cancellation = new ObserverCancellation(signal);
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { await cancellation.run(() => Promise.race([Promise.allSettled(tasks), new Promise((__unused,reject)=>{
  timer=setTimeout(()=>reject(new Error('Observer read deadline exceeded; private details withheld.')),timeoutMilliseconds);
 })])); } finally { cancellation.detach(); if(timer)clearTimeout(timer); }
}
/** The final sub-second interval is DOM drain, not an unrealistic one-millisecond GET deadline. */
export function observerPollWindow(now: number, end: number) {
 guard(Number.isFinite(now) && Number.isFinite(end) && Number.isSafeInteger(now) && Number.isSafeInteger(end));
 const remaining = Math.max(0,end-now);
 return remaining < 1000 ? { kind:'drain' as const, waitMilliseconds:remaining }
  : { kind:'read' as const, timeoutMilliseconds:Math.min(15000,remaining) };
}
/** Decode the UI's request-negotiated query transport; no raw bodies/errors are retained. */
export async function observerQueryResponses(url: string, status: number, requestAccept: string,
 body: Uint8Array, input: ObserverInput, signal?: AbortSignal): Promise<unknown[]> {
 const cancellation = new ObserverCancellation(signal);
 // tRPC may abort its transport controller on normal stream completion. Do not
 // mistake that successful teardown for parent/whole-observer cancellation.
 const transport = new AbortController(), cancelTransport = () => transport.abort();
 cancellation.signal.addEventListener('abort',cancelTransport,{once:true});
 const timer = setTimeout(() => cancellation.cancel(),5000);
 try {
  cancellation.require();
  guard(status === 200 && body.byteLength <= 1_048_576 && allowedObserverRequest(url,'GET',input));
  const names = new URL(url).pathname.slice('/api/trpc/'.length).split(',');
  guard(names.every(name=>name==='admin.activity'||name==='admin.simulation'));
  const text = new TextDecoder('utf-8',{fatal:true}).decode(body);
  if(requestAccept === 'application/jsonl') {
   // The consumer can resolve data before parsing its tail. Validate the whole
   // retained finite body so truncated/junk tails cannot silently pass.
   const lines=text.split('\n'),tail=lines.pop();guard(tail?.trim()===''&&lines.length>0&&lines.length<=1024);
   // Validate every promise frame, not only the portion consumed before tRPC's
   // successful transport abort. Extra, rejected or unresolved frames fail closed.
   const frames=lines.filter(line=>line.trim()).map(line=>observerSuperjson.deserialize(JSON.parse(line)));
   const registered=new Set<number>(),settled=new Set<number>();
   const encoded=(raw:unknown)=>{
    guard(Array.isArray(raw)&&raw.length>=1&&Array.isArray(raw[0])&&raw[0].length<=1);
    for(const definition of raw.slice(1)){
     guard(Array.isArray(definition)&&definition.length===3&&definition[1]===0
      &&(definition[0]===null||typeof definition[0]==='string'||(Number.isInteger(definition[0])&&definition[0]>=0))
      &&Number.isSafeInteger(definition[2])&&definition[2]>=0&&!registered.has(definition[2]));
     registered.add(definition[2]);
    }
   };
   const first=frames[0] as Record<string,unknown>;
   guard(first&&typeof first==='object'&&!Array.isArray(first)&&Object.keys(first).length===names.length);
   names.forEach((__unused,index)=>{guard(Object.hasOwn(first,String(index)));encoded(first[String(index)]);});
   for(const frame of frames.slice(1)){
    guard(Array.isArray(frame)&&frame.length===3&&registered.has(frame[0])&&!settled.has(frame[0])&&frame[1]===0);
    settled.add(frame[0]);encoded(frame[2]);
   }
   guard(registered.size===settled.size);
   const stream = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(body);controller.close();}});
   const [head] = await cancellation.run(() => jsonlStreamConsumer<Record<string,Promise<unknown>>>({
    from:stream,deserialize:value=>observerSuperjson.deserialize(value as ReturnType<typeof observerSuperjson.serialize>),
    formatError:()=>new Error('Observer activity body unavailable; private details withheld.'),abortController:transport,
   }));
   guard(Object.keys(head).length === names.length && names.every((__unused,index)=>Object.hasOwn(head,String(index))));
   const envelopes = await cancellation.run(() => Promise.all(names.map((__unused,index)=>head[String(index)])));
   const values = await cancellation.run(() => Promise.all(envelopes.map(async rawEnvelope=>{
    const envelope=rawEnvelope as {error?:unknown;result?:unknown};
    guard(envelope && typeof envelope === 'object' && !envelope.error);
    const result = (await envelope.result) as Record<string,unknown>;guard(result && typeof result === 'object' && Object.hasOwn(result,'data'));
    return await result.data;
   })));
   return values;
  }
  guard(requestAccept === '' || requestAccept === 'application/json');
  const plain:unknown = JSON.parse(text);
  const envelopes = Array.isArray(plain) ? plain : [plain]; guard(envelopes.length===names.length);
  return envelopes.map(rawEnvelope=>{
   const envelope=rawEnvelope as RpcEnvelope;
   guard(!envelope.error && envelope.result && Object.hasOwn(envelope.result,'data'));
   return observerSuperjson.deserialize(envelope.result.data);
  });
 } catch { throw new Error('Observer activity body unavailable; private details withheld.'); }
 finally { clearTimeout(timer);cancellation.cancel();cancellation.detach();cancellation.signal.removeEventListener('abort',cancelTransport);transport.abort(); }
}
export async function observerActivityResponses(url: string, status: number, requestAccept: string,
 body: Uint8Array, input: ObserverInput, signal?: AbortSignal): Promise<unknown[]> {
 const names=new URL(url).pathname.slice('/api/trpc/'.length).split(',');
 const values=await observerQueryResponses(url,status,requestAccept,body,input,signal);
 return values.filter((__unused,index)=>names[index]==='admin.activity');
}
export function safePath(base: string, name: string) {
 const path = containedPath(base, name); let cursor = path;
 for (;;) {
  if (existsSync(cursor)) guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
  if (cursor === resolve(base)) return path;
  const parent = dirname(cursor); guard(parent !== cursor); cursor = parent;
 }
}
/** require.resolve selects Playwright's CJS entry; its browser types live on default. */
export async function loadObserverChromium(base: string) {
 const require = createRequire(join(base, 'package.json'));
 const { default: playwright } = await import(pathToFileURL(require.resolve('playwright')).href);
 guard(typeof playwright?.chromium?.launch === 'function');
 return playwright.chromium as BrowserType;
}
function exclusiveJson(path: string, value: unknown) {
 const descriptor = openSync(path, 'wx', 0o600);
 try { writeSync(descriptor, JSON.stringify(value)); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
export function verifyObserverSource(base: string, input: ObserverInput) {
 const root = resolve(base, '../..'), sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
 const authored = createHash('sha256');
 const visit = (path: string) => {
  const name = relative(root, path).replaceAll('\\', '/');
  if (name === 'src/app/.well-known/workflow' || name.startsWith('src/app/.well-known/workflow/')) return;
  const stat = lstatSync(path); guard(!stat.isSymbolicLink());
  if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
  else if (stat.isFile()) authored.update(name).update('\0').update(readFileSync(path)).update('\0');
 };
 for (const name of ['src','public','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.js','postcss.config.cjs','tailwind.config.ts'])
  if (existsSync(join(root, name))) visit(join(root, name));
 const runner = createHash('sha256');
 for (const name of runnerFiles) runner.update(name).update('\0').update(readFileSync(safePath(base, `src/${name}`))).update('\0');
 assertObserverSource({ headSha: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDigest: authored.digest('hex'), lockDigest: sha256(readFileSync(join(root,'package-lock.json'))),
  runnerDigest: runner.digest('hex'), seedDigest: sha256(readFileSync(join(root,'scripts/seed-simulation.mjs'))),
  simulationLockDigest: sha256(readFileSync(safePath(base,'package-lock.json'))) }, input, process.platform);
}
/** SELECT-only, exact two-journal bindings; not a writable Store or recovery mechanism. */
export function observerJournal(input: ObserverInput, base: string) {
 const action = new DatabaseSync(safePath(base, `${input.stateDirectory}/activity.sqlite`), { readOnly: true });
 let telemetry: DatabaseSync | undefined;
 try {
  telemetry = new DatabaseSync(safePath(base, `${input.stateDirectory}/community-telemetry.sqlite`), { readOnly: true });
  const programs = action.prepare('SELECT run_id,digest FROM programs').all(), identities = action.prepare('SELECT run_id,id FROM journal_identity').all();
  const metadata = telemetry.prepare('SELECT run_id,key,value FROM metadata').all();
  const claims = action.prepare('SELECT user_id,owner,pid,driver FROM account_control').all();
  assertJournalOwnership(input,programs,identities,metadata,claims);
  // Keep only bounded safe fields. No raw summary/provider/credential payload is retained.
  const events = telemetry.prepare("SELECT id,json_extract(body,'$.agentId') AS agentId,json_extract(body,'$.kind') AS kind,json_extract(body,'$.state') AS state,json_extract(body,'$.occurredAt') AS occurredAt,json_extract(body,'$.data.outcome') AS outcome,json_extract(body,'$.data.driver') AS driver,json_extract(body,'$.data.lineId') AS lineId FROM events WHERE run_id=? ORDER BY sequence LIMIT 200001").all(input.runId);
  guard(events.length <= 200000 && !events.some(row => row.state === 'paused'));
  return events.map(row => ({ id: String(row.id), agentId: String(row.agentId), kind: String(row.kind), occurredAt: String(row.occurredAt),
   data: { outcome: String(row.outcome), driver: String(row.driver), lineId: String(row.lineId) } }));
 } finally { telemetry?.close(); action.close(); }
}
function ownedHosted(raw: HostedRunResponse, input: ObserverInput) {
 guard(raw?.run?.id === input.runId && raw.run.environment === 'staging' && raw.run.databaseIdentity === input.databaseIdentity);
 guard(raw.run.status === 'running' && raw.online === true && raw.run.settings?.controllerId === input.rootProof.controllerId);
 guard(Array.isArray(raw.agents) && raw.agents.length === 253);
 guard(raw.agents.every(member => input.cohort.some(account => account.id === member.id && account.userId === member.userId) && member.state !== 'paused'));
}
function hostedSuccess(raw: HostedActivity, input: ObserverInput, started: number, cutoff: number, begin: number, end: number): HostedSuccess | undefined {
 guard(raw.runId === input.runId && Number.isSafeInteger(raw.id) && raw.id > 0);
 if (raw.action !== 'simulation_action_result' || raw.details?.outcome !== 'success') return;
 const actionAt = new Date(raw.occurredAt).getTime();
 if (actionAt < started || actionAt >= cutoff) return;
 guard(input.cohort.some(account => account.userId === raw.actorId));
 return { eventId: raw.id, externalId: raw.externalId, actorId: raw.actorId!, actionAt,
  hostedStoredAt: new Date(raw.createdAt).getTime(), authoritativeFetchStartedAt: begin, authoritativeFetchFinishedAt: end };
}
/** Caller supplies an already decrypted strict input; this function never opens an env/credential file. */
export async function runHostedObserver(raw: unknown, options: ObserverOptions) {
 if (options.signal?.aborted) throw cancelled();
 const input = validateObserverInput(raw), base = resolve(options.toolsDirectory);
 const approved = selectFullRunApproval(input.runId);
 verifyObserverSource(base, input);
 const output = observerPath(base, options.outputName); safePath(base, options.outputName);
 guard(!existsSync(output)); mkdirSync(output, { mode: 0o700 });
 exclusiveJson(join(output,'admission.json'), { runId: input.runId, controllerId:input.rootProof.controllerId, createdAt: new Date().toISOString(), observerOnly: true, noAutomaticRetry: true });
 let browser: Browser | undefined, api: UiSession | undefined, page: Page | undefined;
 let network: ObserverNetwork | undefined, cdp: CDPSession | undefined;
 let phase = 'warmup', aborted = false, memoryFloorBreached = false, timer: ReturnType<typeof setInterval> | undefined;
 const cancellation = new ObserverCancellation(options.signal);
 let browserClosing: Promise<void> | undefined, apiClosing: Promise<void> | undefined, apiCloseComplete = false;
 const closeBrowser = () => browserClosing ??= browser ? browser.close() : Promise.resolve();
 const closeApi = () => apiClosing ??= (api ? api.close() : Promise.resolve()).then(() => { apiCloseComplete = true; });
 const consoleListener = (message:ConsoleMessage) => {if(message.type()==='error')diagnostics.consoleErrors++;};
 const pageErrorListener = () => {diagnostics.pageErrors++;};
 const detachObservers = () => {
  network?.close(); page?.off('console',consoleListener); page?.off('pageerror',pageErrorListener);
 };
 const onCancel = () => {
  aborted = true;
  detachObservers();
  // Dispose assigned resources to interrupt already-issued navigation/GET requests.
  if (browser) void closeBrowser().catch(() => undefined);
  if (api) void closeApi().catch(() => undefined);
 };
 cancellation.signal.addEventListener('abort', onCancel, { once: true });
 const execute = <T>(factory: () => Promise<T>, lateCleanup?: (value: T) => Promise<unknown>) => cancellation.run(factory, lateCleanup);
 const overallDeadline = Date.now()+330000;
 let minimumFreeGiB = Infinity, started = 0, cutoff = 0, completed = false;
 const hosted: HostedSuccess[] = [], rendered: Rendered[] = [], polls: Record<string, unknown>[] = [];
 const historyFeeds:{url:string;procedureIndex:number;value:ActivityPage}[]=[];
 const diagnostics: ObserverDiagnostics = { consoleErrors: 0, pageErrors: 0, failedRequests: 0, nonSuccessResponses: 0, blockedRequests: 0, feedBodyErrors: 0 };
 const result: Record<string, unknown> = { runId: input.runId, controllerId:input.rootProof.controllerId, observerIsParticipant: false, members: 253, memberBrowserUsers: 3, observerBrowsers: 1,
  requestedSeconds: 90, drainSeconds: 7, passed: false, browserClosed: false, apiClosed: false, suppressedPrefetches: 0, steps: [] };
 let evidence: ReturnType<typeof freshnessEvidence> | undefined;
 try {
  const source = readFileSync(safePath(base, `.state/runs/${input.runId}/activity.jsonl`), 'utf8');
  guard(createHash('sha256').update(source).digest('hex')===approved.sourceDigest);
  const browserIds=expectedObserverBrowserIds(input);
  guard(createHash('sha256').update(JSON.stringify({source,browserIds,origin:input.origin,databaseIdentity:input.databaseIdentity})).digest('hex')===input.programDigest);
  const activity = source.trim().split('\n').map(line => JSON.parse(line));
  const mutations = new Set(activity.filter(line => line.action !== 'browse').map(line => line.id));
  const warmupDeadline = Date.now() + 180000;
  for (;;) {
   cancellation.require();
   const events = observerJournal(input, base), continuity = communityContinuity(input.cohort.map(account => account.id), events);
   const browserMutations = input.cohort.filter(account => browserIds.includes(account.id) && events.some(event => event.agentId === account.id && event.kind === 'action_result' && event.data.outcome === 'success' && event.data.driver === 'browser' && mutations.has(event.data.lineId)));
   if (continuity.minimumSuccessesPerParticipant >= 3 && browserMutations.length === 3) break;
   guard(Date.now() < warmupDeadline); await cancellation.wait(2000);
  }
  phase = 'fresh-admission'; validateObserverInput(input); memoryAdmission(freemem() / 2 ** 30, true);
  minimumFreeGiB = freemem() / 2 ** 30;
  api = await execute(() => UiSession.signIn(input.origin, input.admin, input.protectionBypass), session => session.close());
  const require = createRequire(join(base,'package.json'));
  const superjson = (await execute(() => import(pathToFileURL(require.resolve('superjson')).href))).default;
  async function rpc(name:'admin.simulation',data:Record<string,unknown>,timeout?:number):Promise<HostedRunResponse>;
  async function rpc(name:'admin.activity',data:Record<string,unknown>,timeout?:number):Promise<ActivityPage>;
  async function rpc(name: 'admin.simulation' | 'admin.activity', data: Record<string, unknown>, timeout = 15000):Promise<HostedRunResponse|ActivityPage> {
   cancellation.require(); const url = `${input.origin}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify(superjson.serialize(data)))}`;
   guard(allowedObserverRequest(url,'GET',input));
   const response = await execute(() => api!.context.get(url, { timeout, maxRedirects: 0, maxRetries: 0 }), response => response.dispose());
   try { guard(response.status() === 200); const body = await execute(() => response.json()) as RpcEnvelope; guard(!body.error && body.result?.data); return superjson.deserialize(body.result.data) as HostedRunResponse|ActivityPage; }
   finally { await boundedObserverCleanup([response.dispose()], 5000); }
  }
  ownedHosted(await rpc('admin.simulation',{id:input.runId}),input);
  phase = 'browser-admission'; validateObserverInput(input); memoryAdmission(freemem() / 2 ** 30, true);
  const chromium = await execute(() => loadObserverChromium(base));
  browser = await execute<Browser>(() => chromium.launch({headless:true,timeout:30000}), ownedBrowser => ownedBrowser.close());
  const storageState = await execute(() => api!.context.storageState());
  const context = await execute(() => browser!.newContext({storageState,viewport:{width:1280,height:900},acceptDownloads:false,serviceWorkers:'block'}), context => context.close());
  await execute(() => context.route('**/*',route => {
   if (cancellation.signal.aborted) return route.abort();
   if (suppressedShellPrefetch(route.request().url(),route.request().method(),route.request().headers(),input)) {
    network!.noteSuppressedPrefetch(route.request().url(),route.request().method(),route.request().headers());
    result.suppressedPrefetches = Number(result.suppressedPrefetches) + 1;
    return route.fulfill({status:204,body:''});
   }
   if (!allowedObserverRequest(route.request().url(),route.request().method(),input)) { diagnostics.blockedRequests++; return route.abort(); }
   return route.continue({headers:{...route.request().headers(),...protectionHeaders(input.protectionBypass)}});
  }));
  page = await execute(() => context.newPage(), page => page.close()); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  page.on('console',consoleListener);
  page.on('pageerror',pageErrorListener);
  cdp=await execute(()=>context.newCDPSession(page!),session=>session.detach());
  network=new ObserverNetwork(cdp,input,(url,status,accept,body,signal)=>observerQueryResponses(url,status,accept,body,input,signal),capture=>{
   const names=new URL(capture.url).pathname.slice('/api/trpc/'.length).split(',');
   if(capture.phase==='history')for(const [index,name] of names.entries())if(name==='admin.activity')
    historyFeeds.push({url:capture.url,procedureIndex:index,value:capture.values[index] as ActivityPage});
   if(capture.phase!=='freshness')return;
   const values=capture.values.filter((__unused,index)=>names[index]==='admin.activity') as ActivityPage[];
   if(!values.length)return;
   const record:Record<string,unknown>={requestStartedAt:capture.requestStartedAt,headersAt:capture.headersAt,status:200,
    bodyFinishedAt:capture.finishedAt,bytes:capture.bytes,termination:capture.termination};
   record.pages=values.map(value=>{
    for(const item of value.items){const event=hostedSuccess(item,input,started,cutoff,capture.requestStartedAt,capture.finishedAt);if(event)hosted.push(event);}
    return {observedAt:new Date(value.observedAt).getTime(),events:value.items.map(item=>({eventId:item.id,actionAt:new Date(item.occurredAt).getTime(),hostedStoredAt:new Date(item.createdAt).getTime()}))};
   });polls.push(record);guard(hosted.length<=20000&&polls.length<=1000);
  },issue=>{
   if(issue==='request')diagnostics.failedRequests++;
   else if(issue==='status')diagnostics.nonSuccessResponses++;
   else diagnostics.feedBodyErrors++;
  },cancellation.signal);
  await execute(()=>network!.start());
  timer = setInterval(()=>{ const free = freemem()/2**30; minimumFreeGiB=Math.min(minimumFreeGiB,free);
   if(free<1.5||Date.now()>overallDeadline){memoryFloorBreached||=free<1.5;cancellation.cancel();} },500);
  phase = 'run-navigation'; guard((await execute(() => page!.goto(`${input.origin}/admin/simulations/${input.runId}`)))?.status()===200);
  await execute(() => page!.getByRole('heading',{name:'Live activity',exact:true}).waitFor({state:'visible'}));
  await execute(() => page!.getByRole('heading',{name:'Live activity',exact:true}).scrollIntoViewIfNeeded());
  const initial = await rpc('admin.activity',{runId:input.runId,limit:100});
  guard(initial.items.every(item=>item.runId===input.runId));
  let after = Math.max(0,...initial.items.map(item=>item.id));
  await execute(() => page!.evaluate(()=>{
   const samples=new Map<number,Rendered>();
   const capture=()=>{
    for(const node of document.querySelectorAll('.admin-event')){
     const id=/^Event #(\d+)/.exec(node.querySelector('small')?.textContent??''),at=node.querySelector('time')?.getAttribute('datetime');
     if(!id||!at||samples.has(Number(id[1])))continue;
     const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||!node.getClientRects().length)continue;
     const rect=node.getBoundingClientRect();samples.set(Number(id[1]),{eventId:Number(id[1]),renderedActionAt:Date.parse(at),renderedAt:Date.now(),inViewport:rect.bottom>0&&rect.top<innerHeight,renderTiming:'dom-mutation-observer'});
    }
   };
   const observer=new MutationObserver(capture);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['datetime','class','style']});capture();
   (window as unknown as ObserverWindow).__communityObserver={samples,observer};
  }));
  phase='freshness';started=Date.now();cutoff=started+90000;const end=cutoff+7000;network.setPhase('freshness');
  try {
   while(Date.now()<end){
    cancellation.require();memoryAdmission(freemem()/2**30,false);
    const begin=Date.now(),pollWindow=observerPollWindow(begin,end);
    if(pollWindow.kind==='drain') {
     await cancellation.wait(pollWindow.waitMilliseconds);
     const exact=await execute(() => page!.evaluate(()=>[...(window as unknown as ObserverWindow).__communityObserver.samples.values()]));
     rendered.push(...exact);guard(rendered.length<=1000000);break;
    }
    const items=await rpc('admin.activity',{runId:input.runId,after,limit:100},pollWindow.timeoutMilliseconds);
    guard(Array.isArray(items.items)&&items.items.length<=100);
    for(const item of items.items){guard(item.id>after);after=item.id;const record=hostedSuccess(item,input,started,cutoff,begin,Date.now());if(record)hosted.push(record);}
    guard(hosted.length<=20000&&polls.length<=1000);
    const exact=await execute(() => page!.evaluate(()=>[...(window as unknown as ObserverWindow).__communityObserver.samples.values()]));rendered.push(...exact);guard(rendered.length<=1000000);
    if(Date.now()<end)await cancellation.wait(Math.min(750,end-Date.now()));
   }
   completed=true;
  }finally{
   await execute(()=>network!.settle());
   if(!aborted){const exact=await execute(() => page!.evaluate(()=>{const value=(window as unknown as ObserverWindow).__communityObserver;value.observer.disconnect();return [...value.samples.values()];}));rendered.push(...exact);}
  }
  const local=observerJournal(input,base).filter(event=>event.kind==='action_result'&&event.data.outcome==='success') as LocalSuccess[];
  evidence=freshnessEvidence(input,started,cutoff,completed,local,hosted,rendered);
  exclusiveJson(join(output,'freshness.json'),{...evidence,browserPolls:polls,diagnostics,networkDiagnostics:network.diagnostics,minimumFreeGiB,
   timingNotes:'createdAt is transaction start, not commit; DOM/browser and runner action times share this VM; every missing/late event remains in the denominator.'});
  async function pauseDashboardReads() {
   const pause=page!.getByRole('button',{name:'Pause live updates',exact:true});
   if(await execute(()=>pause.count())===1)await execute(()=>pause.click());
   await execute(()=>page!.getByRole('button',{name:'Resume live updates',exact:true}).waitFor({state:'visible'}));
   await execute(()=>network!.settle());
  }
  // Only after the full live measurement/drain: use the real UI to stop future
  // polling, and finish already-started reads before intentionally navigating.
  await pauseDashboardReads();result.dashboardReadPauseAfterMeasurement=true;
  phase='history';network.setPhase('history');ownedHosted(await rpc('admin.simulation',{id:input.runId}),input);
  const prefix=`/admin/simulations/${input.runId}/agents/`,link=page.locator(`.admin-event-list a[href^="${prefix}"]`).filter({hasText:'Inspect simulation'}).first();
  await execute(() => link.waitFor({state:'visible'}));const href=await execute(() => link.getAttribute('href')),selected=input.cohort.find(member=>href===`${prefix}${member.id}`);guard(selected);
  await execute(() => link.click());
  await execute(() => page!.waitForURL(`${input.origin}${href}`));guard(page.url()===`${input.origin}${href}`);
  await execute(() => page!.getByRole('heading',{name:'This individual member',exact:true}).waitFor({state:'visible'}));
  await execute(() => page!.getByRole('heading',{name:'Live activity',exact:true}).waitFor({state:'visible'}));
  const deadline=Date.now()+15000;
  const actorFeeds=()=>historyFeeds.filter(record=>{const query=activityQuery(record.url,record.procedureIndex);return query.runId===input.runId&&query.actorId===selected.userId;});
  while(!actorFeeds().some(record=>record.value.items.length)){guard(Date.now()<deadline);await cancellation.wait(100);}
  guard(actorFeeds().every(record=>record.value.items.every(item=>item.runId===input.runId&&item.actorId===selected.userId)));
  const entity=await rpc('admin.activity',{runId:input.runId,entityType:'simulation',entityId:selected.id,limit:25});
  guard(entity.items.length>0&&entity.items.every(item=>item.runId===input.runId&&item.entityId===selected.id&&item.entityType==='simulation'&&item.actorId===selected.userId));
  let ids:number[]=[];
  for(;;){ids=await execute(() => page!.locator('.admin-event small').evaluateAll(nodes=>nodes.map(node=>Number(/^Event #(\d+)/.exec(node.textContent??'')?.[1]))));
   const known=new Set(actorFeeds().flatMap(record=>record.value.items.map(item=>item.id)));
   if(ids.length&&ids.every(id=>known.has(id)))break;
   guard(Date.now()<deadline);await cancellation.wait(100);
  }
  await execute(()=>network!.settle());
  result.history={href,agentId:selected.id,actorId:selected.userId,actualUiActorFilter:true,runScoped:true,renderedEvents:ids.length,entityOwnedEvents:entity.items.length,passed:true};
  guard(!aborted&&Object.values(diagnostics).every(count=>count===0));
  await execute(() => page!.screenshot({path:join(output,'history.png'),fullPage:false}));
  await pauseDashboardReads();network.setPhase('navigation');
  await execute(() => page!.goto(`${input.origin}/admin/simulations/${input.runId}`));
  await execute(() => page!.getByRole('heading',{name:'Live activity',exact:true}).waitFor({state:'visible'}));
  await execute(() => page!.screenshot({path:join(output,'dashboard.png'),fullPage:false}));
  await execute(()=>network!.settle());
  guard(!aborted&&Object.values(diagnostics).every(count=>count===0));result.passed=evidence.fiveSecondTargetMet;
 }catch{result.passed=false;result.failedPhase=phase;}
 finally{
  if(timer)clearInterval(timer);
  const parentCancelled = options.signal?.aborted === true;
  detachObservers();
  // Even a normal finish fences off late handlers; only this observer's resources are closed.
  cancellation.signal.removeEventListener('abort',onCancel);cancellation.cancel();cancellation.detach();
  const detachThenCloseBrowser = async()=>{
   // Detachment cannot race a normal browser close or indefinitely prevent it.
   const detached=await boundedObserverCleanup([cdp ? cdp.detach() : Promise.resolve()],5000);
   await closeBrowser();guard(detached);
  };
  const cleanup = [detachThenCloseBrowser(),closeApi(),...cancellation.pending];
  result.cleanupComplete=(await boundedObserverCleanup(cleanup))&&!cancellation.cleanupFailed;
  result.browserClosed=Boolean(result.cleanupComplete&&(!browser||!browser.isConnected()));
  result.apiClosed=Boolean(result.cleanupComplete&&apiCloseComplete);
  if(parentCancelled||!result.cleanupComplete||!result.browserClosed||!result.apiClosed)result.passed=false;
  // Preserve partial measurement rather than quietly replacing its denominator.
  if(started&&!evidence){try{const local=observerJournal(input,base).filter(event=>event.kind==='action_result'&&event.data.outcome==='success') as LocalSuccess[];
   evidence=freshnessEvidence(input,started,cutoff,false,local,hosted,rendered);exclusiveJson(join(output,'freshness.json'),{...evidence,diagnostics});}catch{result.denominatorUnavailable=true;}}
  Object.assign(result,{finishedAt:new Date().toISOString(),diagnostics,networkDiagnostics:network?.diagnostics??null,minimumFreeGiB:Number.isFinite(minimumFreeGiB)?minimumFreeGiB:null,memoryFloorBreached,observationAborted:aborted,
   parentCancelled,freshnessPassed:evidence?.fiveSecondTargetMet===true,fullHourAcceptance:false,noMemberActions:true,noControlActions:true});
  exclusiveJson(join(output,'receipt.json'),result);
 }
 return {receipt:result,outputDirectory:output};
}
