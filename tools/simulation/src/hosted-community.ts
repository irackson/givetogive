import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { freemem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chromium } from 'playwright';
import { runObserverCdpFixture, parseFixtureChildProof } from './hosted-community-observer-cdp-fixture.ts';
import { browserAccounts, validateCommunity } from './community-config.ts';
import { parseActivity } from './activity.ts';
import { fixtureIds } from './provisioning.ts';
import { CommunityControl } from './community-control.ts';
import { communityContinuity } from './community-evidence.ts';
import { supervisionEnvironment } from './community-supervisor.ts';
import { approved, containedPath, inputPaths, manifestSchema, requireHosted, runnerFiles, sha256, trustedExecution, validateManifest, type HostedManifest } from './hosted-community-policy.ts';
import { encryptionKey, fileBytes, privateFile, seal, unseal, validateFiles, type PrivateFile } from './hosted-community-bundle.ts';
import { bindObserverHandoff, collectObserverArtifacts, observerChildEnvironment } from './hosted-community-observer-parent.ts';
import { PrivateDraft } from './hosted-community-github.ts';
import { HostedAttention, HostedTelemetryAttention, linuxProcessIdentity } from './hosted-community-attention.ts';

const base = resolve(fileURLToPath(new URL('../', import.meta.url))), root = resolve(base, '../..');
let executionPhase = 'arguments';
const bundleSchema = z.object({ purpose: z.literal('fresh-input'), manifest: manifestSchema, files: z.unknown() }).strict();
const credentialSchema = z.object({ runId: z.string(), mode: z.literal('scripted'), origin: z.literal(approved.origin),
 databaseIdentity: z.literal(approved.databaseIdentity), runnerToken: z.string().min(20),
 agents: z.array(z.object({ id: z.string(), userId: z.string(), email: z.string(), password: z.string(),
  targetTier: z.enum(['neighbor', 'supporter', 'sustainer']).optional() }).strict()),
}).strict();
/** Provisioning's unused legacy placeholders are removed ONLY from the transport copy. */
export function transportCredentials(raw: unknown) {
 const legacy = z.object({ runId: z.string(), mode: z.literal('scripted'), origin: z.literal(approved.origin),
  databaseIdentity: z.literal(approved.databaseIdentity), runnerToken: z.string().min(20),
  agents: z.array(z.object({ id: z.string(), userId: z.string(), token: z.string().optional(), email: z.string(), password: z.string(),
   targetTier: z.enum(['neighbor', 'supporter', 'sustainer']).optional() }).strict()),
 }).strict().parse(raw);
 return credentialSchema.parse({ ...legacy, agents: legacy.agents.map(({ token: _unused, ...account }) => account) });
}
export function privatePath(name: string) {
 const path = containedPath(base, name);
 let current = path;
 for (;;) {
  if (existsSync(current)) requireHosted(!lstatSync(current).isSymbolicLink() && realpathSync(current) === current);
  if (current === base) return path;
  const parent = dirname(current); requireHosted(parent !== current); current = parent;
 }
}
/** SHM is a lock index, not journal content; copying a main DB requires an empty WAL. */
export function privateSQLiteSidecar(kind: string, size: number, regular: boolean, linked: boolean) {
 requireHosted(['-wal', '-shm'].includes(kind) && regular && !linked && Number.isSafeInteger(size)
  && (size === 0 || (kind === '-shm' && size === 32768)));
}
function sourceDigest() {
 const hash = createHash('sha256');
 function visit(path: string) {
  const name = relative(root, path).replaceAll('\\', '/');
  if (name === 'src/app/.well-known/workflow' || name.startsWith('src/app/.well-known/workflow/')) return;
  const stat = lstatSync(path); requireHosted(!stat.isSymbolicLink());
  if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
  else if (stat.isFile()) hash.update(name).update('\0').update(readFileSync(path)).update('\0');
 }
 for (const name of ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.js', 'postcss.config.cjs', 'tailwind.config.ts'])
  if (existsSync(join(root, name))) visit(join(root, name));
 return hash.digest('hex');
}
export function verifyLocalBindings(manifest: HostedManifest) {
 const actual = sourceDigest();
 // 9a3 is the original Windows upload; a84a is independently measured canonical Git blob bytes.
 requireHosted(actual === (process.platform === 'win32' ? approved.authoredSourceDigest : approved.gitAuthoredSourceDigest));
 requireHosted(sha256(readFileSync(join(root, 'package-lock.json'))) === approved.lockDigest);
 requireHosted(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() === manifest.headSha);
 const runner = createHash('sha256');
 for (const name of runnerFiles) runner.update(name).update('\0').update(readFileSync(join(base, 'src', name))).update('\0');
 requireHosted(runner.digest('hex') === manifest.runnerDigest && sha256(readFileSync(join(root, 'scripts/seed-simulation.mjs'))) === manifest.seedDigest);
 requireHosted(sha256(readFileSync(join(base, 'package-lock.json'))) === manifest.simulationLockDigest);
}
/** SELECT-only journal verification; never constructs writable Store/ActivityStore. */
export function inspectJournals(directory: string, manifest: HostedManifest, fresh: boolean) {
 const action = new DatabaseSync(join(directory, 'activity.sqlite'), { readOnly: true });
 const telemetry = new DatabaseSync(join(directory, 'community-telemetry.sqlite'), { readOnly: true });
 try {
  const programs = action.prepare('SELECT run_id,digest FROM programs').all(), ids = action.prepare('SELECT run_id,id FROM journal_identity').all();
  requireHosted(programs.length === 1 && programs[0]!.run_id === manifest.runId && programs[0]!.digest === manifest.programDigest);
  requireHosted(ids.length === 1 && ids[0]!.run_id === manifest.runId && ids[0]!.id === manifest.actionJournalId);
  const metadata = telemetry.prepare('SELECT run_id,key,value FROM metadata').all();
  requireHosted(metadata.every(row => row.run_id === manifest.runId));
  requireHosted(metadata.find(row => row.key === 'journalId')?.value === manifest.telemetryJournalId);
  const count = (db: DatabaseSync, table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  const result = { steps: count(action, 'steps'), pending: Number(action.prepare("SELECT COUNT(*) AS n FROM steps WHERE state='pending'").get()!.n),
   refs: count(action, 'refs'), claims: count(action, 'account_control'), events: count(telemetry, 'events'),
   outbox: Number(telemetry.prepare('SELECT COUNT(*) AS n FROM events WHERE delivered=0').get()!.n),
   controls: count(telemetry, 'controls'), checkpoints: count(telemetry, 'checkpoints') };
  if (fresh) { requireHosted(Object.values(result).every(n => n === 0)); requireHosted(metadata.length === 1 && metadata[0]!.key === 'journalId'); }
  return result;
 } finally { action.close(); telemetry.close(); }
}
export function validateInput(raw: unknown, now = Date.now()) {
 const bundle = bundleSchema.parse(raw), manifest = validateManifest(bundle.manifest, now);
 const files = validateFiles(bundle.files, inputPaths(manifest));
 const get = (name: string) => fileBytes(files.find(file => file.name === name)!);
 const credentials = credentialSchema.parse(JSON.parse(get(`.state/runs/${manifest.runId}/credentials.json`).toString()));
 requireHosted(credentials.runId === manifest.runId && credentials.agents.length === manifest.population);
 for (const [index, account] of credentials.agents.entries()) {
  const fixture = fixtureIds(manifest.runId, index);
  requireHosted(account.id === fixture.id && account.userId === fixture.userId && account.email === fixture.email);
 }
 validateCommunity(credentials, { browserUsers: 3, browserConcurrency: 3, apiConcurrency: 4, durationSeconds: manifest.durationSeconds, minimumFreeGiB: 1 });
 const source = get(`.state/runs/${manifest.runId}/activity.jsonl`).toString();
 requireHosted(sha256(source) === manifest.sourceDigest);
 const lines = parseActivity(source), accounts = new Set(credentials.agents.map(account => account.id));
 requireHosted(lines.every(line => accounts.has(line.user)) && new Set(lines.map(line => line.user)).size === accounts.size);
 requireHosted(sha256(JSON.stringify({ source, browserIds: browserAccounts(credentials, 3).map(account => account.id), origin: credentials.origin, databaseIdentity: credentials.databaseIdentity })) === manifest.programDigest);
 const protection = z.object({ vercelProtectionBypass: z.string().min(16).max(1024).regex(/^[^\r\n]+$/) }).strict().parse(JSON.parse(get('.state/protection.json').toString()));
 return { manifest, files, credentials, lines, bypass: protection.vercelProtectionBypass };
}
function materialize(value: ReturnType<typeof validateInput>) {
 for (const file of value.files) requireHosted(!existsSync(privatePath(file.name)));
 requireHosted(!existsSync(privatePath(`.state/runs/${value.manifest.runId}/supervision.jsonl`)));
 // Exclusive writes; interruption leaves partial state and fails closed on another invocation.
 for (const file of value.files) {
  const path = privatePath(file.name); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, fileBytes(file), { flag: 'wx', mode: 0o600 });
 }
 inspectJournals(privatePath(value.manifest.stateDirectory), value.manifest, true);
}
export function runtimeEnvironment(value: HostedManifest, environment = process.env) {
 return supervisionEnvironment({ ...environment, SIM_CREDENTIALS: `.state/runs/${value.runId}/credentials.json`,
  SIM_ACTIVITY_FILE: `.state/runs/${value.runId}/activity.jsonl`,
  SIM_STATE_DIRECTORY: value.stateDirectory, SIM_PROTECTION_BYPASS_FILE: '.state/protection.json',
  SIM_BROWSER_USERS: '3', SIM_BROWSER_CONCURRENCY: '3', SIM_API_CONCURRENCY: '4',
  SIM_DURATION_SECONDS: String(value.durationSeconds), SIM_MIN_FREE_GIB: '1' });
}
export function requireAdmission(manifest: HostedManifest, interrupted: boolean, uploadFailed: boolean, now = Date.now()) {
 validateManifest(manifest, now); requireHosted(!interrupted && !uploadFailed);
}
/** A second SIGTERM can terminate a once-handled supervisor mid-drain. Signal the exact child ONCE. */
export function gracefulShutdown(signalOwnedChild: () => void) {
 let requested = false;
 return () => { if (!requested) { requested = true; signalOwnedChild(); } };
}
async function browserSmoke() {
 requireHosted(freemem() / 2 ** 30 >= 2.5);
 // Exercise the EXACT supervisor allowlist/cache discovery, not a more permissive parent environment.
 const parts:Buffer[]=[];let stdoutBytes=0,stderrBytes=0,oversized=false;
 let proof:Record<string,unknown>;let stdout:Buffer|undefined;
 try{
 const code = await new Promise<number | null>((done, reject) => {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/hosted-community.ts', 'internal-browser-smoke'],
   { cwd: base, env: supervisionEnvironment({ PATH: process.env.PATH }), stdio: ['ignore', 'pipe', 'pipe'] });
  const stop=gracefulShutdown(()=>child.kill('SIGTERM'));
  child.stdout.on('data',(chunk:Buffer)=>{stdoutBytes+=chunk.length;if(stdoutBytes>65536){oversized=true;stop();}else parts.push(Buffer.from(chunk));});
  child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>65536)stop();});
  child.once('error', reject); child.once('close', done);
 });
 requireHosted(!oversized);stdout=Buffer.concat(parts);proof=parseFixtureChildProof(stdout,stderrBytes,code);
 }
 finally{stdout?.fill(0);for(const bytes of parts)bytes.fill(0);}
 console.log(JSON.stringify({ credentialFreeBrowserSmoke: true, exactChildEnvironment: true, externalRequests: 0, memberSignIns: 0,fixture:proof }));
}
async function internalBrowserSmoke() {
 requireHosted(!process.env.COMMUNITY_BUNDLE_KEY && !process.env.COMMUNITY_RECOVERY_TOKEN && !process.env.SIM_CREDENTIALS);
 const browser = await chromium.launch({ headless: true });
 let fixture:Record<string,unknown>|undefined;
 const cancellation=new AbortController();
 const stop=()=>{cancellation.abort();void browser.close().catch(()=>undefined);};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage(); await page.setContent('<h1>Credential-free hosted browser smoke</h1>');
  requireHosted(await page.locator('h1').textContent() === 'Credential-free hosted browser smoke');
  await context.close();
  fixture=await runObserverCdpFixture(browser,cancellation.signal);
 } finally { process.off('SIGTERM',stop);process.off('SIGINT',stop);await browser.close(); }
 requireHosted(!browser.isConnected()&&fixture&&!cancellation.signal.aborted);
 console.log(JSON.stringify({...fixture,browserClosed:true}));
}
async function snapshot(value: ReturnType<typeof validateInput>, key: Buffer, phase: string, summary: unknown, observerFiles: PrivateFile[] = []) {
 const files = [...value.files.filter(file => !file.name.endsWith('.sqlite')), ...observerFiles];
 // Each SQLite backup is individually consistent; paired live snapshots are NOT a resume authorization.
 for (const name of ['activity.sqlite', 'community-telemetry.sqlite']) {
  const source = new DatabaseSync(privatePath(`${value.manifest.stateDirectory}/${name}`), { readOnly: true });
  const target = privatePath(`${value.manifest.stateDirectory}/backup-${phase}-${name}`);
  requireHosted(!existsSync(target));
  try { await backup(source, target); files.push(privateFile(`${value.manifest.stateDirectory}/${name}`, readFileSync(target))); }
  finally { source.close(); if (existsSync(target)) rmSync(target); }
 }
 const supervision = `.state/runs/${value.manifest.runId}/supervision.jsonl`;
 if (existsSync(privatePath(supervision))) files.push(privateFile(supervision, readFileSync(privatePath(supervision))));
 return seal({ purpose: 'recovery-only', manifest: value.manifest, recordedAt: new Date().toISOString(), phase,
  crossJournalAtomic: false, automaticResumeAllowed: false, summary, files }, key);
}
function terminalEvidence(value: ReturnType<typeof validateInput>) {
 const state = inspectJournals(privatePath(value.manifest.stateDirectory), value.manifest, false);
 const telemetry = new DatabaseSync(privatePath(`${value.manifest.stateDirectory}/community-telemetry.sqlite`), { readOnly: true });
 try {
  const events = telemetry.prepare('SELECT body FROM events WHERE run_id=? ORDER BY sequence').all(value.manifest.runId).map(row => JSON.parse(String(row.body)));
  const continuity = communityContinuity(value.credentials.agents.map(account => account.id), events);
  const browserIds = browserAccounts(value.credentials, 3).map(account => account.id);
  const mutations = new Set(value.lines.filter(line => line.action !== 'browse').map(line => line.id));
  const participantMutations = value.credentials.agents.map(account => events.filter(event => event.agentId === account.id &&
   event.kind === 'action_result' && event.data?.outcome === 'success' && mutations.has(event.data?.lineId)).length);
  const browserMutations = browserIds.map(id => events.filter(event => event.agentId === id && event.kind === 'action_result' &&
   event.data?.outcome === 'success' && event.data?.driver === 'browser' && mutations.has(event.data?.lineId)).length);
  const lifecycle = telemetry.prepare("SELECT value FROM metadata WHERE run_id=? AND key='lifecycle'").get(value.manifest.runId)?.value;
  return { ...state, ...continuity, minimumBrowserMutations: Math.min(...browserMutations), minimumParticipantMutations: Math.min(...participantMutations), lifecycle: lifecycle === 'completed' ? 'completed' : 'incomplete',
   terminalClean: state.pending === 0 && state.outbox === 0 && state.claims === 0,
   independentHostedOwnershipAndFreshnessReviewRequired: true };
 } finally { telemetry.close(); }
}
async function hostedRun(mode: string) {
 executionPhase = 'private-input-wait';
 const key = encryptionKey(process.env.COMMUNITY_BUNDLE_KEY);
 const binding = { runId: process.env.COMMUNITY_RUN_ID ?? '', headSha: process.env.COMMUNITY_EXPECTED_SHA ?? '', releaseId: Number(process.env.COMMUNITY_RELEASE_ID) };
 requireHosted(/^[0-9]+$/.test(process.env.COMMUNITY_RELEASE_ID ?? '') && /^[a-f0-9-]{36}$/.test(binding.runId));
 const draft = new PrivateDraft(binding, process.env.COMMUNITY_RECOVERY_TOKEN ?? '');
 const encryptedInput = await draft.waitInput(() => console.log(JSON.stringify({ awaitingPrivateInput: true, maximumWaitSeconds: 600, memberAdmission: false })));
 executionPhase = 'private-input-validation';
 const value = validateInput(unseal(encryptedInput, key));
 requireHosted(value.manifest.mode === mode && value.manifest.runId === binding.runId && value.manifest.headSha === binding.headSha && value.manifest.releaseId === binding.releaseId);
 executionPhase = 'source-binding'; verifyLocalBindings(value.manifest);
 // A missing/failed encrypted checkpoint sink must be discovered BEFORE member admission.
 executionPhase = 'private-materialization'; await draft.inspect(); materialize(value);
 executionPhase = 'hosted-control-preflight';
 const manifest = await new CommunityControl(value.credentials, value.bypass, 3).preflight();
 requireHosted(manifest.runStatus === 'created');
 validateManifest(value.manifest); // Recheck five-minute provider/operator attestation after network/materialization.
 requireHosted(freemem() / 2 ** 30 >= 2.5);
 let child: ChildProcess | undefined, interrupted = false, checkpoint = 0, uploadFailed = false;
 const observerCancellation = new AbortController();
 let observerChild: ChildProcess | undefined, observerTask: Promise<void> | undefined;
 let observerFiles: PrivateFile[] = [], observerPassed = false, observerFinished = false, observerCleanupConfirmed = mode !== 'full-hour';
 let observerProcessClosed = mode !== 'full-hour';
 const signalObserverOnce = gracefulShutdown(() => { observerChild?.kill('SIGTERM'); });
 let supervisorGone = false, ownedRunner: ReturnType<typeof linuxProcessIdentity> | undefined;
 const runnerLive = () => {
  if (!ownedRunner) return false;
  try {
   const current = linuxProcessIdentity(readFileSync(`/proc/${ownedRunner.pid}/stat`, 'utf8'), ownedRunner.pid);
   return current.startTicks === ownedRunner.startTicks && current.state !== 'Z' &&
    realpathSync(`/proc/${ownedRunner.pid}/exe`) === realpathSync(process.execPath);
  } catch { return false; }
 };
 const signalSupervisorOnce = gracefulShutdown(() => { child?.kill('SIGTERM'); });
 const signalRunnerOnce = gracefulShutdown(() => {
  if (ownedRunner && runnerLive()) {
   try { process.kill(ownedRunner.pid, 'SIGTERM'); }
   catch { console.log(JSON.stringify({ ownedDrainDeliveryUnconfirmed: true, acceptancePassed: false })); }
  }
 });
 const stop = () => {
  interrupted = true;
  observerCancellation.abort(); signalObserverOnce();
  if (!supervisorGone) signalSupervisorOnce(); else signalRunnerOnce();
 };
 const attention = new HostedAttention(new Set(value.credentials.agents.map(account => account.id)), new Set(value.lines.map(line => line.id)), kind => {
  console.log(JSON.stringify({ earlyAttention: kind, acceptancePassed: false })); stop();
 }, pid => {
  if (ownedRunner || !child?.pid) return;
  try {
   const identity = linuxProcessIdentity(readFileSync(`/proc/${pid}/stat`, 'utf8'), pid);
   requireHosted(identity.parentPid === child.pid && realpathSync(`/proc/${pid}/exe`) === realpathSync(process.execPath));
   ownedRunner = identity;
  } catch { /* Never infer ownership or signal a PID without parent/executable/start-tick proof. */ }
 });
 const telemetryAttention = new HostedTelemetryAttention(new Set(value.credentials.agents.map(account => account.id)), kind => {
  console.log(JSON.stringify({ earlyAttention: kind, acceptancePassed: false })); stop();
 });
 let queue: Promise<void> = Promise.resolve();
 const enqueue = (phase: string, summary: unknown) => {
  queue = queue.then(async () => {
   const encrypted = await snapshot(value, key, phase, summary, observerFiles);
   await draft.upload(`community-recovery-${binding.runId}-${process.env.GITHUB_RUN_ID}-1-${phase}.g2genc`, encrypted);
   console.log(JSON.stringify({ encryptedRecoveryStored: true, phase }));
  }).catch(() => { uploadFailed = true; stop(); });
  return queue;
 };
 process.on('SIGINT', stop); process.on('SIGTERM', stop);
 let interval: ReturnType<typeof setInterval> | undefined, observation: ReturnType<typeof setInterval> | undefined;
 let exitCode: number | null = null, finished: Promise<number | null> | undefined;
 let summary: ReturnType<typeof terminalEvidence> | undefined;
 try {
  // First encrypted consistent checkpoint also proves write access/private retention before admission.
  executionPhase = 'private-pre-admission-checkpoint';
  await enqueue('checkpoint-00', { memberAdmission: false }); requireHosted(!uploadFailed);
  requireAdmission(value.manifest, interrupted, uploadFailed);
  executionPhase = 'member-controller';
  child = spawn(process.execPath, ['--experimental-strip-types', 'src/community-supervisor.ts', 'run'],
   { cwd: base, env: runtimeEnvironment(value.manifest), stdio: ['ignore', 'ignore', 'ignore'] });
  if (mode === 'full-hour') {
   observerTask = (async () => {
    let outputName: string | undefined;
    try {
     // Separate, late password-only synthetic-admin input. No admin identity
     // or broker credential is ever added to the member input/environment.
     const intent = privatePath(`.state/runs/${binding.runId}/observer-consumed.json`);
     writeFileSync(intent, JSON.stringify({ runId: binding.runId, headSha: binding.headSha,
      githubRunId: Number(process.env.GITHUB_RUN_ID), attemptedAt: new Date().toISOString(), noAutomaticRetry: true }), { flag:'wx', mode:0o600 });
     const bytes = await draft.waitObserverInput(value.manifest, String(process.env.GITHUB_RUN_ID), observerCancellation.signal,
      () => console.log(JSON.stringify({ awaitingObserverInput: true, maximumWaitSeconds: 300, observerIsParticipant: false })));
     let handoff;
     try { handoff = bindObserverHandoff(unseal(bytes,key), value.manifest, Number(process.env.GITHUB_RUN_ID)); }
     finally { bytes.fill(0); }
     outputName = handoff.outputName;
     observerCancellation.signal.throwIfAborted();
     requireHosted(freemem() / 2 ** 30 >= 2.5);
     // Worker independently rechecks the two local journals and actual
     // acquired controller before normal admin sign-in and browser launch.
     observerChild = spawn(process.execPath, ['--experimental-strip-types','src/hosted-community-observer-worker.ts'],
      { cwd:base, env:observerChildEnvironment(process.env), stdio:['pipe','ignore','ignore'] });
     let observerSpawnFailed = false;
     const observerExit = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done) => {
      observerChild!.once('error',() => { observerSpawnFailed = true; });
      observerChild!.once('close',(code,signal) => { observerProcessClosed = true; done({code,signal}); });
     });
     observerChild.stdin!.on('error', () => { observerCancellation.abort(); signalObserverOnce(); });
     observerChild.stdin!.end(JSON.stringify(handoff));
     const exit = await observerExit;
     const artifacts = collectObserverArtifacts(base, outputName); observerFiles = artifacts.files;
     observerCleanupConfirmed = artifacts.cleanupConfirmed;
     observerPassed = !observerSpawnFailed && exit.code === 0 && exit.signal === null && artifacts.acceptancePassed && !observerCancellation.signal.aborted;
     requireHosted(observerPassed);
    } catch {
     // Preserve any original partial files only after owned worker closure.
     if (outputName && observerProcessClosed) {
      try {
       const artifacts = collectObserverArtifacts(base,outputName);
       observerFiles = artifacts.files; observerCleanupConfirmed = artifacts.cleanupConfirmed;
      } catch { /* Failed capture is not acceptance or confirmed browser cleanup. */ }
     }
     console.log(JSON.stringify({ observerAttention: true, acceptancePassed: false })); stop();
    } finally { observerFinished = true; }
   })();
  }
  const startedAt = process.hrtime.bigint();
  const log = privatePath(`.state/runs/${value.manifest.runId}/supervision.jsonl`);
  observation = setInterval(() => {
   attention.poll(log);
   telemetryAttention.poll(privatePath(`${value.manifest.stateDirectory}/community-telemetry.sqlite`), value.manifest.runId);
  }, 1000);
  interval = setInterval(() => { checkpoint++; void enqueue(`checkpoint-${String(checkpoint).padStart(2, '0')}`, { ongoing: true, acceptancePassed: false }); }, 300000);
  finished = new Promise<number | null>((resolveExit, reject) => { child!.once('error', reject); child!.once('close', resolveExit); });
  exitCode = await finished;
  attention.finalize(log); supervisorGone = true;
  telemetryAttention.finalize(privatePath(`${value.manifest.stateDirectory}/community-telemetry.sqlite`), value.manifest.runId);
  attention.exited(exitCode, Number(process.hrtime.bigint() - startedAt) / 1e6, value.manifest.durationSeconds);
  if (interrupted && runnerLive()) {
   signalRunnerOnce(); const deadline = Date.now() + 120000;
   while (runnerLive() && Date.now() < deadline) await sleep(250);
   requireHosted(!runnerLive()); // Bounded graceful wait only; never force-kill or infer drained ownership.
  }
  if (interval) clearInterval(interval); await queue;
 } catch {
  interrupted = true;
  if (child && child.exitCode === null) { stop(); if (finished) await finished.catch(() => null); }
 } finally {
  if (interval) clearInterval(interval);
  if (observation) clearInterval(observation);
  if (observerTask) {
   if (!observerFinished) { observerCancellation.abort(); signalObserverOnce(); }
   let observerDeadline: ReturnType<typeof setTimeout> | undefined;
   try {
    await Promise.race([observerTask, new Promise<void>((done) => { observerDeadline = setTimeout(done,90000); })]);
   } finally { if (observerDeadline) clearTimeout(observerDeadline); }
   if (!observerFinished || !observerCleanupConfirmed || !observerPassed) interrupted = true;
  }
  await queue;
  try { summary = terminalEvidence(value); } catch { interrupted = true; }
  executionPhase = 'private-terminal-checkpoint';
  await enqueue('final', { ...summary, exitCode, interrupted, acceptancePassed: false,
   observerRequired: mode === 'full-hour', observerPassed, observerFinished, observerProcessClosed, observerCleanupConfirmed });
  console.log(JSON.stringify({ ...summary, exitCode, interrupted, encryptedRecoveryStored: !uploadFailed,
   fullAcceptancePassed: false, remainingAcceptance: 'Independent hosted ownership, original full-denominator freshness and history review' }));
  process.off('SIGINT', stop); process.off('SIGTERM', stop); key.fill(0);
 }
 executionPhase = 'terminal-evidence';
 requireHosted(exitCode === 0 && !interrupted && !uploadFailed && summary?.terminalClean && summary.lifecycle === 'completed' &&
  summary.minimumBrowserMutations > 0 && summary.minimumParticipantMutations > 0 && summary.minimumSuccessesPerParticipant >= 3);
 requireHosted(mode !== 'full-hour' || (summary.oneHourContinuousEvidence && observerPassed && observerFinished && observerCleanupConfirmed));
}
async function pack() {
 // Local operator command: no GitHub/network request, no member authentication or writable journal opens.
 const manifest = validateManifest(JSON.parse(readFileSync(process.env.COMMUNITY_MANIFEST_FILE ?? '', 'utf8')));
 verifyLocalBindings(manifest); inspectJournals(privatePath(manifest.stateDirectory), manifest, true);
 const files = inputPaths(manifest).map(name => {
  for (const suffix of ['-wal', '-shm']) if (name.endsWith('.sqlite') && existsSync(privatePath(name + suffix))) {
   const stat = lstatSync(privatePath(name + suffix)); privateSQLiteSidecar(suffix, stat.size, stat.isFile(), stat.isSymbolicLink());
  }
  const bytes = readFileSync(privatePath(name));
  if (name.endsWith('.sqlite') && existsSync(privatePath(name + '-wal'))) {
   const stat = lstatSync(privatePath(name + '-wal')); privateSQLiteSidecar('-wal', stat.size, stat.isFile(), stat.isSymbolicLink());
  }
  return privateFile(name, name.endsWith('credentials.json') ? Buffer.from(JSON.stringify(transportCredentials(JSON.parse(bytes.toString())))) : bytes);
 });
 const value = validateInput({ purpose: 'fresh-input', manifest, files });
 const target = process.env.COMMUNITY_ENCRYPTED_OUTPUT ?? '';
 requireHosted(/^\.state\/runs\/[a-f0-9-]{36}\/input\.g2genc$/.test(target) && target === `.state/runs/${manifest.runId}/input.g2genc`);
 const key = encryptionKey(process.env.COMMUNITY_BUNDLE_KEY);
 try { writeFileSync(privatePath(target), seal({ purpose: 'fresh-input', manifest: value.manifest, files }, key), { flag: 'wx', mode: 0o600 }); }
 finally { key.fill(0); }
 console.log(JSON.stringify({ encryptedInputCreated: true, runId: manifest.runId, reset: false, databaseWrites: 0, memberSignIns: 0 }));
}
async function main() {
 const command = process.argv[2] ?? '';
 if (command === 'pack') return pack();
 if (command === 'internal-browser-smoke') return internalBrowserSmoke();
 trustedExecution(process.env, command);
 if (command === 'browser-smoke') return browserSmoke();
 await hostedRun(command);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 await main().catch(() => { process.exitCode = 1; console.error(JSON.stringify({ hostedCommunityFailedClosed: true, phase: executionPhase, privateDiagnosticsWithheld: true, neverAutomaticallyRerun: true })); });
