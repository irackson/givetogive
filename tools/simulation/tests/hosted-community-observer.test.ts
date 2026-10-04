import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { jsonlStreamProducer } from '@trpc/server/unstable-core-do-not-import';
import superjson from 'superjson';
import { approved } from '../src/hosted-community-policy.ts';
import { fixtureIds } from '../src/provisioning.ts';
import { safePath, loadObserverChromium, boundedObserverReads, boundedObserverCleanup, ObserverCancellation, observerPollWindow, observerActivityResponses, runHostedObserver } from '../src/hosted-community-observer.ts';
import { validateObserverInput, memoryAdmission, observerPath, assertObserverSource, assertJournalOwnership,
 expectedObserverBrowserIds, allowedObserverRequest, suppressedShellPrefetch, activityEnvelopes, exactHistoryQuery, freshnessEvidence,
 type ObserverInput, type LocalSuccess, type HostedSuccess, type Rendered } from '../src/hosted-community-observer-evidence.ts';

const now=Date.parse('2026-10-03T23:00:00.000Z');
function input():ObserverInput {
 return {protocolVersion:1,runId:approved.runId,origin:approved.origin,databaseIdentity:approved.databaseIdentity,
  headSha:'a'.repeat(40),authoredSourceDigest:approved.authoredSourceDigest,gitAuthoredSourceDigest:approved.gitAuthoredSourceDigest,
  lockDigest:approved.lockDigest,runnerDigest:approved.runnerDigest,seedDigest:approved.seedDigest,simulationLockDigest:'b'.repeat(64),
  stateDirectory:approved.stateDirectory,programDigest:approved.programDigest,actionJournalId:approved.actionJournalId,telemetryJournalId:approved.telemetryJournalId,
  admin:{id:'synthetic-observer',userId:'synthetic-observer',email:'observer@givetogive.invalid',password:'synthetic-fixture-password-only'},protectionBypass:'synthetic-fixture-access-only',
  cohort:Array.from({length:253},(__unused,index)=>{const account=fixtureIds(approved.runId,index);return{id:account.id,userId:account.userId};}),
  rootProof:{observedAt:new Date(now).toISOString(),deploymentId:approved.deploymentId,controllerId:'fixture-controller',adminUserId:'synthetic-observer',
   verifiedSynthetic:true,active:true,emailVerified:true,existingAdmin:true,transferAuthorized:true,canonical:true,protected:true,ready:true,noProviderSecrets:true}};
}
const copy=<T>(value:T):T=>structuredClone(value);
const rpc=(name:string,data:unknown,batch=false)=>`${approved.origin}/api/trpc/${name}?${batch?'batch=1&':''}input=${encodeURIComponent(JSON.stringify(data))}`;
const query=(data:unknown)=>({json:data});
test('actual installed CJS Playwright entry exposes a usable Chromium type without launching a browser',async()=>{
 const chromium=await loadObserverChromium(fileURLToPath(new URL('..',import.meta.url)));
 assert.equal(chromium.name(),'chromium');
 assert.equal(typeof chromium.launch,'function');
});
test('strict input is synthetic/admin/password-only, full253 and independently fresh',()=>{
 const value=input();assert.equal(validateObserverInput(value,now),value);
 // These mutations deliberately violate nested/literal input types to exercise rejection.
 /* eslint-disable @typescript-eslint/no-explicit-any */
 for(const mutate of [
  (raw:any)=>{raw.STRIPE_SECRET_KEY='unexpected-private-value';},
  (raw:any)=>{raw.admin.token='unexpected-private-value';},
  (raw:any)=>{raw.admin.userId=raw.cohort[0].userId;raw.rootProof.adminUserId=raw.admin.userId;},
  (raw:any)=>{raw.admin.email='real@example.com';},
  (raw:any)=>{raw.rootProof.transferAuthorized=false;},
  (raw:any)=>{raw.rootProof.verifiedSynthetic=false;},
  (raw:any)=>{raw.rootProof.adminUserId='different-user';},
  (raw:any)=>{raw.rootProof.observedAt=new Date(now-300001).toISOString();},
  (raw:any)=>{raw.rootProof.observedAt=new Date(now+5001).toISOString();},
  (raw:any)=>{raw.rootProof.deploymentId='wrong';},
  (raw:any)=>{raw.runId='a90697e2-be08-42a4-b88c-f2f176fbed0a';},
  (raw:any)=>{raw.databaseIdentity=approved.databaseName;},
  (raw:any)=>{raw.runnerDigest='c'.repeat(64);},
  (raw:any)=>{raw.authoredSourceDigest=approved.gitAuthoredSourceDigest;},
  (raw:any)=>{raw.cohort.pop();},
  (raw:any)=>{raw.cohort[1]=raw.cohort[0];},
 ]){const raw=copy(value);mutate(raw);assert.throws(()=>validateObserverInput(raw,now),error=>error instanceof Error&&!error.message.includes('unexpected-private-value'));}
 /* eslint-enable @typescript-eslint/no-explicit-any */
});
test('actual source/lock/runner HEAD bindings preserve Windows vs Linux fingerprints',()=>{
 const value=input(),actual={headSha:value.headSha,sourceDigest:value.gitAuthoredSourceDigest,lockDigest:value.lockDigest,
  runnerDigest:value.runnerDigest,seedDigest:value.seedDigest,simulationLockDigest:value.simulationLockDigest};
 assert.doesNotThrow(()=>assertObserverSource(actual,value,'linux'));
 assert.throws(()=>assertObserverSource(actual,value,'win32'));
 assert.doesNotThrow(()=>assertObserverSource({...actual,sourceDigest:value.authoredSourceDigest},value,'win32'));
 for(const key of Object.keys(actual) as (keyof typeof actual)[])assert.throws(()=>assertObserverSource({...actual,[key]:'wrong'},value,'linux'));
});
test('memory admission cannot weaken 2.5/1.5 gates or accept NaN',()=>{
 assert.doesNotThrow(()=>memoryAdmission(2.5,true));assert.doesNotThrow(()=>memoryAdmission(1.5,false));
 for(const value of [NaN,Infinity,-1,2.499])assert.throws(()=>memoryAdmission(value,true));
 assert.throws(()=>memoryAdmission(1.499,false));
});
test('output containment is exact new run namespace, never historical/sibling/root',()=>{
 const name=`.state/runs/${approved.runId}/observer-11111111-1111-4111-8111-111111111111`;
 assert.equal(observerPath(resolve('tools/simulation'),name),resolve('tools/simulation',name));
 for(const bad of ['../simulation-evil/receipt.json','/tmp/observer.json','.',name+'/../credentials.json',name.replace(approved.runId,'b611f721-18fc-47f3-aa42-7bb12b361116')])assert.throws(()=>observerPath(resolve('tools/simulation'),bad));
});
test('existing linked private ancestors are rejected before any extraction/write',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'givetogive-observer-path-fixture-'));
 const base=join(fixture,'base'),outside=join(fixture,'outside');mkdirSync(base);mkdirSync(outside);
 try {
  symlinkSync(outside,join(base,'.state'),'junction');
  assert.throws(()=>safePath(base,'.state/observer.json'));
  assert.throws(()=>safePath(base,'../base-evil/observer.json'));
 }finally{
  // Only this invocation's unique, verified fixture directory is removed; no app/private state.
  assert.equal(resolve(dirname(fixture)),resolve(tmpdir()));assert.match(fixture,/givetogive-observer-path-fixture-[a-zA-Z0-9]+$/);
  rmSync(fixture,{recursive:true});
 }
});
test('journal identity/controller/cohort claims are checked without writes/PID signaling',()=>{
 const value=input(),programs=[{run_id:value.runId,digest:value.programDigest}],identities=[{run_id:value.runId,id:value.actionJournalId}];
 const metadata=[{run_id:value.runId,key:'journalId',value:value.telemetryJournalId},{run_id:value.runId,key:'controllerId',value:value.rootProof.controllerId}];
 const browsers=new Set(expectedObserverBrowserIds(value));
 const claims=value.cohort.map(member=>({user_id:member.userId,owner:value.rootProof.controllerId,pid:12345,driver:browsers.has(member.id)?'browser':'script'}));
 assert.doesNotThrow(()=>assertJournalOwnership(value,programs,identities,metadata,claims));
 assert.throws(()=>assertJournalOwnership(value,[{...programs[0],digest:'wrong'}],identities,metadata,claims));
 assert.throws(()=>assertJournalOwnership(value,programs,[{...identities[0],id:'wrong'}],metadata,claims));
 assert.throws(()=>assertJournalOwnership(value,programs,identities,[...metadata,{run_id:value.runId,key:'lifecycle',value:'completed'}],claims));
 assert.throws(()=>assertJournalOwnership(value,programs,identities,[...metadata,{run_id:value.runId,key:'paused',value:'true'}],claims));
 assert.throws(()=>assertJournalOwnership(value,programs,identities,metadata,claims.slice(1)));
 for(const key of ['user_id','owner','pid','driver']){const rows:Record<string,unknown>[]=copy(claims);rows[0]![key]='wrong';assert.throws(()=>assertJournalOwnership(value,programs,identities,metadata,rows));}
});
test('route boundary permits only own dashboard/auth-session/assets and scoped admin GETs',()=>{
 const value=input(),member=value.cohort[0]!;
 for(const url of [`${value.origin}/admin/simulations/${value.runId}`,`${value.origin}/admin/simulations/${value.runId}/agents/${member.id}`,
  `${value.origin}/_next/static/a.js`,`${value.origin}/api/auth/session`,rpc('admin.simulation',query({id:value.runId})),
  rpc('admin.activity',query({runId:value.runId,after:0,limit:100})),rpc('admin.activity',query({runId:value.runId,actorId:member.userId,limit:100})),
  rpc('admin.activity',query({runId:value.runId,entityType:'simulation',entityId:member.id,limit:25})),
  rpc('admin.simulation,admin.activity',{'0':query({id:value.runId}),'1':query({runId:value.runId,limit:100})},true)])assert.equal(allowedObserverRequest(url,'GET',value),true);
 for(const url of ['https://checkout.stripe.com/c/pay/private','https://example.com/a',`${value.origin}/admin/payments`,`${value.origin}/admin/simulations/foreign`,
  `${value.origin}/api/auth/callback/credentials`,rpc('admin.controlSimulation',query({runId:value.runId,type:'stop'})),
  rpc('admin.simulation',query({id:'foreign'})),rpc('admin.activity',query({runId:value.runId,actorId:'foreign'})),
  rpc('admin.activity',query({runId:value.runId,entityId:'foreign',entityType:'simulation'})),
  rpc('admin.activity',query({runId:value.runId,limit:101})),rpc('admin.activity,billing.createCheckout',{'0':query({runId:value.runId}),'1':query({})},true)])assert.equal(allowedObserverRequest(url,'GET',value),false);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(allowedObserverRequest(rpc('admin.activity',query({runId:value.runId})),method,value),false);
});
test('batched responses/history select the actual activity envelope and actor filter',()=>{
 const value=input(),member=value.cohort[0]!,url=rpc('admin.simulation,admin.activity',{'0':query({id:value.runId}),'1':query({runId:value.runId,actorId:member.userId})},true);
 const response=[{result:{data:'run'}},{result:{data:'activity'}}];
 assert.deepEqual(activityEnvelopes(url,response),[response[1]]);
 assert.equal(exactHistoryQuery(url,value.runId,member.userId),true);
 assert.equal(exactHistoryQuery(url,value.runId,value.cohort[1]!.userId),false);
 assert.equal(exactHistoryQuery(rpc('admin.activity',query({runId:value.runId,entityId:member.id,entityType:'simulation'})),value.runId,member.userId),false);
});
const bodyBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
async function streamingBody(data:Record<string,unknown>) {
 const stream=jsonlStreamProducer({data,serialize:superjson.serialize,formatError:()=>({message:'private-fixture-error',data:{code:'BAD_REQUEST',httpStatus:400}})});
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
test('actual negotiated browser JSONL query batch resolves activity data/dates without decoding simulation as activity',async()=>{
 const value=input(),member=value.cohort[0]!,url=rpc('admin.simulation,admin.activity',{'0':query({id:value.runId}),'1':query({runId:value.runId,actorId:member.userId})},true);
 const activity={items:[{id:12,runId:value.runId,actorId:member.userId,occurredAt:new Date(now)}],observedAt:new Date(now+500)};
 const bytes=await streamingBody({'0':Promise.resolve({result:Promise.resolve({data:Promise.resolve({run:{id:value.runId}})})}),
  '1':Promise.resolve({result:Promise.resolve({data:Promise.resolve(activity)})})});
 assert.deepEqual(await observerActivityResponses(url,200,'application/jsonl',bytes,value),[activity]);
 const plain=[{result:{data:superjson.serialize({run:{id:value.runId}})}},{result:{data:superjson.serialize(activity)}}];
 assert.deepEqual(await observerActivityResponses(url,200,'',bodyBytes(plain),value),[activity]);
 assert.deepEqual(await observerActivityResponses(url,200,'application/json',bodyBytes(plain),value),[activity]);
});
test('query decoding rejects application errors/malformed/big/foreign streams with fixed secret-free failure and no retries',async()=>{
 const value=input(),url=rpc('admin.activity',query({runId:value.runId,limit:100}));
 const rejected=await streamingBody({'0':Promise.resolve({error:{message:'private-fixture-error'}})});
 const rejection=(error:unknown)=>error instanceof Error&&error.message==='Observer activity body unavailable; private details withheld.';
 for(const [status,accept,body] of [[200,'application/jsonl',rejected],[403,'',bodyBytes({error:{message:'private-fixture-error'}})],
  [200,'',bodyBytes({result:{}})],[200,'',bodyBytes('private-fixture-error')],[200,'',new Uint8Array(1_048_577)],
  [200,'unexpected',bodyBytes({result:{data:superjson.serialize({items:[]})}})]] as const)
  await assert.rejects(()=>observerActivityResponses(url,status,accept,body,value),rejection);
 await assert.rejects(()=>observerActivityResponses('https://checkout.stripe.com/api/trpc/admin.activity',200,'',bodyBytes({}),value),rejection);
 const parent=new AbortController();parent.abort('private-fixture-error');
 await assert.rejects(()=>observerActivityResponses(url,200,'application/jsonl',rejected,value,parent.signal),rejection);
 const complete=await streamingBody({'0':Promise.resolve({result:{data:{items:[]}}})});
 await assert.rejects(()=>observerActivityResponses(url,200,'application/jsonl',complete.slice(0,-1),value),rejection);
 await assert.rejects(()=>observerActivityResponses(url,200,'application/jsonl',new Uint8Array([...complete,...new TextEncoder().encode('private-fixture-error\n')]),value),rejection);
 await assert.rejects(()=>observerActivityResponses(url,200,'',new Uint8Array([0xff]),value),rejection);
});
test('pending body reads have a bounded failure, never an indefinite observer wait',async()=>{
 await assert.doesNotReject(()=>boundedObserverReads([Promise.resolve()],5));
 await assert.rejects(()=>boundedObserverReads([new Promise<void>(()=>undefined)],5),/Observer read deadline exceeded/);
 await assert.rejects(()=>boundedObserverReads([],5001),/Observer guard rejected/);
});
test('shell prefetch is synthetic-204 eligible only for explicit exact same-origin Next GET prefetches',()=>{
 const value=input(),headers={'next-router-prefetch':'1',rsc:'1','sec-fetch-dest':'empty','sec-fetch-mode':'cors'};
 for(const path of ['/admin','/admin/activity','/admin/users','/admin/payments','/admin/funds','/admin/simulations',
  '/','/asks','/funds','/support','/signup','/account/security',`/admin/users/${encodeURIComponent(value.cohort[0]!.userId)}`,
  `/members/${encodeURIComponent(value.cohort[0]!.userId)}`]) {
  assert.equal(suppressedShellPrefetch(`${value.origin}${path}?_rsc=fixture`,'GET',headers,value),true);
  assert.equal(allowedObserverRequest(`${value.origin}${path}`,'GET',value),false,'Suppression must not admit actual navigation.');
  assert.equal(suppressedShellPrefetch(`${value.origin}${path}`,'GET',{},value),false);
 }
 for(const headersOverride of [{'next-router-prefetch':'0'},{rsc:'0'},{'sec-fetch-dest':'document'},{'sec-fetch-mode':'navigate'}])
  assert.equal(suppressedShellPrefetch(`${value.origin}/admin`,'GET',{...headers,...headersOverride},value),false);
 for(const url of [`${value.origin}/admin/`,`${value.origin}/admin/users/foreign`,`${value.origin}/admin/simulations/${value.runId}`,
  `${value.origin}/account/billing`,`${value.origin}/account/receiving`,`${value.origin}/signout`,`${value.origin}/giving`,
  `${value.origin}/members/${value.admin.userId}`,`${value.origin}/asks?saved=1`,
  `${value.origin}/api/trpc/admin.controlSimulation`,`${value.origin}/api/auth/session`,`${value.origin}/admin?input=anything`,
  `${value.origin}/admin?_rsc=a&_rsc=b`,`${value.origin}/admin#fragment`,'https://checkout.stripe.com/admin',
  `${value.origin.replace('https://','https://user@')}/admin`])assert.equal(suppressedShellPrefetch(url,'GET',headers,value),false);
 for(const method of ['HEAD','OPTIONS','POST','DELETE','PATCH','PUT'])assert.equal(suppressedShellPrefetch(`${value.origin}/admin`,method,headers,value),false);
});
test('verified recorded-history Link prefetch suppresses only exact own-run query, never navigation or any extra query',()=>{
 const value=input(),headers={'next-router-prefetch':'1',rsc:'1'},own=`${value.origin}/admin/activity?runId=${value.runId}`;
 for(const url of [own,`${own}&_rsc=fixture`]) {
  assert.equal(suppressedShellPrefetch(url,'GET',headers,value),true);
  assert.equal(allowedObserverRequest(url,'GET',value),false);
  assert.equal(suppressedShellPrefetch(url,'GET',{},value),false);
  assert.equal(suppressedShellPrefetch(url,'GET',{...headers,'sec-fetch-mode':'navigate'},value),false);
  assert.equal(suppressedShellPrefetch(url,'POST',headers,value),false);
 }
 for(const url of [`${own}&runId=${value.runId}`,`${own}&_rsc=a&_rsc=b`,`${own}&actorId=${value.cohort[0]!.userId}`,
  `${value.origin}/admin/activity?runId=foreign`,`${value.origin}/admin?runId=${value.runId}`,`${value.origin}/api/trpc/admin.activity?runId=${value.runId}`])
  assert.equal(suppressedShellPrefetch(url,'GET',headers,value),false);
});
test('already cancelled observer rejects before input/source/private reads or resource admission',async()=>{
 const parent=new AbortController();parent.abort(new Error('private cancellation detail'));
 let admitted=0;const cancellation=new ObserverCancellation(parent.signal);
 await assert.rejects(()=>cancellation.run(async()=>{admitted++;}),/Observer cancelled; private details withheld\./);
 await assert.rejects(()=>runHostedObserver(null,{toolsDirectory:'not-read',outputName:'not-created',signal:parent.signal}),/Observer cancelled; private details withheld\./);
 assert.equal(admitted,0);cancellation.detach();
});
test('warmup/measurement sleeps and pending response reads honour parent cancellation without retry',async()=>{
 const parent=new AbortController(),cancellation=new ObserverCancellation(parent.signal);
 const waiting=cancellation.wait(180000);
 const reading=boundedObserverReads([new Promise<void>(()=>undefined)],5000,parent.signal);
 parent.abort('private value');
 await assert.rejects(()=>waiting,/Observer cancelled; private details withheld\./);
 await assert.rejects(()=>reading,/Observer cancelled; private details withheld\./);
 let later=0;await assert.rejects(()=>cancellation.run(async()=>{later++;}),/Observer cancelled/);assert.equal(later,0);
 cancellation.detach();
});
test('in-flight resource creation is cancelled immediately and late owned resources close exactly once',async()=>{
 const parent=new AbortController(),cancellation=new ObserverCancellation(parent.signal);
 let finish:(value:{close:()=>Promise<void>})=>void=()=>undefined,admitted=0,closed=0;
 const creating=cancellation.run(()=>{admitted++;return new Promise<{close:()=>Promise<void>}>(resolve=>{finish=resolve;});},value=>value.close());
 await Promise.resolve();parent.abort();
 await assert.rejects(()=>creating,/Observer cancelled/);assert.equal(admitted,1);
 finish({close:async()=>{closed++;}});
 assert.equal(await boundedObserverCleanup([...cancellation.pending],100),true);assert.equal(closed,1);
 cancellation.cancel();assert.equal(closed,1);cancellation.detach();
});
test('owned cleanup is bounded and reports hanging or rejected closure rather than claiming success',async()=>{
 assert.equal(await boundedObserverCleanup([Promise.resolve()],5),true);
 assert.equal(await boundedObserverCleanup([new Promise(()=>undefined)],5),false);
 assert.equal(await boundedObserverCleanup([Promise.reject(new Error('private close error'))],5),false);
 await assert.rejects(()=>boundedObserverCleanup([],35001),/Observer guard rejected/);
});
test('final sub-second window drains DOM only while preserving exact cutoff and every local missing action',()=>{
 const end=now+97000;
 for(const remaining of [0,1,999])assert.deepEqual(observerPollWindow(end-remaining,end),{kind:'drain',waitMilliseconds:remaining});
 assert.deepEqual(observerPollWindow(end+1,end),{kind:'drain',waitMilliseconds:0});
 assert.deepEqual(observerPollWindow(end-1000,end),{kind:'read',timeoutMilliseconds:1000});
 assert.deepEqual(observerPollWindow(now,end),{kind:'read',timeoutMilliseconds:15000});
 for(const bad of [NaN,Infinity,now+.5])assert.throws(()=>observerPollWindow(bad,end));
 const x=sample(),lastLocal={...x.local,id:'00000000-0000-4000-8000-000000000002',occurredAt:new Date(now+89999).toISOString()};
 const evidence=freshnessEvidence(x.value,now,now+90000,true,[x.local,lastLocal],[x.hosted],[x.rendered]);
 assert.equal(evidence.authoritativeActions,2);assert.equal(evidence.hostedNeverObservedActions,1);assert.equal(evidence.neverRenderedActions,1);
 assert.equal(evidence.fiveSecondTargetMet,false);assert.equal(evidence.drainSeconds,7);
});
test('late cleanup failures remain attested after their pending promise has settled',async()=>{
 const parent=new AbortController(),cancellation=new ObserverCancellation(parent.signal);
 let finish:(value:string)=>void=()=>undefined;
 const creating=cancellation.run(()=>new Promise<string>(resolve=>{finish=resolve;}),async()=>{throw new Error('private resource-close error');});
 await Promise.resolve();parent.abort();await assert.rejects(()=>creating,/Observer cancelled/);
 finish('private resource');await boundedObserverCleanup([...cancellation.pending],100);
 await Promise.resolve();assert.equal(cancellation.cleanupFailed,true);cancellation.detach();
});
test('resource-resolution/cancellation microtask races never leak or double-close the owned resource',async()=>{
 for(let depth=0;depth<9;depth++) {
  const parent=new AbortController(),cancellation=new ObserverCancellation(parent.signal);let closed=0,admitted=false;
  const queueAbort=(remaining:number)=>queueMicrotask(()=>remaining?queueAbort(remaining-1):parent.abort());
  const creating=cancellation.run(async()=>{admitted=true;queueAbort(depth);return {close:async()=>{closed++;}};},resource=>resource.close());
  let returned:{close:()=>Promise<void>}|undefined;
  try { returned=await creating; } catch(error) { assert.match(String(error),/Observer cancelled/); }
  // If admission returned normally, the caller now owns closure rather than late-cleanup.
  if(returned)await returned.close();
  await boundedObserverCleanup([...cancellation.pending],100);
  assert.equal(closed,admitted?1:0);cancellation.detach();
 }
});
test('query/navigation cancellation invokes no second action and never auto-retries rejected work',async()=>{
 const parent=new AbortController(),cancellation=new ObserverCancellation(parent.signal);let admitted=0;
 const operation=cancellation.run(()=>{admitted++;return new Promise<void>(()=>undefined);});
 await Promise.resolve();parent.abort();await assert.rejects(()=>operation,/Observer cancelled/);
 for(const phase of ['query','navigation','screenshot','history'])await assert.rejects(()=>cancellation.run(async()=>{admitted++;}),/Observer cancelled/,`${phase} must not be admitted after cancellation`);
 assert.equal(admitted,1);cancellation.detach();
 const normal=new ObserverCancellation();let attempts=0;
 await assert.rejects(()=>normal.run(async()=>{attempts++;throw new Error('fixture failure');}),/fixture failure/);
 assert.equal(attempts,1);normal.detach();
});
function sample(){
 const value=input(),start=now,at=start+1000,id='00000000-0000-4000-8000-000000000001',member=value.cohort[0]!;
 const local:LocalSuccess={id,agentId:member.id,occurredAt:new Date(at).toISOString()};
 const hosted:HostedSuccess={eventId:101,externalId:`simulation:${value.runId}:${id}`,actorId:member.userId,actionAt:at,hostedStoredAt:at+100,authoritativeFetchStartedAt:at+200,authoritativeFetchFinishedAt:at+300};
 const rendered:Rendered={eventId:101,renderedActionAt:at,renderedAt:at+5000,inViewport:false,renderTiming:'dom-mutation-observer'};
 return{value,start,local,hosted,rendered};
}
test('full union deduplicates exact repeats without dropping zero-action participants',()=>{
 const x=sample(),e=freshnessEvidence(x.value,x.start,x.start+90000,true,[x.local,x.local],[x.hosted,x.hosted],[x.rendered]);
 assert.equal(e.fiveSecondTargetMet,true);assert.equal(e.authoritativeActions,1);assert.equal(e.localSuccessfulActions,1);
 assert.equal(e.participantWindowCounts.length,253);assert.equal(e.participantWindowCounts.filter(row=>row.successes===0).length,252);
});
test('unpublished, unrendered, late, timestamp mismatch, negative time and >7-sec render all fail honestly',()=>{
 const x=sample(),measure=(local:LocalSuccess[],hosted:HostedSuccess[],rendered:Rendered[],complete=true)=>freshnessEvidence(x.value,x.start,x.start+90000,complete,local,hosted,rendered);
 const unpublished=measure([x.local],[],[]);assert.equal(unpublished.authoritativeActions,1);assert.equal(unpublished.hostedNeverObservedActions,1);assert.equal(unpublished.fiveSecondTargetMet,false);
 assert.equal(measure([],[x.hosted],[]).neverRenderedActions,1);
 for(const rendered of [{...x.rendered,renderedAt:x.hosted.actionAt+5001},{...x.rendered,renderedAt:x.hosted.actionAt-1},
  {...x.rendered,renderedActionAt:x.hosted.actionAt+1},{...x.rendered,renderedAt:x.start+97001}])assert.equal(measure([x.local],[x.hosted],[rendered]).fiveSecondTargetMet,false);
 assert.equal(measure([x.local],[x.hosted],[x.rendered],false).fiveSecondTargetMet,false);
 assert.equal(measure([],[],[]).fiveSecondTargetMet,false);
});
test('conflicting identity, wrong cohort/window and malformed hosted correlation cannot pass',()=>{
 const x=sample(),run=(local:LocalSuccess[],hosted:HostedSuccess[])=>freshnessEvidence(x.value,x.start,x.start+90000,true,local,hosted,[x.rendered]);
 assert.throws(()=>run([x.local,{...x.local,agentId:x.value.cohort[1]!.id}],[x.hosted]));
 assert.throws(()=>run([x.local],[{...x.hosted,actorId:'foreign'}]));
 assert.throws(()=>run([x.local],[{...x.hosted,externalId:`simulation:${x.value.runId}:not-a-uuid`} ]));
 assert.throws(()=>run([x.local],[x.hosted,{...x.hosted,actionAt:x.hosted.actionAt+1}]));
 assert.throws(()=>run([x.local],[x.hosted,{...x.hosted,externalId:`simulation:${x.value.runId}:00000000-0000-4000-8000-000000000002`}]));
 assert.throws(()=>freshnessEvidence(x.value,x.start,x.start+89999,true,[],[],[]));
 assert.equal(run([{...x.local,occurredAt:new Date(x.start+90000).toISOString()}],[]).authoritativeActions,0);
});
test('prototype import is inert: no credential/env/state reads, auth, browser or network entrypoint',()=>{
 const url=new URL('../src/hosted-community-observer.ts',import.meta.url).href;
 const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const original=fs.readFileSync;fs.readFileSync=(path,...args)=>{if(/(?:\\.env|[\\\\/]\\.state[\\\\/])/.test(String(path)))throw Error('Private read forbidden');return original(path,...args);};syncBuiltinESMExports();
 globalThis.fetch=()=>{throw Error('Network forbidden');};await import(${JSON.stringify(url)});process.stdout.write('inert');`;
 const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,'Credential-free import must succeed.');assert.equal(child.stdout,'inert');
});
test('prototype retains pre-navigation diagnostics, SELECT-only journals and no automatic CLI',()=>{
 const source=readFileSync(new URL('../src/hosted-community-observer.ts',import.meta.url),'utf8');
 assert.ok(source.indexOf("page.on('console'")<source.indexOf("phase = 'run-navigation'"));
 assert.ok(source.indexOf("page.on('pageerror'")<source.indexOf("phase = 'run-navigation'"));
 assert.ok(source.includes('readOnly: true'));assert.ok(source.includes('maxRetries: 0'));
 assert.ok(!source.includes('process.env'));assert.ok(!source.includes('.mutate('));assert.ok(!source.includes("new Store("));
 assert.ok(!source.includes('process.argv'));assert.ok(!source.includes('console.log'));assert.ok(!source.includes('storage-state.json'));
 assert.ok(source.includes('signal?: AbortSignal'));assert.ok(source.includes('boundedObserverCleanup(cleanup)'));
 assert.equal((source.match(/controllerId:input\.rootProof\.controllerId/g)??[]).length,2);
 assert.ok(source.includes("route.fulfill({status:204,body:''})"));
});
