import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes } from 'node:crypto';
import { CurrentCheckoutPrivateDraft,currentCheckoutAssetPhases,currentCheckoutDraftTag } from '../src/checkout-current-draft.ts';
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile } from '../src/checkout-current-profile.ts';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { CheckoutPrivateDraft,type CheckoutAssetPhase } from '../src/hosted-checkout-github.ts';
import { approved,assetName } from '../src/hosted-checkout-policy.ts';
import { seal } from '../src/hosted-community-bundle.ts';
const now=Date.parse('2026-10-09T02:00:00Z'),head='a'.repeat(40),token='PUBLIC-OFFLINE-TRANSPORT-FIXTURE-TOKEN';
const source={canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest,rootLockDigest:checkoutReleaseBinding.lockDigest,
 runnerDigest:'b'.repeat(64)};
function profile(){return validateCurrentCheckoutProfile({protocol:1,purpose:'current-cohort-one-checkout',runId:c.runId,agentId:c.agentId,
 operationId:c.operationId,planDigest:c.planDigest,databaseIdentity:c.databaseIdentity,origin:c.origin,
 maximumAmountCents:500,currency:'usd',scenario:'decline',checkoutTier:'supporter',expectedResultTier:'neighbor',
 runBudgetCents:2500,actorBudgetCents:1500,noHistoryReset:true,maximumMemberLaunches:1,maximumSubmissions:1,
 retryAllowed:false,financialAdmission:false,paymentAccepted:false,stagedDeploymentId:checkoutReleaseBinding.deploymentId,source,
 job:{repository:'irackson/givetogive',actor:'irackson',triggeringActor:'irackson',event:'workflow_dispatch',ref:'refs/heads/main',
  attempt:1,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24,workflowRunId:'1234',jobId:'5678',jobNonce:'c'.repeat(32),
  headSha:head,status:'in_progress',observedAt:new Date(now).toISOString(),freeBytes:4*1024**3,publicRepository:true}},head,source,now);}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
type Row={id:number;name:string;size:number;digest:string;state:string};
type Call={url:string;method:string;headers:Headers;body:BodyInit|null|undefined};
function fixture(){
 const p=profile(),binding={releaseId:123,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:head}};
 const rows:Row[]=[],bytes=new Map<number,Buffer>(),calls:Call[]=[];let nextId=10;
 const release={id:123,draft:true,prerelease:false,published_at:null,target_commitish:head,
  tag_name:currentCheckoutDraftTag(p.operationId),body:'',assets:rows};
 const controls:{publiclyVisible?:boolean;failPost?:boolean;corruptReadback?:boolean}={};
 const request=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const call={url:String(input),method:init?.method??'GET',headers:new Headers(init?.headers),body:init?.body};calls.push(call);
  const url=new URL(call.url),authenticated=call.headers.get('authorization')===`Bearer ${token}`;
  if(url.hostname==='api.github.com'){
   if(!authenticated)return new Response(null,{status:controls.publiclyVisible?200:404});
   if(url.pathname.endsWith('/releases/123'))return Response.json(release);
   return new Response(null,{status:302,headers:{location:`https://release-assets.githubusercontent.com/offline/${url.pathname.split('/').at(-1)}?opaque=public-fixture`}});
  }
  if(url.hostname==='release-assets.githubusercontent.com'){
   assert.equal(call.headers.has('authorization'),false);const selected=bytes.get(Number(url.pathname.split('/').at(-1)))!;
   return new Response(new Uint8Array(controls.corruptReadback?Buffer.alloc(selected.length):selected));
  }
  if(url.hostname==='uploads.github.com'){
   assert.equal(call.method,'POST');assert.ok(authenticated&&call.body instanceof Uint8Array);
   if(controls.failPost)return new Response(null,{status:500});
   const value=Buffer.from(call.body as Uint8Array),row={id:nextId++,name:url.searchParams.get('name')!,size:value.length,
    digest:`sha256:${hash(value)}`,state:'uploaded'};rows.push(row);bytes.set(row.id,value);return Response.json(row,{status:201});
  }
  throw Error('Unexpected private transport '+token);
 }) as typeof fetch;
 const transport=new CurrentCheckoutPrivateDraft(p,head,source,123,token,{request,now:()=>now});
 release.body=JSON.stringify(transport.association);
 const add=(phase:CheckoutAssetPhase,value:Buffer)=>{const row={id:nextId++,name:assetName(binding,phase),size:value.length,
  digest:`sha256:${hash(value)}`,state:'uploaded'};rows.push(row);bytes.set(row.id,Buffer.from(value));return row;};
 return {p,binding,release,rows,calls,transport,controls,add,request,cleanup(){for(const b of bytes.values())b.fill(0);}};
}
function ciphertext(){const key=randomBytes(32);try{return seal({syntheticFixtureOnly:true},key);}finally{key.fill(0);}}

