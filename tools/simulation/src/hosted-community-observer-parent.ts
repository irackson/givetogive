import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { supervisionEnvironment } from './community-supervisor.ts';
import { selectFullRunApproval, containedPath, manifestSchema, requireHosted, sha256, uuid, type HostedManifest, type FullRunApproval } from './hosted-community-policy.ts';
import { privateFile, type PrivateFile } from './hosted-community-bundle.ts';
import { validateObserverInput } from './hosted-community-observer-evidence.ts';
import { fixtureIds } from './provisioning.ts';

/** Explicitly rebuild the child environment; broker, app and provider state never crosses this boundary. */
export function observerChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
 return { ...supervisionEnvironment({ PATH: environment.PATH }), G2G_HOSTED_OBSERVER_WORKER: '1' };
}

export function bindObserverHandoff(raw: unknown, fullManifest: HostedManifest, githubRunId: number) {
 const manifest = manifestSchema.parse(fullManifest);
 const approved = selectFullRunApproval(manifest.runId);
 requireHosted(manifest.mode === 'full-hour' && manifest.runId === approved.runId && manifest.population === 253 && manifest.durationSeconds === 4500);
 requireHosted(Number.isSafeInteger(githubRunId) && githubRunId > 0);
 const envelope = z.object({ protocolVersion: z.literal(1), purpose: z.literal('observer-input'),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/), githubRunId: z.number().int().positive(), input: z.unknown() }).strict().parse(raw);
 requireHosted(envelope.githubRunId === githubRunId && envelope.manifestDigest === sha256(JSON.stringify(fullManifest)));
 const input = validateObserverInput(envelope.input);
 requireHosted(uuid.test(input.rootProof.controllerId));
 for (const field of ['runId','headSha','runnerDigest','seedDigest','simulationLockDigest','stateDirectory','programDigest','actionJournalId','telemetryJournalId'] as const)
  requireHosted(input[field] === manifest[field]);
 requireHosted(input.authoredSourceDigest === manifest.release.authoredSourceDigest && input.lockDigest === manifest.release.lockDigest
  && input.gitAuthoredSourceDigest === approved.gitAuthoredSourceDigest && input.rootProof.deploymentId === manifest.release.deploymentId
  && manifest.sourceDigest === approved.sourceDigest && manifest.setupDigest === approved.setupDigest);
 return { input, outputName: `.state/runs/${input.runId}/observer-${input.rootProof.controllerId}` };
}

