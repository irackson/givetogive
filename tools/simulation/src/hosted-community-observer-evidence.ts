import { relative, resolve, isAbsolute, sep } from 'node:path';
import { approved, uuid } from './hosted-community-policy.ts';
import { fixtureIds } from './provisioning.ts';

export type CohortMember = { id: string; userId: string };
export type ObserverInput = {
 protocolVersion: 1; runId: string; origin: string; databaseIdentity: string;
 headSha: string; authoredSourceDigest: string; gitAuthoredSourceDigest: string;
 lockDigest: string; runnerDigest: string; seedDigest: string; simulationLockDigest: string;
 stateDirectory: string; programDigest: string; actionJournalId: string; telemetryJournalId: string;
 admin: { id: string; userId: string; email: string; password: string };
 protectionBypass: string; cohort: CohortMember[];
 rootProof: { observedAt: string; deploymentId: string; controllerId: string; adminUserId: string;
  verifiedSynthetic: true; active: true; emailVerified: true; existingAdmin: true;
  transferAuthorized: true; canonical: true; protected: true; ready: true; noProviderSecrets: true };
};
export function guard(value: unknown): asserts value {
 if (!value) throw new Error('Observer guard rejected; private details withheld.');
}
function object(raw: unknown, keys: string[]): Record<string, unknown> {
 guard(raw !== null && typeof raw === 'object' && !Array.isArray(raw));
 const value = raw as Record<string, unknown>;
 guard(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
 return value;
}
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function validateObserverInput(raw: unknown, now = Date.now()): ObserverInput {
 const value = object(raw, ['protocolVersion','runId','origin','databaseIdentity','headSha',
  'authoredSourceDigest','gitAuthoredSourceDigest','lockDigest','runnerDigest','seedDigest',
  'simulationLockDigest','stateDirectory','programDigest','actionJournalId','telemetryJournalId',
  'admin','protectionBypass','cohort','rootProof']);
 guard(value.protocolVersion === 1 && /^[a-f0-9]{40}$/.test(String(value.headSha)));
 for (const key of ['runId','origin','databaseIdentity','authoredSourceDigest','gitAuthoredSourceDigest',
  'lockDigest','runnerDigest','seedDigest','stateDirectory','programDigest','actionJournalId','telemetryJournalId'] as const)
  guard(value[key] === approved[key]);
 guard(hash(value.simulationLockDigest));
 const admin = object(value.admin, ['id','userId','email','password']);
 guard(id(admin.id) && id(admin.userId) && typeof admin.email === 'string' && /^[a-z0-9._-]+@givetogive\.invalid$/.test(admin.email));
 guard(typeof admin.password === 'string' && admin.password.length >= 16 && admin.password.length <= 512 && !/[\r\n]/.test(admin.password));
 guard(typeof value.protectionBypass === 'string' && value.protectionBypass.length >= 16 && value.protectionBypass.length <= 1024 && !/[\r\n]/.test(value.protectionBypass));
 guard(Array.isArray(value.cohort) && value.cohort.length === 253);
 value.cohort.forEach((member, index) => {
  const account = object(member, ['id','userId']), expected = fixtureIds(approved.runId, index);
  guard(account.id === expected.id && account.userId === expected.userId && account.userId !== admin.userId);
 });
 const proof = object(value.rootProof, ['observedAt','deploymentId','controllerId','adminUserId',
  'verifiedSynthetic','active','emailVerified','existingAdmin','transferAuthorized','canonical','protected','ready','noProviderSecrets']);
 guard(typeof proof.observedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(proof.observedAt));
 const age = now - Date.parse(proof.observedAt);
 guard(Number.isFinite(now) && Number.isFinite(age) && age >= -5000 && age <= 300000);
 guard(proof.deploymentId === approved.deploymentId && id(proof.controllerId) && proof.adminUserId === admin.userId);
 for (const key of ['verifiedSynthetic','active','emailVerified','existingAdmin','transferAuthorized','canonical','protected','ready','noProviderSecrets']) guard(proof[key] === true);
 return raw as ObserverInput;
}
export function memoryAdmission(freeGiB: number, starting: boolean) {
 guard(Number.isFinite(freeGiB) && freeGiB >= (starting ? 2.5 : 1.5));
}
export function assertObserverSource(actual: { headSha: string; sourceDigest: string; lockDigest: string;
 runnerDigest: string; seedDigest: string; simulationLockDigest: string }, input: ObserverInput, platform: string) {
 guard(actual.headSha === input.headSha && actual.sourceDigest === (platform === 'win32' ? input.authoredSourceDigest : input.gitAuthoredSourceDigest));
 for (const key of ['lockDigest','runnerDigest','seedDigest','simulationLockDigest'] as const) guard(actual[key] === input[key]);
}
export function assertJournalOwnership(input: ObserverInput, programs: Record<string,unknown>[], identities: Record<string,unknown>[], metadata: Record<string,unknown>[], claims: Record<string,unknown>[]) {
 guard(programs.length === 1 && programs[0]!.run_id === input.runId && programs[0]!.digest === input.programDigest);
 guard(identities.length === 1 && identities[0]!.run_id === input.runId && identities[0]!.id === input.actionJournalId);
 guard(metadata.every(row => row.run_id === input.runId));
 guard(metadata.find(row => row.key === 'journalId')?.value === input.telemetryJournalId);
 guard(metadata.find(row => row.key === 'controllerId')?.value === input.rootProof.controllerId);
 // The current CLI writes lifecycle ONLY at finalization; absent is normal while running.
 guard(!metadata.some(row => row.key === 'lifecycle' && row.value !== 'running'));
 guard(!metadata.some(row => row.key === 'paused' && row.value === 'true'));
 guard(claims.length === 253 && new Set(claims.map(row => row.user_id)).size === 253);
 guard(claims.every(row => input.cohort.some(member => member.userId === row.user_id) && row.owner === input.rootProof.controllerId));
 guard(new Set(claims.map(row => row.pid)).size === 1 && claims.every(row => Number.isSafeInteger(row.pid) && Number(row.pid) > 0));
 guard(claims.filter(row => row.driver === 'browser').length === 3 && claims.filter(row => row.driver === 'script').length === 250);
 const browserUsers = new Set(expectedObserverBrowserIds(input).map(id => input.cohort.find(member => member.id === id)!.userId));
 guard(claims.every(row => row.driver === (browserUsers.has(row.user_id as string) ? 'browser' : 'script')));
}
/** Matches current targetTier/browserAccounts round-robin selection: first member in each declared cohort. */
export function expectedObserverBrowserIds(input: ObserverInput) {
 return [0,Math.round(253*.6),Math.round(253*.85)].map(index => input.cohort[index]!.id);
}
export function observerPath(root: string, name: string) {
 guard(/^\.state\/runs\/[a-f0-9-]{36}\/observer-[a-f0-9-]{36}(?:\/[a-z-]+\.(?:json|png))?$/.test(name));
 guard(name.split('/')[2] === approved.runId);
 const target = resolve(root, name), local = relative(resolve(root), target);
 guard(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`));
 return target;
}
function queryEnvelope(raw: unknown): Record<string, unknown> {
 guard(raw !== null && typeof raw === 'object' && !Array.isArray(raw));
 const envelope = raw as Record<string, unknown>;
 guard(Object.keys(envelope).every(key => key === 'json') && envelope.json !== null && typeof envelope.json === 'object' && !Array.isArray(envelope.json));
 return envelope.json as Record<string, unknown>;
}
export function activityQuery(urlString: string): Record<string, unknown> {
 const url = new URL(urlString), names = url.pathname.slice('/api/trpc/'.length).split(',');
 const index = names.indexOf('admin.activity'); guard(index >= 0);
 const raw = JSON.parse(url.searchParams.get('input') ?? 'null');
 return queryEnvelope(url.searchParams.get('batch') === '1' ? raw[String(index)] : raw);
}
export function activityEnvelopes(urlString: string, payload: unknown): unknown[] {
 const url = new URL(urlString), names = url.pathname.slice('/api/trpc/'.length).split(',');
 const values = Array.isArray(payload) ? payload : [payload]; guard(values.length === names.length);
 return values.filter((__unused, index) => names[index] === 'admin.activity');
}
export function exactHistoryQuery(url: string, runId: string, actorId: string): boolean {
 try { const query = activityQuery(url); return query.runId === runId && query.actorId === actorId; } catch { return false; }
}
/** Synthetic 204 only: never admits navigation, API reads or mutations to these shell links. */
export function suppressedShellPrefetch(urlString: string, method: string, headers: Record<string, string>, input: ObserverInput): boolean {
 try {
  const url = new URL(urlString);
  guard(method === 'GET' && url.origin === input.origin && !url.username && !url.password && !url.hash);
  guard(headers['next-router-prefetch'] === '1' && headers.rsc === '1');
  guard(headers['sec-fetch-dest'] !== 'document' && headers['sec-fetch-mode'] !== 'navigate');
  // Exact visible links in AdminNavigation/AdminLayout and the site's shared
  // header/footer. Return no application body, even for read-only shell pages.
  guard(['/admin','/admin/activity','/admin/users','/admin/payments','/admin/funds','/admin/simulations',
   '/','/asks','/funds','/support','/signup','/account/security'].includes(url.pathname)
   // ActivityTimeline/individual-member links, bounded to this exact synthetic cohort.
   || input.cohort.some(member=>url.pathname===`/admin/users/${encodeURIComponent(member.userId)}`
    || url.pathname===`/members/${encodeURIComponent(member.userId)}`));
  const runHistory = url.pathname === '/admin/activity' && url.searchParams.getAll('runId').length === 1
   && url.searchParams.get('runId') === input.runId;
  guard([...url.searchParams.keys()].every(key => key === '_rsc' || (runHistory && key === 'runId'))
   && url.searchParams.getAll('_rsc').length <= 1);
  return true;
 } catch { return false; }
}
export function allowedObserverRequest(urlString: string, method: string, input: ObserverInput): boolean {
 try {
  const url = new URL(urlString);
  guard(url.origin === input.origin && !url.username && !url.password && !url.hash);
  guard(['GET','HEAD','OPTIONS'].includes(method));
  const runPath = `/admin/simulations/${input.runId}`;
  if (url.pathname === runPath || input.cohort.some(member => url.pathname === `${runPath}/agents/${member.id}`)) return true;
  if (url.pathname.startsWith('/_next/') || url.pathname === '/favicon.ico' || url.pathname === '/api/auth/session') return true;
  guard(url.pathname.startsWith('/api/trpc/'));
  guard([...url.searchParams.keys()].every(key => ['input','batch'].includes(key)) && url.searchParams.getAll('input').length === 1);
  guard(url.searchParams.getAll('batch').length <= 1 && [null,'1'].includes(url.searchParams.get('batch')));
  const names = url.pathname.slice('/api/trpc/'.length).split(',');
  guard(names.length > 0 && names.length <= 2 && names.every(name => ['admin.simulation','admin.activity'].includes(name)));
  const raw = JSON.parse(url.searchParams.get('input') ?? 'null');
  const envelopes = url.searchParams.get('batch') === '1' ? names.map((__unused, index) => raw[String(index)]) : [raw];
  guard(envelopes.length === names.length);
  for (const [index, name] of names.entries()) {
   const data = queryEnvelope(envelopes[index]);
   if (name === 'admin.simulation') guard(Object.keys(data).length === 1 && data.id === input.runId);
   else {
    guard(Object.keys(data).every(key => ['runId','after','before','limit','actorId','entityType','entityId'].includes(key)) && data.runId === input.runId);
    if (data.limit !== undefined) guard(Number.isInteger(data.limit) && Number(data.limit) >= 1 && Number(data.limit) <= 100);
    for (const key of ['after','before']) if (data[key] !== undefined) guard(Number.isInteger(data[key]) && Number(data[key]) >= (key === 'before' ? 1 : 0));
    if (data.actorId !== undefined) guard(input.cohort.some(member => member.userId === data.actorId));
    if (data.entityId !== undefined) guard(data.entityType === 'simulation' && input.cohort.some(member => member.id === data.entityId));
    if (data.entityType !== undefined) guard(data.entityType === 'simulation' && data.entityId !== undefined);
   }
  }
  return true;
 } catch { return false; }
}
export type LocalSuccess = { id: string; agentId: string; occurredAt: string };
export type HostedSuccess = { eventId: number; externalId: string; actorId: string; actionAt: number;
 hostedStoredAt: number; authoritativeFetchStartedAt: number; authoritativeFetchFinishedAt: number };
export type Rendered = { eventId: number; renderedActionAt: number; renderedAt: number;
 inViewport: boolean; renderTiming: 'dom-mutation-observer' | 'snapshot-fallback' };
export function freshnessEvidence(input: ObserverInput, started: number, cutoff: number,
 completed: boolean, local: LocalSuccess[], hosted: HostedSuccess[], rendered: Rendered[]) {
 guard(Number.isFinite(started) && cutoff - started === 90000);
 const members = new Map(input.cohort.map(member => [member.id, member.userId]));
 const sample = new Map<string, Record<string, unknown>>();
 const hostedIds = new Map<number,string>();
 for (const event of hosted) {
  guard(Number.isSafeInteger(event.eventId) && event.eventId > 0 && event.externalId.startsWith(`simulation:${input.runId}:`) && uuid.test(event.externalId.slice(`simulation:${input.runId}:`.length)));
  guard(input.cohort.some(member => member.userId === event.actorId) && Number.isFinite(event.actionAt));
  if (event.actionAt < started || event.actionAt >= cutoff) continue;
  guard(!hostedIds.has(event.eventId) || hostedIds.get(event.eventId) === event.externalId);hostedIds.set(event.eventId,event.externalId);
  const prior = sample.get(event.externalId);
  if (prior) guard(prior.eventId === event.eventId && prior.actionAt === event.actionAt && prior.actorId === event.actorId);
  else sample.set(event.externalId, { ...event, hostedNeverObserved: false, localEventAt: null });
 }
 const localSeen = new Map<string, LocalSuccess>();
 for (const event of local) {
  guard(members.has(event.agentId) && uuid.test(event.id));
  const at = Date.parse(event.occurredAt); guard(Number.isFinite(at));
  if (at < started || at >= cutoff) continue;
  const prior = localSeen.get(event.id);
  if (prior) guard(prior.agentId === event.agentId && prior.occurredAt === event.occurredAt);
  localSeen.set(event.id, event);
  const externalId = `simulation:${input.runId}:${event.id}`, existing = sample.get(externalId);
  if (existing) {
   guard(existing.actionAt === at && existing.actorId === members.get(event.agentId)); existing.localEventAt = at;
  } else sample.set(externalId, { externalId, eventId: null, actorId: members.get(event.agentId), actionAt: at,
   localEventAt: at, hostedStoredAt: null, hostedNeverObserved: true });
 }
 const first = new Map<number, Rendered>();
 for (const record of rendered) {
  guard(Number.isSafeInteger(record.eventId) && record.eventId > 0 && Number.isFinite(record.renderedAt) && Number.isFinite(record.renderedActionAt));
  if (record.renderedAt > cutoff + 7000) continue;
  if (!first.has(record.eventId) || first.get(record.eventId)!.renderedAt > record.renderedAt) first.set(record.eventId, record);
 }
 for (const record of sample.values()) {
  const render = first.get(Number(record.eventId));
  if (render) Object.assign(record, { firstRenderedAt: render.renderedAt, renderTiming: render.renderTiming,
   renderedTimestampMatches: render.renderedActionAt === record.actionAt, inViewportAtFirstRender: render.inViewport,
   actionToRenderedMs: render.renderedAt - Number(record.actionAt) });
 }
 const measured = [...sample.values()], visible = measured.filter(item => item.firstRenderedAt !== undefined);
 const valid = (item: Record<string, unknown>) => item.renderedTimestampMatches === true && Number(item.actionToRenderedMs) >= 0 && Number(item.actionToRenderedMs) <= 5000;
 return { startedAt: new Date(started).toISOString(), cutoffAt: new Date(cutoff).toISOString(), requestedSeconds: 90,
  drainSeconds: 7, completed, authoritativeActions: measured.length, renderedActions: visible.length,
  localSuccessfulActions: localSeen.size, hostedObservedActions: measured.filter(item => !item.hostedNeverObserved).length,
  hostedNeverObservedActions: measured.filter(item => item.hostedNeverObserved).length,
  neverRenderedActions: measured.length - visible.length,
  lateActions: visible.filter(item => Number(item.actionToRenderedMs) > 5000).length,
  invalidTimingActions: visible.filter(item => Number(item.actionToRenderedMs) < 0 || item.renderedTimestampMatches !== true).length,
  maximumActionToRenderedMs: visible.length ? Math.max(...visible.map(item => Number(item.actionToRenderedMs))) : null,
  fiveSecondTargetMet: completed && measured.length > 0 && visible.length === measured.length && visible.every(valid),
  participantWindowCounts: input.cohort.map(member => ({ id: member.id, successes: measured.filter(item => item.actorId === member.userId).length })), measured };
}
