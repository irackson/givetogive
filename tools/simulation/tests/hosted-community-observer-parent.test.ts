import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observerChildEnvironment, bindObserverHandoff, collectObserverArtifacts, validObserverNetworkDiagnostics, observerNetworkAcceptance } from '../src/hosted-community-observer-parent.ts';
import { approved, sha256, type HostedManifest } from '../src/hosted-community-policy.ts';
import { fileBytes, seal, unseal, type PrivateFile } from '../src/hosted-community-bundle.ts';
import { fixtureIds } from '../src/provisioning.ts';

const controllerId='12345678-1234-1234-1234-123456789abc';
const manifest: HostedManifest={protocolVersion:1,mode:'full-hour',runId:approved.runId,headSha:'2'.repeat(40),releaseId:99,
 stateDirectory:approved.stateDirectory,population:253,durationSeconds:4500,sourceDigest:approved.sourceDigest,
 programDigest:approved.programDigest,actionJournalId:approved.actionJournalId,telemetryJournalId:approved.telemetryJournalId,
 runnerDigest:approved.runnerDigest,setupDigest:approved.setupDigest,seedDigest:approved.seedDigest,simulationLockDigest:'4'.repeat(64),
 release:{observedAt:new Date().toISOString(),deploymentId:approved.deploymentId,authoredSourceDigest:approved.authoredSourceDigest,
 lockDigest:approved.lockDigest,canonical:true,protected:true,ready:true,independentReadinessPassed:true,noOtherControllers:true,
 noMemberTokens:true,cloudBrowserSmokePassed:true,authenticatedSmokePassed:true}};
function handoff() {
 const input={protocolVersion:1,runId:approved.runId,origin:approved.origin,databaseIdentity:approved.databaseIdentity,
 headSha:manifest.headSha,authoredSourceDigest:approved.authoredSourceDigest,gitAuthoredSourceDigest:approved.gitAuthoredSourceDigest,
 lockDigest:approved.lockDigest,runnerDigest:approved.runnerDigest,seedDigest:approved.seedDigest,simulationLockDigest:manifest.simulationLockDigest,
 stateDirectory:approved.stateDirectory,programDigest:approved.programDigest,actionJournalId:approved.actionJournalId,telemetryJournalId:approved.telemetryJournalId,
 admin:{id:'public-admin',userId:'public-admin',email:'observer@givetogive.invalid',password:'public-offline-password-123'},
 protectionBypass:'public-offline-protection-123',cohort:Array.from({length:253},(__unused,index)=>{const {id,userId}=fixtureIds(approved.runId,index);return{id,userId};}),
 rootProof:{observedAt:new Date().toISOString(),deploymentId:approved.deploymentId,controllerId,adminUserId:'public-admin',
 verifiedSynthetic:true,active:true,emailVerified:true,existingAdmin:true,transferAuthorized:true,canonical:true,protected:true,ready:true,noProviderSecrets:true}};
 return {protocolVersion:1,purpose:'observer-input',manifestDigest:sha256(JSON.stringify(manifest)),githubRunId:123,input};
}
const namespace=`.state/runs/${approved.runId}/observer-${controllerId}`;
function networkProof(){return {rawFailedRequests:1,expectedSuccessfulQueryAborts:1,unqualifiedFailedRequests:0,rawBodyFailures:0,
 decodedQueries:2,captureUnavailable:0,capacityFailures:0,nonSuccessResponses:0,
 phases:{navigation:0,freshness:1,history:0,cleanup:0},failures:{aborted:1,timeout:0,other:0},
 bodyFailurePhases:{navigation:0,freshness:0,history:0,cleanup:0},statusPhases:{navigation:0,freshness:0,history:0,cleanup:0},
 captureStages:{unavailable:0,deadline:0,bytes:0,decode:0,scope:0,delivery:0}};}
