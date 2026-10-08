import test from 'node:test';
import assert from 'node:assert/strict';
import { approved, october8Approved, october8NativeApproved, fullRunApprovals, selectFullRunApproval, validateFullRunApprovalRegistry, validateFullRunApprovalTuple,
 validateManifest, validateReleaseApproval, selectManifestApproval, observerInputName, sha256, type HostedManifest } from '../src/hosted-community-policy.ts';
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

test('runtime registry preserves historical byte shape and appends the actual October 8 cohort',()=>{
 assert.equal(fullRunApprovals.length,3);assert.deepEqual(selectFullRunApproval(approved.runId),approved);
 assert.deepEqual(fullRunApprovals[1],october8Approved);
 assert.deepEqual(selectFullRunApproval(october8Approved.runId),october8Approved);
 assert.deepEqual(fullRunApprovals[2],october8NativeApproved);
 assert.deepEqual(selectFullRunApproval(october8NativeApproved.runId),october8NativeApproved);
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
 assert.throws(()=>selectFullRunApproval(foreign.runId));assert.equal(fullRunApprovals.length,3);
});

test('October 8 full manifest and observer accept only their actual matching provenance',()=>{
 for(const next of [october8Approved,october8NativeApproved]) {
 const m:HostedManifest={...manifest(),runId:next.runId,stateDirectory:next.stateDirectory,
  sourceDigest:next.sourceDigest,programDigest:next.programDigest,actionJournalId:next.actionJournalId,
  telemetryJournalId:next.telemetryJournalId,runnerDigest:next.runnerDigest,setupDigest:next.setupDigest,seedDigest:next.seedDigest,
  release:{...manifest().release,deploymentId:next.deploymentId,authoredSourceDigest:next.authoredSourceDigest,lockDigest:next.lockDigest}};
 assert.deepEqual(validateManifest(m,NOW),m);
 assert.deepEqual(selectManifestApproval(m),next);
 for(const field of ['runId','stateDirectory','sourceDigest','programDigest','actionJournalId','telemetryJournalId','setupDigest'] as const)
  assert.throws(()=>validateManifest({...m,[field]:approved[field]},NOW));
 for(const field of ['deploymentId','authoredSourceDigest'] as const)
  assert.throws(()=>validateManifest({...m,release:{...m.release,[field]:approved[field]}},NOW));
 const input={...observer(),runId:next.runId,authoredSourceDigest:next.authoredSourceDigest,
  runnerDigest:next.runnerDigest,seedDigest:next.seedDigest,lockDigest:next.lockDigest,
  gitAuthoredSourceDigest:next.gitAuthoredSourceDigest,stateDirectory:next.stateDirectory,programDigest:next.programDigest,
  actionJournalId:next.actionJournalId,telemetryJournalId:next.telemetryJournalId,
  cohort:Array.from({length:253},(__unused,index)=>{const ids=fixtureIds(next.runId,index);return{id:ids.id,userId:ids.userId};}),
  rootProof:{...observer().rootProof,deploymentId:next.deploymentId}};
 assert.deepEqual(validateObserverInput(input,NOW),input);
 assert.throws(()=>validateObserverInput({...input,cohort:observer().cohort},NOW));
 assert.throws(()=>validateObserverInput({...input,gitAuthoredSourceDigest:approved.gitAuthoredSourceDigest},NOW));
 assert.throws(()=>validateManifest(m,NOW+300001));
 }
});

test('registry rejects duplicates, cross-role identity collisions and unknown/common changed fields',()=>{
 for(const patch of [{runId:approved.runId},{stateDirectory:approved.stateDirectory},{actionJournalId:approved.actionJournalId},
  {telemetryJournalId:approved.telemetryJournalId},{actionJournalId:approved.telemetryJournalId},
  {actionJournalId:foreign.telemetryJournalId},{sourceDigest:'wrong'},{origin:'https://evil.example'},{runnerDigest:'invalid'},
  {extra:'unapproved'},{stateDirectory:'../escape'}]) assert.throws(()=>validateFullRunApprovalRegistry([approved,{...foreign,...patch}]));
 assert.throws(()=>validateFullRunApprovalRegistry([]));
});

