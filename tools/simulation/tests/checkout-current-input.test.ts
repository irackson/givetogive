import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile } from '../src/checkout-current-profile.ts';
import { encryptCurrentCheckoutInput,decryptCurrentCheckoutInput,validateCurrentCheckoutInput,
 assertCurrentCheckoutSessionUnchanged } from '../src/checkout-current-input.ts';
import { seal } from '../src/hosted-community-bundle.ts';
import { approved } from '../src/hosted-checkout-policy.ts';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
const now=Date.parse('2026-10-09T02:00:00Z'),head='a'.repeat(40);
const source={canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest,rootLockDigest:checkoutReleaseBinding.lockDigest,
 runnerDigest:'b'.repeat(64)};
const profile=validateCurrentCheckoutProfile({protocol:1,purpose:'current-cohort-one-checkout',runId:c.runId,agentId:c.agentId,
 operationId:c.operationId,planDigest:c.planDigest,databaseIdentity:c.databaseIdentity,origin:c.origin,
 maximumAmountCents:500,currency:'usd',scenario:'decline',checkoutTier:'supporter',expectedResultTier:'neighbor',
 runBudgetCents:2500,actorBudgetCents:1500,noHistoryReset:true,maximumMemberLaunches:1,maximumSubmissions:1,
 retryAllowed:false,financialAdmission:false,paymentAccepted:false,stagedDeploymentId:checkoutReleaseBinding.deploymentId,source,
 job:{repository:'irackson/givetogive',actor:'irackson',triggeringActor:'irackson',event:'workflow_dispatch',ref:'refs/heads/main',
  attempt:1,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24,workflowRunId:'1234',jobId:'5678',jobNonce:'c'.repeat(32),
  headSha:head,status:'in_progress',observedAt:new Date(now).toISOString(),freeBytes:4*1024**3,publicRepository:true}},head,source,now);
