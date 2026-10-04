import test from 'node:test';
import assert from 'node:assert/strict';
import { approved, fullRunApprovals, selectFullRunApproval, validateFullRunApprovalRegistry, validateFullRunApprovalTuple,
 validateManifest, observerInputName, sha256, type HostedManifest } from '../src/hosted-community-policy.ts';
import { validateObserverInput, observerPath } from '../src/hosted-community-observer-evidence.ts';
import { bindObserverHandoff, collectObserverArtifacts } from '../src/hosted-community-observer-parent.ts';
import { fixtureIds } from '../src/provisioning.ts';

// PUBLIC OFFLINE fixtures only. The second tuple is NEVER added to the runtime registry.
const NOW = Date.parse('2026-10-04T04:00:00Z'), HEAD = '4'.repeat(40);
const foreign = { ...approved, runId:'11111111-1111-1111-1111-111111111111',
 stateDirectory:'.state/community-offline-fixture', sourceDigest:'1'.repeat(64), programDigest:'2'.repeat(64),setupDigest:'3'.repeat(64),
 actionJournalId:'22222222-2222-2222-2222-222222222222',telemetryJournalId:'33333333-3333-3333-3333-333333333333' };
function manifest(): HostedManifest {
 return {protocolVersion:1,mode:'full-hour',runId:approved.runId,headSha:HEAD,releaseId:123,stateDirectory:approved.stateDirectory,
 population:253,durationSeconds:4500,sourceDigest:approved.sourceDigest,programDigest:approved.programDigest,
 actionJournalId:approved.actionJournalId,telemetryJournalId:approved.telemetryJournalId,runnerDigest:approved.runnerDigest,
 setupDigest:approved.setupDigest,seedDigest:approved.seedDigest,simulationLockDigest:'5'.repeat(64),
 release:{observedAt:new Date(NOW).toISOString(),deploymentId:approved.deploymentId,authoredSourceDigest:approved.authoredSourceDigest,
 lockDigest:approved.lockDigest,canonical:true,protected:true,ready:true,independentReadinessPassed:true,noOtherControllers:true,
 noMemberTokens:true,cloudBrowserSmokePassed:true,authenticatedSmokePassed:true}};
}
function observer() {
 return {protocolVersion:1,runId:approved.runId,origin:approved.origin,databaseIdentity:approved.databaseIdentity,headSha:HEAD,
 authoredSourceDigest:approved.authoredSourceDigest,gitAuthoredSourceDigest:approved.gitAuthoredSourceDigest,lockDigest:approved.lockDigest,
 runnerDigest:approved.runnerDigest,seedDigest:approved.seedDigest,simulationLockDigest:'5'.repeat(64),stateDirectory:approved.stateDirectory,
 programDigest:approved.programDigest,actionJournalId:approved.actionJournalId,telemetryJournalId:approved.telemetryJournalId,
 admin:{id:'offline-admin',userId:'offline-admin',email:'offline-admin@givetogive.invalid',password:'OFFLINE-NOT-A-CREDENTIAL'},
 protectionBypass:'OFFLINE-NOT-A-BYPASS',cohort:Array.from({length:253},(__unused,index)=>{const ids=fixtureIds(approved.runId,index);return{id:ids.id,userId:ids.userId};}),
 rootProof:{observedAt:new Date(NOW).toISOString(),deploymentId:approved.deploymentId,controllerId:'44444444-4444-4444-4444-444444444444',
 adminUserId:'offline-admin',verifiedSynthetic:true,active:true,emailVerified:true,existingAdmin:true,transferAuthorized:true,
 canonical:true,protected:true,ready:true,noProviderSecrets:true}};
}

test('runtime registry contains historical approval only and preserves historical byte shape',()=>{
 assert.equal(fullRunApprovals.length,1);assert.deepEqual(selectFullRunApproval(approved.runId),approved);
 assert.equal(JSON.stringify(selectFullRunApproval(approved.runId)),JSON.stringify(approved));
 assert.equal(Object.isFrozen(fullRunApprovals),true);assert.equal(Object.isFrozen(fullRunApprovals[0]),true);
 assert.throws(()=>selectFullRunApproval(foreign.runId));assert.throws(()=>selectFullRunApproval(undefined));
 const m=manifest();assert.deepEqual(validateManifest(m,NOW),m);
 assert.equal(observerInputName(m,'123'),'community-observer-input-'+approved.runId+'-123-1.g2genc');
});

