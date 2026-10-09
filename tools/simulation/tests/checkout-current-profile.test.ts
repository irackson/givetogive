import test from 'node:test';
import assert from 'node:assert/strict';
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile,recheckCurrentCheckoutProfile } from '../src/checkout-current-profile.ts';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { approved,approvedSourceTuples } from '../src/hosted-checkout-policy.ts';
const now=Date.parse('2026-10-09T02:00:00.000Z'),head='a'.repeat(40);
const source={canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest,
 rootLockDigest:checkoutReleaseBinding.lockDigest,runnerDigest:'b'.repeat(64)};
function fixture() {return {
 protocol:1,purpose:'current-cohort-one-checkout',runId:c.runId,agentId:c.agentId,operationId:c.operationId,
 planDigest:c.planDigest,databaseIdentity:c.databaseIdentity,origin:c.origin,maximumAmountCents:500,currency:'usd',
 scenario:'decline',checkoutTier:'supporter',expectedResultTier:'neighbor',runBudgetCents:2500,actorBudgetCents:1500,
 noHistoryReset:true,maximumMemberLaunches:1,maximumSubmissions:1,retryAllowed:false,financialAdmission:false,paymentAccepted:false,
 stagedDeploymentId:checkoutReleaseBinding.deploymentId,source:{...source},
 job:{repository:'irackson/givetogive',actor:'irackson',triggeringActor:'irackson',event:'workflow_dispatch',ref:'refs/heads/main',
  attempt:1,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24,workflowRunId:'1234',jobId:'5678',jobNonce:'c'.repeat(32),
  headSha:head,status:'in_progress',observedAt:new Date(now).toISOString(),freeBytes:4*1024**3,publicRepository:true},
};}
test('current decline binding is immutable and does not approve or mutate historical payment policy',()=>{
 const old=JSON.stringify({approved,approvedSourceTuples});const raw=fixture();const p=validateCurrentCheckoutProfile(raw,head,source,now);
 assert.equal(p.financialAdmission,false);assert.equal(p.paymentAccepted,false);assert.equal(p.maximumSubmissions,1);
 assert.equal(p.expectedResultTier,'neighbor');assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.job)&&Object.isFrozen(p.source));
 raw.job.jobNonce='d'.repeat(32);assert.equal(p.job.jobNonce,'c'.repeat(32));
 assert.equal(JSON.stringify({approved,approvedSourceTuples}),old);assert.notEqual(p.operationId,approved.operationId);
});
test('consumed operations, other cohort/actor, increased budgets, success fixtures and arbitrary secrets are rejected',()=>{
 const changes=[{operationId:approved.operationId},{runId:approved.runId},{agentId:'other'},{maximumAmountCents:1500},
  {runBudgetCents:3000},{actorBudgetCents:2000},{scenario:'success'},{checkoutTier:'sustainer'},{expectedResultTier:'supporter'},
  {retryAllowed:true},{financialAdmission:true},{paymentAccepted:true},{noHistoryReset:false},{maximumSubmissions:2},
  {memberPassword:'private-input-not-allowed'},{planDigest:'d'.repeat(64)},{origin:'https://givetogive.vercel.app'},
  {databaseIdentity:'other'},{stagedDeploymentId:'other'}];
 for(const change of changes)assert.throws(()=>validateCurrentCheckoutProfile({...fixture(),...change},head,source,now),/binding rejected/);
});
test('only fresh, running, first-attempt exact-main owner jobs with sufficient memory can bind',()=>{
 const changes=[{status:'completed'},{attempt:2},{actor:'other'},{triggeringActor:'other'},{event:'push'},{ref:'refs/heads/other'},
  {platform:'win32'},{nodeMajor:22},{repository:'other/project'},{publicRepository:false},{runner:'windows-latest'},
  {workflowRunId:'0'},{jobNonce:'short'},{headSha:'e'.repeat(40)},{observedAt:new Date(now-30001).toISOString()},
  {observedAt:new Date(now+5001).toISOString()},{freeBytes:2.49*1024**3}];
 for(const change of changes){const p=fixture();Object.assign(p.job,change);
  assert.throws(()=>validateCurrentCheckoutProfile(p,head,source,now),/binding rejected/);}
 assert.throws(()=>validateCurrentCheckoutProfile(fixture(),head,source,NaN),/binding rejected/);
});
test('runner/app/lock tuple cannot be substituted, mixed with history or extended with fields',()=>{
 for(const s of [{...source,runnerDigest:'d'.repeat(64)},{...source,rootLockDigest:'e'.repeat(64)},
  {...source,canonicalSourceDigest:'e'.repeat(64)},approvedSourceTuples[0]!,{...source,extra:true}]) {
  const p={...fixture(),source:s};assert.throws(()=>validateCurrentCheckoutProfile(p,head,source,now),/binding rejected/);
 }
});
test('fresh phase observations retain exact job nonce/run/job/head/source and cannot roll backwards',()=>{
 const original=validateCurrentCheckoutProfile(fixture(),head,source,now),p=fixture();p.job.observedAt=new Date(now+1000).toISOString();
 assert.equal(recheckCurrentCheckoutProfile(p,original,now+1000).job.observedAt,p.job.observedAt);
 for(const change of [{workflowRunId:'1235'},{jobId:'5679'},{jobNonce:'d'.repeat(32)},
  {observedAt:new Date(now-1).toISOString()}]){const altered=fixture();Object.assign(altered.job,change);
  assert.throws(()=>recheckCurrentCheckoutProfile(altered,original,now),/binding rejected/);}
 const changed=fixture();changed.source.runnerDigest='e'.repeat(64);
 assert.throws(()=>recheckCurrentCheckoutProfile(changed,original,now),/binding rejected/);
});