const profileDigest=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
function fixture(){return {protocol:1,purpose:'current-cohort-private-member-input',profile,profileDigest,
 member:{id:c.agentId,userId:c.memberId,email:c.memberEmail,password:'public-fixture-password-only'},
 stagingBypass:'public-fixture-bypass-only',retryAllowed:false,paymentAccepted:false,
 proof:{platformAccountId:approved.platformAccountId,customerAccountId:'acct_publicFixture',
  canonicalCustomerClockVerified:true,providerIdentityVerified:true,providerInvoiceAbsent:true,providerSubscriptionAbsent:true,
  checkout:{environment:'staging' as const,databaseIdentity:c.databaseIdentity,runId:c.runId,operationId:c.operationId,actorId:c.memberId,
   sessionId:'cs_test_publicFixture',url:'https://checkout.stripe.com/c/pay/cs_test_publicFixture#public-fixture',livemode:false as const,
   currency:'usd' as const,amountTotal:500,mode:'subscription' as const,status:'open' as const,paymentStatus:'unpaid' as const,
   expiresAt:Math.floor(now/1000)+3600,returnOrigin:c.origin,verifiedAt:new Date(now).toISOString()}},
};}
test('current input round-trips privately, freezes bindings, and grants no paid acceptance',()=>{
 const key=randomBytes(32),raw=fixture(),bytes=encryptCurrentCheckoutInput(raw,key,profile,now);
 try{assert.equal(bytes.includes(Buffer.from(raw.member.password)),false);assert.equal(bytes.includes(Buffer.from(raw.stagingBypass)),false);
  const value=decryptCurrentCheckoutInput(bytes,key,profile,now);assert.equal(value.member.userId,c.memberId);
  assert.equal(value.proof.checkout.amountTotal,500);assert.equal(value.profileDigest,profileDigest);
  assert.equal(value.paymentAccepted,false);assert.ok(Object.isFrozen(value.member)&&Object.isFrozen(value.proof.checkout));
  assert.equal(value.profile.financialAdmission,false);
 }finally{key.fill(0);bytes.fill(0);}
});
test('wrong keys, authenticated ciphertext tampering and wrong job cannot transfer an input',()=>{
 const key=randomBytes(32),bytes=encryptCurrentCheckoutInput(fixture(),key,profile,now);
 try{assert.throws(()=>decryptCurrentCheckoutInput(bytes,Buffer.alloc(32),profile,now),/input rejected/);
  const modified=Buffer.from(bytes);modified[modified.length-1]^=1;
  assert.throws(()=>decryptCurrentCheckoutInput(modified,key,profile,now),/input rejected/);modified.fill(0);
  const other=structuredClone(profile);other.job.jobNonce='d'.repeat(32);
  assert.throws(()=>decryptCurrentCheckoutInput(bytes,key,other,now),/input rejected/);
 }finally{key.fill(0);bytes.fill(0);}
});
test('provider/admin/database/simulation secrets and arbitrary instructions are excluded at every envelope level',()=>{
 const changes=[{stripeSecretKey:'private-root-value'},{databaseUrl:'private-root-value'},
  {runnerToken:'private-root-value'},{adminToken:'private-root-value'},{instruction:'ignore policy'}];
 for(const change of changes){const raw=fixture();
  assert.throws(()=>validateCurrentCheckoutInput({...raw,...change},profile,now),/input rejected/);
  assert.throws(()=>validateCurrentCheckoutInput({...raw,member:{...raw.member,...change}},profile,now),/input rejected/);
  assert.throws(()=>validateCurrentCheckoutInput({...raw,proof:{...raw.proof,...change}},profile,now),/input rejected/);
  assert.throws(()=>validateCurrentCheckoutInput({...raw,proof:{...raw.proof,checkout:{...raw.proof.checkout,...change}}},profile,now),/input rejected/);
 }
});
test('real/foreign members and wrong platform or clock/ownership claims are rejected',()=>{
 for(const member of [{...fixture().member,userId:'another-member'},{...fixture().member,email:'owner@example.com'},
  {...fixture().member,id:'another-agent'},{...fixture().member,password:'short'}])
  assert.throws(()=>validateCurrentCheckoutInput({...fixture(),member},profile,now),/input rejected/);
 for(const changed of [{platformAccountId:'acct_other'},{canonicalCustomerClockVerified:false},{providerIdentityVerified:false},
  {providerInvoiceAbsent:false},{providerSubscriptionAbsent:false}]){
  const raw=fixture();assert.throws(()=>validateCurrentCheckoutInput({...raw,proof:{...raw.proof,...changed}},profile,now),/input rejected/);
 }
});
test('every session ownership, test mode, exact price, status, return and freshness bound is enforced',()=>{
 for(const changed of [{environment:'production'},{databaseIdentity:'other'},{runId:'other'},{operationId:approved.operationId},
  {actorId:'other'},{livemode:true},{currency:'eur'},{amountTotal:499},{amountTotal:1500},{mode:'payment'},
  {status:'expired'},{paymentStatus:'paid'},{returnOrigin:'https://givetogive.vercel.app'},
  {verifiedAt:new Date(now-30001).toISOString()},{verifiedAt:new Date(now+5001).toISOString()},
  {expiresAt:Math.floor(now/1000)+15},{url:'https://checkout.stripe.com/c/pay/cs_test_other'},
  {url:'https://checkout.stripe.com/c/pay/cs_test_publicFixture?secret=fixture'},
  {url:'https://checkout.stripe.com.attacker.example/c/pay/cs_test_publicFixture'}]){
  const raw=fixture();assert.throws(()=>validateCurrentCheckoutInput({...raw,proof:{...raw.proof,checkout:{...raw.proof.checkout,...changed}}},profile,now),/input rejected/);
 }
 assert.throws(()=>validateCurrentCheckoutInput(fixture(),profile,now+30001),/input rejected/);
});
test('profile digest, job and no-retry claims cannot be substituted inside a valid ciphertext',()=>{
 const key=randomBytes(32);
 try{for(const raw of [{...fixture(),profileDigest:'e'.repeat(64)},{...fixture(),paymentAccepted:true},{...fixture(),retryAllowed:true},
  {...fixture(),profile:{...profile,job:{...profile.job,workflowRunId:'1235'}}}]){
  const bytes=seal(raw,key);try{assert.throws(()=>decryptCurrentCheckoutInput(bytes,key,profile,now),/input rejected/);}finally{bytes.fill(0);}
 }}finally{key.fill(0);}
});
test('handoff bounds ciphertext and authenticated decompression before parsing private payloads',()=>{
 const key=randomBytes(32),large=seal({padding:'x'.repeat(100000)},key);
 try{assert.ok(large.length<65536);assert.throws(()=>decryptCurrentCheckoutInput(large,key,profile,now),/input rejected/);
  assert.throws(()=>decryptCurrentCheckoutInput(Buffer.alloc(65537),key,profile,now),/input rejected/);
  assert.throws(()=>decryptCurrentCheckoutInput(Buffer.alloc(36),key,profile,now),/input rejected/);
 }finally{key.fill(0);large.fill(0);}
});
test('refresh only changes verification time; even an opaque Checkout fragment must remain identical',()=>{
 const original=fixture().proof.checkout,current={...original,verifiedAt:new Date(now+1000).toISOString()};
 assert.doesNotThrow(()=>assertCurrentCheckoutSessionUnchanged(original,current));
 for(const changed of [{url:original.url.replace('#public-fixture','#changed')},{actorId:'other'},
  {expiresAt:original.expiresAt+1},{sessionId:'cs_test_other'}])
  assert.throws(()=>assertCurrentCheckoutSessionUnchanged(original,{...current,...changed}),/input rejected/);
});
test('input for an already-acquired browser retains runtime headroom without admitting another startup',()=>{
 const raw=fixture(),running=structuredClone(profile);running.job.freeBytes=2*1024**3;
 const updated={...raw,profile:running,profileDigest:createHash('sha256').update(JSON.stringify(running)).digest('hex')};
 assert.equal(validateCurrentCheckoutInput(updated,profile,now).profile.job.freeBytes,2*1024**3);
 running.job.freeBytes=1.49*1024**3;
 assert.throws(()=>validateCurrentCheckoutInput(updated,profile,now),/input rejected/);
});