const artifactNames = ['admission.json','freshness.json','receipt.json','dashboard.png','history.png'] as const;
const namespacePattern = /^\.state\/runs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/observer-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
function safeArtifactPath(base: string, name: string) {
 const path = containedPath(base,name); let cursor = path;
 for (;;) {
  if (existsSync(cursor)) requireHosted(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
  if (cursor === resolve(base)) return path;
  const parent = dirname(cursor); requireHosted(parent !== cursor); cursor = parent;
 }
}
function record(raw: unknown): raw is Record<string, unknown> { return raw !== null && typeof raw === 'object' && !Array.isArray(raw); }
const networkCounters=['rawFailedRequests','expectedSuccessfulQueryAborts','unqualifiedFailedRequests','rawBodyFailures',
 'decodedQueries','captureUnavailable','capacityFailures','nonSuccessResponses'] as const;
const networkMaps={phases:['navigation','freshness','history','cleanup'],failures:['aborted','timeout','other'],
 bodyFailurePhases:['navigation','freshness','history','cleanup'],statusPhases:['navigation','freshness','history','cleanup'],
 captureStages:['unavailable','deadline','bytes','decode','scope','delivery']} as const;
const safeCounter=(raw:unknown):raw is number=>typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0;
/** Validate raw fixed categories, never subtract or rewrite them into a passing receipt. */
export function validObserverNetworkDiagnostics(raw:unknown):raw is Record<string,unknown> {
 if(!record(raw))return false;
 const hasSuppression=Object.hasOwn(raw,'operatorSuppressedPrefetchAborts');
 if(Object.keys(raw).length!==networkCounters.length+Object.keys(networkMaps).length+(hasSuppression?1:0)
  ||hasSuppression&&!safeCounter(raw.operatorSuppressedPrefetchAborts)
  ||!networkCounters.every(key=>safeCounter(raw[key])))return false;
 const sum=(name:keyof typeof networkMaps)=>Object.values(raw[name] as Record<string,number>).reduce((total,value)=>total+value,0);
 for(const [name,keys] of Object.entries(networkMaps)){
  const map=raw[name];if(!record(map)||Object.keys(map).length!==keys.length||!keys.every(key=>safeCounter(map[key])))return false;
 }
 const failures=raw.failures as Record<string,number>;
 const suppressed=hasSuppression?Number(raw.operatorSuppressedPrefetchAborts):0;
 return safeCounter(sum('phases'))&&safeCounter(sum('failures'))&&safeCounter(sum('bodyFailurePhases'))&&safeCounter(sum('statusPhases'))
  &&raw.rawFailedRequests===Number(raw.expectedSuccessfulQueryAborts)+suppressed+Number(raw.unqualifiedFailedRequests)
  &&sum('phases')===raw.rawFailedRequests&&sum('failures')===raw.rawFailedRequests
  &&Number(raw.expectedSuccessfulQueryAborts)+suppressed<=failures.aborted!&&Number(raw.expectedSuccessfulQueryAborts)<=Number(raw.decodedQueries)
  &&sum('bodyFailurePhases')===raw.rawBodyFailures&&sum('statusPhases')===raw.nonSuccessResponses
  &&Number(raw.captureUnavailable)<=Number(raw.rawBodyFailures)&&sum('captureStages')<=Number(raw.rawBodyFailures);
}
export function observerNetworkAcceptance(final:unknown,snapshot:unknown,diagnostics:unknown):boolean {
 if(!validObserverNetworkDiagnostics(final)||!validObserverNetworkDiagnostics(snapshot)||!record(diagnostics))return false;
 for(const name of networkCounters)if(Number(snapshot[name])>Number(final[name]))return false;
 if(Number(snapshot.operatorSuppressedPrefetchAborts??0)>Number(final.operatorSuppressedPrefetchAborts??0))return false;
 for(const [name,keys] of Object.entries(networkMaps))for(const key of keys)
  if(Number((snapshot[name] as Record<string,unknown>)[key])>Number((final[name] as Record<string,unknown>)[key]))return false;
 // A complete/valid JSONL teardown may be nonzero only in retained raw totals.
 // Navigation, unknown/partial/application/body/capture errors remain disqualifying.
 return Number(final.decodedQueries)>0&&Number(snapshot.decodedQueries)>0
  &&['unqualifiedFailedRequests','rawBodyFailures','captureUnavailable','capacityFailures','nonSuccessResponses'].every(key=>final[key]===0&&snapshot[key]===0)
  &&diagnostics.failedRequests===final.unqualifiedFailedRequests&&diagnostics.nonSuccessResponses===final.nonSuccessResponses
  &&diagnostics.feedBodyErrors===0;
}
function cleanupConfirmed(receipt: unknown, controllerId: string, approved: FullRunApproval) {
 return record(receipt) && receipt.runId === approved.runId && receipt.controllerId === controllerId
  && receipt.cleanupComplete === true && receipt.browserClosed === true && receipt.apiClosed === true;
}
function freshnessMeasurement(freshness: Record<string,unknown>, approved: FullRunApproval) {
 const start = typeof freshness.startedAt === 'string' ? Date.parse(freshness.startedAt) : NaN;
 const cutoff = typeof freshness.cutoffAt === 'string' ? Date.parse(freshness.cutoffAt) : NaN;
 if (!Number.isFinite(start) || !Number.isFinite(cutoff) || cutoff-start !== 90000
  || !Array.isArray(freshness.measured) || freshness.measured.length !== freshness.authoritativeActions
  || !Array.isArray(freshness.participantWindowCounts) || freshness.participantWindowCounts.length !== 253) return false;
 const members=Array.from({length:253},(__unused,index)=>fixtureIds(approved.runId,index));
 const actors=new Set(members.map(member=>member.userId)), events=new Set<number>(), external=new Set<string>();
 const counts=new Map(members.map(member=>[member.userId,0]));let maximum=0;
 for(const item of freshness.measured) {
  if(!record(item) || !Number.isSafeInteger(item.eventId) || Number(item.eventId)<1 || events.has(Number(item.eventId))
   || typeof item.externalId!=='string' || !item.externalId.startsWith(`simulation:${approved.runId}:`)
   || !uuid.test(item.externalId.slice(`simulation:${approved.runId}:`.length)) || external.has(item.externalId)
   || typeof item.actorId!=='string' || !actors.has(item.actorId) || typeof item.actionAt!=='number' || !Number.isFinite(item.actionAt)
   || item.actionAt<start || item.actionAt>=cutoff || typeof item.firstRenderedAt!=='number' || !Number.isFinite(item.firstRenderedAt)
   || item.renderedTimestampMatches!==true || item.hostedNeverObserved!==false
   || !['dom-mutation-observer','snapshot-fallback'].includes(String(item.renderTiming))
   || typeof item.actionToRenderedMs!=='number' || item.actionToRenderedMs!==item.firstRenderedAt-item.actionAt
   || item.actionToRenderedMs<0 || item.actionToRenderedMs>5000) return false;
  events.add(Number(item.eventId));external.add(item.externalId);counts.set(item.actorId,counts.get(item.actorId)!+1);
  maximum=Math.max(maximum,item.actionToRenderedMs);
 }
 if(freshness.maximumActionToRenderedMs!==maximum)return false;
 return freshness.participantWindowCounts.every((row,index)=>record(row)&&row.id===members[index]!.id
  && Number.isSafeInteger(row.successes)&&row.successes===counts.get(members[index]!.userId));
}
function acceptance(admission: unknown, freshness: unknown, receipt: unknown, controllerId: string, approved: FullRunApproval) {
 if (!record(admission) || !record(freshness) || !record(receipt)) return false;
 if (admission.runId !== approved.runId || admission.controllerId !== controllerId || admission.observerOnly !== true || admission.noAutomaticRetry !== true) return false;
 if (receipt.runId !== approved.runId || receipt.members !== 253 || receipt.observerIsParticipant !== false
  || receipt.memberBrowserUsers !== 3 || receipt.observerBrowsers !== 1 || receipt.requestedSeconds !== 90 || receipt.drainSeconds !== 7
  || receipt.passed !== true || receipt.freshnessPassed !== true || !cleanupConfirmed(receipt,controllerId,approved)
  || receipt.observationAborted !== false || receipt.memoryFloorBreached !== false || receipt.denominatorUnavailable === true
  || receipt.fullHourAcceptance !== false || receipt.noMemberActions !== true || receipt.noControlActions !== true || receipt.parentCancelled !== false
  || typeof receipt.minimumFreeGiB !== 'number' || !Number.isFinite(receipt.minimumFreeGiB) || receipt.minimumFreeGiB < 1.5) return false;
 if (!record(receipt.diagnostics)) return false;
 const diagnostics = receipt.diagnostics;
 if (Object.keys(diagnostics).length !== 6
  || !['consoleErrors','pageErrors','failedRequests','nonSuccessResponses','blockedRequests','feedBodyErrors'].every(key=>diagnostics[key] === 0)) return false;
 if(!observerNetworkAcceptance(receipt.networkDiagnostics,freshness.networkDiagnostics,diagnostics))return false;
 const suppressed=Number((receipt.networkDiagnostics as Record<string,unknown>).operatorSuppressedPrefetchAborts??0);
 if(suppressed>0&&(!safeCounter(receipt.suppressedPrefetches)||suppressed>receipt.suppressedPrefetches))return false;
 if (!record(receipt.history)) return false;
 const history = receipt.history;
 const member = Array.from({length:253},(__unused,index)=>fixtureIds(approved.runId,index)).find(member=>member.id === history.agentId);
 if (!member || history.actorId !== member.userId || history.href !== `/admin/simulations/${approved.runId}/agents/${member.id}`
  || history.passed !== true || history.actualUiActorFilter !== true || history.runScoped !== true
  || !Number.isSafeInteger(history.renderedEvents) || Number(history.renderedEvents) < 1
  || !Number.isSafeInteger(history.entityOwnedEvents) || Number(history.entityOwnedEvents) < 1) return false;
 if (freshness.fiveSecondTargetMet !== true || freshness.completed !== true || freshness.requestedSeconds !== 90 || freshness.drainSeconds !== 7
  || !Number.isSafeInteger(freshness.authoritativeActions) || Number(freshness.authoritativeActions) < 1
  || freshness.renderedActions !== freshness.authoritativeActions || freshness.hostedObservedActions !== freshness.authoritativeActions
  || !['hostedNeverObservedActions','neverRenderedActions','lateActions','invalidTimingActions'].every(key=>freshness[key] === 0)
  || typeof freshness.maximumActionToRenderedMs !== 'number' || freshness.maximumActionToRenderedMs < 0 || freshness.maximumActionToRenderedMs > 5000) return false;
 const admittedAt=typeof admission.createdAt==='string'?Date.parse(admission.createdAt):NaN;
 const finishedAt=typeof receipt.finishedAt==='string'?Date.parse(receipt.finishedAt):NaN;
 const startedAt=typeof freshness.startedAt==='string'?Date.parse(freshness.startedAt):NaN;
 const cutoffAt=typeof freshness.cutoffAt==='string'?Date.parse(freshness.cutoffAt):NaN;
 return Number.isFinite(admittedAt) && Number.isFinite(finishedAt) && admittedAt<=startedAt && finishedAt>=cutoffAt+7000
  && freshnessMeasurement(freshness,approved);
}

/** Original bytes are encrypted by the broker later; collection performs no writes, retries or credential reads. */
export function collectObserverArtifacts(base: string, namespace: string): { files: PrivateFile[]; acceptancePassed: boolean; cleanupConfirmed: boolean } {
 const match=namespacePattern.exec(namespace);requireHosted(match);
 const approved=selectFullRunApproval(match[1]);
 const controllerId=match[2]!;
 const directory = safeArtifactPath(base,namespace);
 if (!existsSync(directory)) return {files:[],acceptancePassed:false,cleanupConfirmed:false};
 requireHosted(lstatSync(directory).isDirectory());
 const found = readdirSync(directory);
 requireHosted(found.every(name=>artifactNames.some(allowed=>allowed===name)));
 const files: PrivateFile[] = [], json = new Map<string,unknown>();
 for (const name of artifactNames) {
  if (!found.includes(name)) continue;
  const path = safeArtifactPath(base,`${namespace}/${name}`), stat = lstatSync(path);
  const maximum = (name.endsWith('.png') ? 16 : 32) * 1024 * 1024;
  requireHosted(stat.isFile() && stat.size <= maximum);
  const bytes = readFileSync(path); requireHosted(bytes.length <= maximum);
  files.push(privateFile(`${namespace}/${name}`,bytes));
  if (name.endsWith('.json')) { try { json.set(name,JSON.parse(bytes.toString('utf8'))); } catch { /* Retain malformed partial evidence, never claim acceptance. */ } }
 }
 return {files,cleanupConfirmed:cleanupConfirmed(json.get('receipt.json'),controllerId,approved),
  acceptancePassed:files.length === artifactNames.length && acceptance(json.get('admission.json'),json.get('freshness.json'),json.get('receipt.json'),controllerId,approved)};
}