test('new release fixture binds exact code and deployment without mutating historical or runtime approval',()=>{
 const next={...foreign,deploymentId:'dpl_OfflineNewRelease',authoredSourceDigest:'6'.repeat(64),
  gitAuthoredSourceDigest:'7'.repeat(64),lockDigest:'8'.repeat(64),runnerDigest:'9'.repeat(64),seedDigest:'a'.repeat(64)};
 const records=validateFullRunApprovalRegistry([approved,next]);
 assert.deepEqual(records[0],approved);assert.deepEqual(records[1],next);
 const value={...manifest(),...next,release:{...manifest().release,deploymentId:next.deploymentId,
  authoredSourceDigest:next.authoredSourceDigest,lockDigest:next.lockDigest}};
 validateReleaseApproval(value,records[1]!);
 assert.throws(()=>validateReleaseApproval(value,records[0]!));
 for(const field of ['deploymentId','authoredSourceDigest','lockDigest'] as const)
  assert.throws(()=>validateReleaseApproval({...value,release:{...value.release,[field]:approved[field]}},records[1]!));
 for(const field of ['runnerDigest','seedDigest'] as const)
  assert.throws(()=>validateReleaseApproval({...value,[field]:approved[field]},records[1]!));
 // A fixture passing pure validation confers no authority to the actual runtime.
 assert.throws(()=>selectManifestApproval(value));assert.throws(()=>validateManifest(value,NOW));
 assert.throws(()=>validateFullRunApprovalRegistry([next]));
 assert.throws(()=>validateFullRunApprovalRegistry([{...approved,deploymentId:next.deploymentId},next]));
 for(const field of ['authoredSourceDigest','gitAuthoredSourceDigest','lockDigest'] as const)
  assert.throws(()=>validateFullRunApprovalRegistry([approved,{...foreign,[field]:'f'.repeat(64)}]));
 for(const patch of [{databaseIdentity:next.runId},{databaseName:'production'},{deploymentId:'https://evil.example'},
  {authoredSourceDigest:'invalid'},{gitAuthoredSourceDigest:'invalid'},{seedDigest:'invalid'}])
  assert.throws(()=>validateFullRunApprovalRegistry([approved,{...next,...patch}]));
 assert.equal(fullRunApprovals.length,3);
});

test('new exact runner tuple can reuse the same app deployment without approving arbitrary runner code',()=>{
 const next={...foreign,runnerDigest:'d'.repeat(64),seedDigest:'e'.repeat(64)};
 const records=validateFullRunApprovalRegistry([approved,next]);
 assert.deepEqual(records[0],approved);
 const value={...manifest(),...next};
 validateFullRunApprovalTuple(value,records[1]!);
 validateReleaseApproval(value,records[1]!);
 for(const field of ['runnerDigest','seedDigest'] as const) {
  assert.throws(()=>validateReleaseApproval({...value,[field]:approved[field]},records[1]!));
  assert.throws(()=>validateFullRunApprovalTuple({...value,[field]:approved[field]},records[1]!));
  assert.throws(()=>validateFullRunApprovalRegistry([approved,{...next,[field]:'invalid'}]));
 }
 // Fixture registration is pure, never a runtime authorization or historical rewrite.
 assert.throws(()=>selectFullRunApproval(next.runId));
 assert.throws(()=>validateManifest(value,NOW));
 assert.equal(fullRunApprovals.length,3);
});

test('known run and smoke cannot mix another release into a trusted manifest',()=>{
 for(const mode of ['full-hour','authenticated-smoke'] as const) {
  const value=mode==='full-hour'?manifest():{...manifest(),mode,runId:foreign.runId,stateDirectory:foreign.stateDirectory,population:5,durationSeconds:300};
  for(const patch of [{release:{...value.release,deploymentId:'dpl_Unknown'}},
   {release:{...value.release,authoredSourceDigest:'b'.repeat(64)}},
   {release:{...value.release,lockDigest:'c'.repeat(64)}},{runnerDigest:'d'.repeat(64)},{seedDigest:'e'.repeat(64)}])
   assert.throws(()=>validateManifest({...value,...patch},NOW));
 }
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
