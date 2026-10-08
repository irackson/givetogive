// Offline HTTP fixtures, actual exclusive filesystem writes. No hosted parent,
// source approval, secret transfer, Checkout preparation or financial admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishCheckoutReadiness,validateCheckoutReadiness } from '../src/checkout-readiness.ts';
const HEAD='a'.repeat(40),NOW=Date.parse('2026-10-08T21:00:00Z');
function fixture(mode='ok') {
 const directory=mkdtempSync(join(tmpdir(),'g2g-checkout-ready-'));
 const ready={protocol:1,purpose:'checkout-parent-readiness',repository:'irackson/givetogive',headSha:HEAD,
  runId:'123',jobId:'456',jobNonce:'b'.repeat(32),observedAt:new Date(NOW).toISOString(),canonicalSourceDigest:'c'.repeat(64),
  rootLockDigest:'d'.repeat(64),runnerDigest:'e'.repeat(64),freeBytes:8*1024**3,bootstrapSourceApprovalStillRequired:true,
  noCheckoutAdmission:true,paymentAccepted:false,retryAllowed:false};
 const run={id:123,head_sha:HEAD,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'in_progress',conclusion:null,
  path:'.github/workflows/checkout-staging.yml',actor:{login:'irackson'},triggering_actor:{login:'irackson'},repository:{full_name:'irackson/givetogive',private:false}};
 const job={id:456,run_id:123,head_sha:HEAD,run_attempt:1,name:'checkout-parent',status:'in_progress',conclusion:null,labels:['ubuntu-24.04']};
 let posts=0,check:unknown;
 const request:typeof fetch=async (url,options)=>{
  const path=new URL(String(url)).pathname;
  let response:unknown;
  if(path.endsWith('/actions/runs/123'))response=mode==='foreign-actor'?{...run,actor:{login:'someone-else'}}:run;
  else if(path.endsWith('/jobs'))response={total_count:mode==='extra-job'?2:1,jobs:[mode==='terminal-job'?{...job,status:'completed',conclusion:'failure'}:job]};
  else if(options?.method==='POST') {
   posts++;if(mode==='uncertain')throw Error('PRIVATE-FIXTURE-NETWORK-ERROR');
   assert.doesNotMatch(String(options.body),/PUBLIC-OFFLINE-TOKEN/);
   check={...JSON.parse(String(options.body)),id:789,conclusion:null,app:{slug:'github-actions'}};response=check;
  }else response=mode==='changed-readback'?{...(check as object),head_sha:'f'.repeat(40)}:check;
  return Response.json(response,{status:options?.method==='POST'?201:200});
 };
 const options={directory,token:'PUBLIC-OFFLINE-TOKEN-NOT-A-CREDENTIAL',request,now:()=>NOW,signal:new AbortController().signal};
 return {ready,options,directory,posts:()=>posts};
}
test('live exact job metadata is one-shot retained without consuming private slots or claiming native readiness',async()=>{
 const f=fixture(),result=await publishCheckoutReadiness(f.ready,HEAD,f.options);
 assert.equal(result.transportEvidence,'injected-offline-http');assert.equal(result.nativeParentReadinessStillRequired,true);
 assert.equal(result.checkoutPrepared,false);assert.equal(result.paymentAccepted,false);assert.equal(f.posts(),1);
 assert.deepEqual(readdirSync(f.directory).sort(),['readiness-publication.intent.json','readiness-publication.result.json']);
 assert.doesNotMatch(readFileSync(join(f.directory,'readiness-publication.result.json'),'utf8'),/PUBLIC-OFFLINE-TOKEN/);
 await assert.rejects(publishCheckoutReadiness(f.ready,HEAD,f.options));assert.equal(f.posts(),1);
});
test('foreign actor, extra jobs or terminal job fail before public publication admission',async()=>{
 for(const mode of ['foreign-actor','extra-job','terminal-job']) {
  const f=fixture(mode);await assert.rejects(publishCheckoutReadiness(f.ready,HEAD,f.options));
  assert.equal(f.posts(),0);assert.deepEqual(readdirSync(f.directory),[]);
 }
});
test('uncertain publication and changed readback preserve intent and never repeat POST',async()=>{
 for(const mode of ['uncertain','changed-readback']) {
  const f=fixture(mode);await assert.rejects(publishCheckoutReadiness(f.ready,HEAD,f.options),/Checkout readiness unconfirmed/);
  assert.deepEqual(readdirSync(f.directory),['readiness-publication.intent.json']);
  await assert.rejects(publishCheckoutReadiness(f.ready,HEAD,f.options));assert.equal(f.posts(),1);
 }
});
test('expired, wrong-head, under-memory and secret-bearing metadata are rejected',()=>{
 const f=fixture();
 for(const value of [{...f.ready,observedAt:new Date(NOW-30001).toISOString()},{...f.ready,headSha:'f'.repeat(40)},
  {...f.ready,freeBytes:1024},{...f.ready,password:'PUBLIC-FIXTURE'}])assert.throws(()=>validateCheckoutReadiness(value,HEAD,NOW));
});
test('cancellation interrupts a stalled response after one POST without enabling republication',async()=>{
 const f=fixture(),original=f.options.request,controller=new AbortController();let canceled=false;
 f.options.signal=controller.signal;
 f.options.request=async(url,options)=>{
  const response=await original(url,options);
  if(String(url).endsWith('/check-runs/789')) {
   setTimeout(()=>controller.abort(),10);
   return new Response(new ReadableStream({cancel(){canceled=true;}}),{status:200});
  }
  return response;
 };
 await assert.rejects(publishCheckoutReadiness(f.ready,HEAD,f.options),/Checkout readiness unconfirmed/);
 assert.equal(canceled,true);assert.equal(f.posts(),1);
 assert.deepEqual(readdirSync(f.directory),['readiness-publication.intent.json']);
});