test('current draft constructor is inert, freezes exact job scope and cannot use the historical manifest class',()=>{
 const f=fixture();try{assert.equal(f.calls.length,0);assert.ok(Object.isFrozen(f.transport.association));
  assert.equal(f.transport.association.workflowRunId,'1234');assert.equal(f.transport.association.operationId,c.operationId);
  assert.throws(()=>new CheckoutPrivateDraft(f.p,head,token,{request:f.request,now:()=>now}));
  assert.throws(()=>new CurrentCheckoutPrivateDraft(f.p,head,source,0,token,{request:f.request,now:()=>now}));
  assert.throws(()=>new CurrentCheckoutPrivateDraft({...f.p,operationId:approved.operationId},head,source,123,token,{request:f.request,now:()=>now}));
  assert.equal(f.calls.length,0);
 }finally{f.cleanup();}
});
test('association is exact across cohort, operation, source head, live run/job/nonce and profile digest',async()=>{
 for(const change of [{runId:approved.runId},{operationId:approved.operationId},{headSha:'e'.repeat(40)},
  {workflowRunId:'1235'},{jobId:'5679'},{jobNonce:'d'.repeat(32)},{profileDigest:'e'.repeat(64)},
  {purpose:'one-member-test-checkout-policy'},{extra:'private-root-value'}]){
  const f=fixture();try{f.release.body=JSON.stringify({...f.transport.association,...change});
   await assert.rejects(f.transport.inspect());assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  }finally{f.cleanup();}
 }
});
test('legacy namespace, published/anonymous access and foreign assets cannot enter current transport',async()=>{
 for(const kind of ['tag','original-readiness-tag','old-associated-tag','head','public','asset','published']){const f=fixture();try{
  if(kind==='tag')f.release.tag_name=`checkout-acceptance-${c.operationId}`;
  if(kind==='original-readiness-tag')f.release.tag_name=`checkout-current-${c.operationId}`;
  if(kind==='old-associated-tag')f.release.tag_name=`checkout-current-${c.operationId}-association-recovery-v1`;
  if(kind==='head')f.release.target_commitish='e'.repeat(40);
  if(kind==='public')f.controls.publiclyVisible=true;
  if(kind==='published')f.release.draft=false;
  if(kind==='asset')f.rows.push({id:10,name:'foreign.g2genc',size:37,digest:'sha256:'+'e'.repeat(64),state:'uploaded'});
  await assert.rejects(f.transport.inspect());assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }finally{f.cleanup();}}
});
test('current ciphertext upload is one-shot, private and readback verified without CDN credential forwarding',async()=>{
 const f=fixture(),input=ciphertext();try{
  const result=await f.transport.upload('input',input);
  assert.equal(result.operationId,c.operationId);assert.equal(result.jobId,'5678');assert.equal(result.readbackVerified,true);
  assert.equal(result.paymentAccepted,false);assert.equal(result.retryAllowed,false);assert.equal(result.ciphertextDigest,hash(input));
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  await assert.rejects(f.transport.upload('input',input));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.ok(f.calls.filter(c=>new URL(c.url).hostname==='release-assets.githubusercontent.com').every(c=>!c.headers.has('authorization')));
 }finally{input.fill(0);f.cleanup();}
});
test('selected input cannot be redownloaded and changed or ambiguous writes never become retryable',async()=>{
 const f=fixture(),input=ciphertext();try{
  f.add('input',input);const received=await f.transport.download('input');assert.equal(hash(received),hash(input));received.fill(0);
  await assert.rejects(f.transport.download('input'));
 }finally{input.fill(0);f.cleanup();}
 for(const kind of ['failPost','corruptReadback'] as const){const g=fixture(),value=ciphertext();try{
  g.controls[kind]=true;await assert.rejects(g.transport.upload('input',value));
  await assert.rejects(g.transport.upload('input',value));assert.equal(g.calls.filter(c=>c.method==='POST').length,1);
 }finally{value.fill(0);g.cleanup();}}
});
test('finite phase inventory preserves the final receipt slot for the current job',async()=>{
 const f=fixture(),value=ciphertext();try{
  for(const phase of currentCheckoutAssetPhases.filter(phase=>phase!=='final'))f.add(phase,value);
  await assert.rejects(f.transport.upload('input',value));
  const retained=await f.transport.upload('final',value);assert.equal(retained.phase,'final');assert.equal(f.rows.length,10);
  await assert.rejects(f.transport.upload('final',value));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 }finally{value.fill(0);f.cleanup();}
});
test('only current protocol admits four fixed RPC pairs; historical phase names are not silently reused',async()=>{
 const f=fixture(),value=ciphertext();try{
  for(const phase of ['open-proof','submit-proof','ack-intent','submit-intent'] as const)
   await assert.rejects(f.transport.upload(phase,value));
  assert.equal(f.calls.length,0);
  for(const phase of currentCheckoutAssetPhases){const receipt=await f.transport.upload(phase,value);assert.equal(receipt.phase,phase);}
  assert.equal(f.rows.length,10);assert.equal(f.calls.filter(c=>c.method==='POST').length,10);
 }finally{value.fill(0);f.cleanup();}
});