function fixture() {
 const base=mkdtempSync(join(tmpdir(),'g2g-observer-offline-'));mkdirSync(join(base,namespace),{recursive:true});
 const member=fixtureIds(approved.runId,0);
 const start=Date.parse('2026-10-03T12:00:00Z');
 const admission={runId:approved.runId,controllerId,createdAt:new Date(start-1000).toISOString(),observerOnly:true,noAutomaticRetry:true};
 const freshness={networkDiagnostics:networkProof(),fiveSecondTargetMet:true,completed:true,requestedSeconds:90,drainSeconds:7,authoritativeActions:1,renderedActions:1,
 hostedObservedActions:1,hostedNeverObservedActions:0,neverRenderedActions:0,lateActions:0,invalidTimingActions:0,maximumActionToRenderedMs:123,
 startedAt:new Date(start).toISOString(),cutoffAt:new Date(start+90000).toISOString(),
 participantWindowCounts:Array.from({length:253},(__unused,index)=>({id:fixtureIds(approved.runId,index).id,successes:index===0?1:0})),
 measured:[{eventId:1,externalId:`simulation:${approved.runId}:11111111-1111-1111-1111-111111111111`,actorId:member.userId,
 actionAt:start+1000,firstRenderedAt:start+1123,actionToRenderedMs:123,renderedTimestampMatches:true,hostedNeverObserved:false,renderTiming:'dom-mutation-observer'}]};
 const receipt={networkDiagnostics:networkProof(),runId:approved.runId,controllerId,cleanupComplete:true,members:253,observerIsParticipant:false,memberBrowserUsers:3,observerBrowsers:1,
 requestedSeconds:90,drainSeconds:7,passed:true,freshnessPassed:true,browserClosed:true,apiClosed:true,observationAborted:false,
 memoryFloorBreached:false,parentCancelled:false,minimumFreeGiB:2.5,finishedAt:new Date(start+100000).toISOString(),fullHourAcceptance:false,noMemberActions:true,noControlActions:true,
 diagnostics:{consoleErrors:0,pageErrors:0,failedRequests:0,nonSuccessResponses:0,blockedRequests:0,feedBodyErrors:0},
 history:{href:`/admin/simulations/${approved.runId}/agents/${member.id}`,agentId:member.id,actorId:member.userId,
 actualUiActorFilter:true,runScoped:true,renderedEvents:1,entityOwnedEvents:1,passed:true}};
 const write=(name:string,value:unknown)=>writeFileSync(join(base,namespace,name),JSON.stringify(value,null,2)+'\r\n');
 write('admission.json',admission);write('freshness.json',freshness);write('receipt.json',receipt);
 for(const name of ['dashboard.png','history.png'])writeFileSync(join(base,namespace,name),Buffer.from([137,80,78,71,13,10,26,10,0,255]));
 return {base,admission,freshness,receipt,write,close:()=>rmSync(base,{recursive:true,force:true})};
}
test('observer child receives only PATH and fixed worker marker, never inherited secrets or member state',()=>{
 const environment={PATH:'public-runtime',Path:'discard-path',COMMUNITY_RECOVERY_TOKEN:'discard',COMMUNITY_BUNDLE_KEY:'discard',
 STRIPE_SECRET_KEY:'discard',DATABASE_URL:'discard',NODE_OPTIONS:'discard',SIM_CREDENTIALS:'discard',PASSWORD:'discard',GITHUB_TOKEN:'discard'};
 assert.deepEqual(observerChildEnvironment(environment),{PATH:'public-runtime',G2G_HOSTED_OBSERVER_WORKER:'1'});
 assert.deepEqual(observerChildEnvironment({}),{G2G_HOSTED_OBSERVER_WORKER:'1'});
});
test('new raw network proof is exact, bounded numeric, internally consistent and monotonic; no failure category is waived',()=>{
 const good=networkProof(),diagnostics={failedRequests:0,nonSuccessResponses:0,feedBodyErrors:0};
 assert.equal(validObserverNetworkDiagnostics(good),true);assert.equal(observerNetworkAcceptance(good,good,diagnostics),true);
 for(const name of ['rawFailedRequests','expectedSuccessfulQueryAborts','unqualifiedFailedRequests','rawBodyFailures','decodedQueries','captureUnavailable','capacityFailures','nonSuccessResponses'])
  for(const bad of [NaN,Infinity,-1,.5,Number.MAX_SAFE_INTEGER+1,'0'])assert.equal(validObserverNetworkDiagnostics({...good,[name]:bad}),false);
 for(const patch of [{private:'unknown'}, {rawFailedRequests:2},{decodedQueries:0},{failures:{aborted:0,timeout:1,other:0}},
  {phases:{navigation:0,freshness:0,history:0,cleanup:0}}, {captureStages:{...good.captureStages,unknown:0}},
  {bodyFailurePhases:{navigation:0,freshness:0,history:0}}, {statusPhases:{...good.statusPhases,history:1}}])
  assert.equal(validObserverNetworkDiagnostics({...good,...patch}),false);
 for(const patch of [{capacityFailures:1},{rawBodyFailures:1,bodyFailurePhases:{...good.bodyFailurePhases,history:1},captureStages:{...good.captureStages,decode:1}},
  {rawFailedRequests:2,unqualifiedFailedRequests:1,phases:{...good.phases,history:1},failures:{...good.failures,other:1}},
  {nonSuccessResponses:1,statusPhases:{...good.statusPhases,history:1}}]){
  const value={...good,...patch};assert.equal(validObserverNetworkDiagnostics(value),true);
  assert.equal(observerNetworkAcceptance(value,good,diagnostics),false);
 }
 const later={...good,rawFailedRequests:2,expectedSuccessfulQueryAborts:2,decodedQueries:3,
  phases:{...good.phases,history:1},failures:{...good.failures,aborted:2}};
 assert.equal(observerNetworkAcceptance(later,good,diagnostics),true);
 assert.equal(observerNetworkAcceptance(good,later,diagnostics),false);
 const shifted={...good,phases:{...good.phases,freshness:0,history:1}};
 assert.equal(observerNetworkAcceptance(shifted,good,diagnostics),false);
 assert.equal(observerNetworkAcceptance(good,undefined,diagnostics),false);
 assert.equal(observerNetworkAcceptance(good,good,{...diagnostics,failedRequests:1}),false);
});
test('historical failed receipt missing new metadata remains original failure with cleanup and exact retained bytes',()=>{
 const f=fixture();try{
  const {networkDiagnostics:__unused,...old}=f.receipt;f.write('receipt.json',{...old,passed:false,failedPhase:'history',
   diagnostics:{...old.diagnostics,failedRequests:248,feedBodyErrors:94,consoleErrors:8}});
  const before=readFileSync(join(f.base,namespace,'receipt.json')),result=collectObserverArtifacts(f.base,namespace);
  assert.equal(result.acceptancePassed,false);assert.equal(result.cleanupConfirmed,true);
  assert.deepEqual(fileBytes(result.files.find(file=>file.name.endsWith('/receipt.json'))!),before);
  assert.deepEqual(readFileSync(join(f.base,namespace,'receipt.json')),before);
  f.write('receipt.json',old);assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false,'Old shapes cannot mint a NEW pass.');
 }finally{f.close();}
});
test('exact full-hour handoff binds digest/job/controller namespace and rejects all foreign or malformed fields',()=>{
 const raw=handoff(),value=bindObserverHandoff(raw,manifest,123);assert.equal(value.outputName,namespace);
 for(const patch of [{purpose:'input'},{protocolVersion:2},{githubRunId:124},{githubRunId:'123'},{manifestDigest:'0'.repeat(64)},
  {providerKey:'disallowed'}])assert.throws(()=>bindObserverHandoff({...raw,...patch},manifest,123));
 for(const patch of [{mode:'authenticated-smoke'},{runId:'11111111-1111-1111-1111-111111111111'},{population:5},{durationSeconds:300},
  {headSha:'3'.repeat(40)},{simulationLockDigest:'5'.repeat(64)},{sourceDigest:'6'.repeat(64)},{actionJournalId:'11111111-1111-1111-1111-111111111111'},
  {stateDirectory:'.state/community-foreign'}]){
  const changed={...manifest,...patch} as HostedManifest;
  assert.throws(()=>bindObserverHandoff({...raw,manifestDigest:sha256(JSON.stringify(changed))},changed,123));
 }
 for(const patch of [{headSha:'3'.repeat(40)},{providerKey:'disallowed'},{admin:{...raw.input.admin,providerKey:'disallowed'}},
  {rootProof:{...raw.input.rootProof,controllerId:'not-a-uuid'}},{rootProof:{...raw.input.rootProof,observedAt:'2000-01-01T00:00:00Z'}}])
  assert.throws(()=>bindObserverHandoff({...raw,input:{...raw.input,...patch}},manifest,123));
 assert.throws(()=>bindObserverHandoff(raw,manifest,NaN));assert.throws(()=>bindObserverHandoff(raw,manifest,Number.MAX_SAFE_INTEGER+1));
});
test('original JSON CRLF and PNG bytes/digests survive encrypted round-trip without credentials or unknown files',()=>{
 const f=fixture();try{
  const collected=collectObserverArtifacts(f.base,namespace);assert.equal(collected.acceptancePassed,true);assert.equal(collected.files.length,5);
  const key=Buffer.alloc(32,7),recovered=unseal(seal(collected,key),key) as {files:PrivateFile[]};
  for(const file of recovered.files){const original=readFileSync(join(f.base,file.name));assert.deepEqual(fileBytes(file),original);assert.equal(file.digest,sha256(original));}
  assert.ok(collected.files.every(file=>!file.name.includes('credentials')&&!file.name.includes('protection')));
 }finally{f.close();}
});
test('missing/partial/malformed/failed artifacts retain bytes but cannot claim acceptance',()=>{
 const f=fixture();try{
  assert.deepEqual(collectObserverArtifacts(f.base,namespace.replace(controllerId,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),{files:[],acceptancePassed:false,cleanupConfirmed:false});
  for(const patch of [{runId:'foreign'},{members:5},{observerIsParticipant:true},{memberBrowserUsers:2},{observerBrowsers:2},{browserClosed:false},
   {apiClosed:false},{passed:false},{freshnessPassed:false},{memoryFloorBreached:true},{observationAborted:true},{fullHourAcceptance:true},
   {history:{...f.receipt.history,actorId:'foreign'}},{diagnostics:{...f.receipt.diagnostics,consoleErrors:1}}]){
   f.write('receipt.json',{...f.receipt,...patch});const result=collectObserverArtifacts(f.base,namespace);assert.equal(result.acceptancePassed,false);assert.equal(result.files.length,5);
  }
  f.write('receipt.json',f.receipt);f.write('freshness.json',{...f.freshness,fiveSecondTargetMet:false});assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false);
  writeFileSync(join(f.base,namespace,'receipt.json'),'{unfinished');assert.equal(collectObserverArtifacts(f.base,namespace).files.length,5);
  rmSync(join(f.base,namespace,'history.png'));assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false);
 }finally{f.close();}
});
test('unknown files, redirected paths, linked ancestors/files and oversized artifacts reject',()=>{
 const f=fixture();try{
  assert.throws(()=>collectObserverArtifacts(f.base,`${namespace}/../credentials.json`));
  assert.throws(()=>collectObserverArtifacts(f.base,namespace.replace(approved.runId,'11111111-1111-1111-1111-111111111111')));
  writeFileSync(join(f.base,namespace,'credentials.json'),'public-offline');assert.throws(()=>collectObserverArtifacts(f.base,namespace));rmSync(join(f.base,namespace,'credentials.json'));
  const target=join(f.base,'linked-target');mkdirSync(target);symlinkSync(target,join(f.base,namespace,'dashboard.png-link'),'junction');
  assert.throws(()=>collectObserverArtifacts(f.base,namespace));rmSync(join(f.base,namespace,'dashboard.png-link'));
  rmSync(join(f.base,namespace,'dashboard.png'));symlinkSync(target,join(f.base,namespace,'dashboard.png'),'junction');assert.throws(()=>collectObserverArtifacts(f.base,namespace));rmSync(join(f.base,namespace,'dashboard.png'));
  writeFileSync(join(f.base,namespace,'dashboard.png'),Buffer.alloc(16*1024*1024+1));assert.throws(()=>collectObserverArtifacts(f.base,namespace));
 }finally{f.close();}
});
test('linked existing ancestor and oversized JSON cannot cross private artifact containment',()=>{
 const f=fixture(),linkedBase=mkdtempSync(join(tmpdir(),'g2g-observer-offline-link-'));
 try {
  symlinkSync(join(f.base,'.state'),join(linkedBase,'.state'),'junction');
  assert.throws(()=>collectObserverArtifacts(linkedBase,namespace));
  writeFileSync(join(f.base,namespace,'receipt.json'),Buffer.alloc(32*1024*1024+1));
  assert.throws(()=>collectObserverArtifacts(f.base,namespace));
 }finally{rmSync(linkedBase,{recursive:true,force:true});f.close();}
});
test('partial state never overwrites retained receipts and freshness counters cannot hide missing/late actions',()=>{
 const f=fixture();try {
  for(const patch of [{completed:false},{renderedActions:0},{hostedObservedActions:0},{hostedNeverObservedActions:1},
   {neverRenderedActions:1},{lateActions:1},{invalidTimingActions:1},{maximumActionToRenderedMs:5001},{authoritativeActions:0}]){
   f.write('freshness.json',{...f.freshness,...patch});const before=readFileSync(join(f.base,namespace,'freshness.json'));
   const result=collectObserverArtifacts(f.base,namespace);assert.equal(result.acceptancePassed,false);
   assert.deepEqual(readFileSync(join(f.base,namespace,'freshness.json')),before);
   assert.deepEqual(fileBytes(result.files.find(file=>file.name.endsWith('/freshness.json'))!),before);
  }
 }finally{f.close();}
});
test('worker exit is not browser cleanup; original scoped closure receipt is required independently of pass',()=>{
 const f=fixture();try{
  const good=collectObserverArtifacts(f.base,namespace);assert.equal(good.cleanupConfirmed,true);
  for(const patch of [{cleanupComplete:false},{cleanupComplete:undefined},{browserClosed:false},{apiClosed:false},{controllerId:'foreign'},{runId:'foreign'}]){
   f.write('receipt.json',{...f.receipt,...patch});const result=collectObserverArtifacts(f.base,namespace);
   assert.equal(result.cleanupConfirmed,false);assert.equal(result.acceptancePassed,false);assert.equal(result.files.length,5);
  }
  f.write('receipt.json',{...f.receipt,passed:false,freshnessPassed:false});const failed=collectObserverArtifacts(f.base,namespace);
  assert.equal(failed.cleanupConfirmed,true);assert.equal(failed.acceptancePassed,false);
  writeFileSync(join(f.base,namespace,'receipt.json'),'{partial');assert.equal(collectObserverArtifacts(f.base,namespace).cleanupConfirmed,false);
 }finally{f.close();}
});
test('controller, exact253 counts, union denominator and real action/render clocks cannot be fabricated by target flags',()=>{
 const f=fixture();try {
  f.write('admission.json',{...f.admission,controllerId:'foreign'});assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false);f.write('admission.json',f.admission);
  for(const patch of [{startedAt:'invalid'},{cutoffAt:f.freshness.startedAt},{participantWindowCounts:f.freshness.participantWindowCounts.slice(1)},
   {participantWindowCounts:f.freshness.participantWindowCounts.map((row,i)=>i===0?{...row,successes:2}:row)},
   {measured:[]},{measured:[...f.freshness.measured,...f.freshness.measured]}]){
   f.write('freshness.json',{...f.freshness,...patch});const result=collectObserverArtifacts(f.base,namespace);
   assert.equal(result.acceptancePassed,false);assert.equal(result.cleanupConfirmed,true);assert.equal(result.files.length,5);
  }
  for(const patch of [{eventId:0},{externalId:'foreign'},{actorId:'foreign'},{actionAt:NaN},{actionAt:Date.parse(f.freshness.cutoffAt)},
   {firstRenderedAt:0},{actionToRenderedMs:5001},{renderedTimestampMatches:false},{hostedNeverObserved:true},{renderTiming:'made-up'}]){
   f.write('freshness.json',{...f.freshness,measured:[{...f.freshness.measured[0],...patch}]});
   assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false);
  }
  f.write('freshness.json',f.freshness);
  for(const patch of [{parentCancelled:true},{minimumFreeGiB:1.4},{minimumFreeGiB:NaN},{finishedAt:f.freshness.cutoffAt}]){
   f.write('receipt.json',{...f.receipt,...patch});assert.equal(collectObserverArtifacts(f.base,namespace).acceptancePassed,false);
  }
 }finally{f.close();}
});