test('pure fixture registry supports distinct exact tuples without changing runtime approval',()=>{
 const records=validateFullRunApprovalRegistry([approved,foreign]);assert.equal(records.length,2);
 assert.deepEqual(records[0],approved);assert.deepEqual(records[1],foreign);
 validateFullRunApprovalTuple({...manifest(),...foreign},records[1]!);
 assert.throws(()=>validateFullRunApprovalTuple(manifest(),records[1]!));
 assert.throws(()=>validateFullRunApprovalTuple({...manifest(),...foreign},records[0]!));
 assert.throws(()=>selectFullRunApproval(foreign.runId));assert.equal(fullRunApprovals.length,1);
});

test('registry rejects duplicates, cross-role identity collisions and unknown/common changed fields',()=>{
 for(const patch of [{runId:approved.runId},{stateDirectory:approved.stateDirectory},{actionJournalId:approved.actionJournalId},
  {telemetryJournalId:approved.telemetryJournalId},{actionJournalId:approved.telemetryJournalId},
  {actionJournalId:foreign.telemetryJournalId},{sourceDigest:'wrong'},{origin:'https://evil.example'},{runnerDigest:'0'.repeat(64)},
  {extra:'unapproved'},{stateDirectory:'../escape'}]) assert.throws(()=>validateFullRunApprovalRegistry([approved,{...foreign,...patch}]));
 assert.throws(()=>validateFullRunApprovalRegistry([]));
});

test('full manifest cannot select unknown run or mix tuples; every registered full namespace excludes smoke',()=>{
 assert.throws(()=>validateManifest({...manifest(),...foreign},NOW));
 for(const field of ['stateDirectory','sourceDigest','programDigest','actionJournalId','telemetryJournalId','setupDigest'] as const)
  assert.throws(()=>validateManifest({...manifest(),[field]:foreign[field]},NOW));
 for(const record of fullRunApprovals) {
  assert.throws(()=>validateManifest({...manifest(),mode:'authenticated-smoke',population:5,durationSeconds:300,runId:record.runId,stateDirectory:foreign.stateDirectory},NOW));
  assert.throws(()=>validateManifest({...manifest(),mode:'authenticated-smoke',population:5,durationSeconds:300,runId:foreign.runId,stateDirectory:record.stateDirectory},NOW));
 }
 for(const patch of [{population:252},{durationSeconds:3600},{release:{...manifest().release,authenticatedSmokePassed:false}}])
  assert.throws(()=>validateManifest({...manifest(),...patch},NOW));
});

test('observer validation and namespaces reject unknown run and mixed journal/cohort tuples',()=>{
 const input=observer();assert.deepEqual(validateObserverInput(input,NOW),input);
 for(const patch of [{runId:foreign.runId},{stateDirectory:foreign.stateDirectory},{programDigest:foreign.programDigest},
  {actionJournalId:foreign.actionJournalId},{telemetryJournalId:foreign.telemetryJournalId},
  {cohort:input.cohort.map((member,index)=>index===0?{id:fixtureIds(foreign.runId,0).id,userId:fixtureIds(foreign.runId,0).userId}:member)}])
  assert.throws(()=>validateObserverInput({...input,...patch},NOW));
 assert.throws(()=>observerPath('/offline',`.state/runs/${foreign.runId}/observer-${input.rootProof.controllerId}`));
 // Unknown selection fails before any filesystem probe in the collector.
 assert.throws(()=>collectObserverArtifacts('/offline',`.state/runs/${foreign.runId}/observer-${input.rootProof.controllerId}`));
});

test('original observer handoff shape still binds exact manifest; unknown and mixed selections reject',()=>{
 const m=manifest(),input=observer();input.rootProof.observedAt=new Date().toISOString();
 const raw={protocolVersion:1,purpose:'observer-input',manifestDigest:sha256(JSON.stringify(m)),githubRunId:123,input};
 const result=bindObserverHandoff(raw,m,123);
 assert.equal(result.outputName,`.state/runs/${approved.runId}/observer-${input.rootProof.controllerId}`);
 assert.deepEqual(result.input,input);
 assert.throws(()=>bindObserverHandoff({}, {...m,runId:foreign.runId},123));
 const mixed={...m,sourceDigest:foreign.sourceDigest};
 assert.throws(()=>bindObserverHandoff({...raw,manifestDigest:sha256(JSON.stringify(mixed))},mixed,123));
 assert.throws(()=>bindObserverHandoff({...raw,input:{...input,runId:foreign.runId}},m,123));
});
