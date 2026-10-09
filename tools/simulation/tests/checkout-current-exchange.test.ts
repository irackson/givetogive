import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,existsSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCurrentPhaseRequest,decodeCurrentPhaseRequest,createCurrentPhaseResponse,decodeCurrentPhaseResponse,CurrentCheckoutPhaseExchange } from '../src/checkout-current-exchange.ts';
import { validateCurrentCheckoutInput,type CurrentCheckoutProof } from '../src/checkout-current-input.ts';
import { currentInput,currentProfile,now } from './fixtures/current-checkout.ts';
import type { CurrentMemberIdentity } from '../src/checkout-current-member.ts';
import type { CurrentCheckoutPrivateDraft } from '../src/checkout-current-draft.ts';
import type { CurrentCheckoutPhase } from '../src/checkout-current-phase.ts';
import { seal } from '../src/hosted-community-bundle.ts';
import { assetName } from '../src/hosted-checkout-policy.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
const input=validateCurrentCheckoutInput(currentInput(),currentProfile(),now),connection='d'.repeat(32),key=Buffer.alloc(32,7);
const identity:CurrentMemberIdentity={userId:input.member.userId,sessionVersion:0,observedAt:new Date(now).toISOString(),normalMemberOnly:true,billingManagementVerified:true};
function packet(phase:CurrentCheckoutPhase,proof=input.proof,nonce='e'.repeat(32)){return {protocol:1,purpose:'current-member-phase-proof',profileDigest:input.profileDigest,
 phase,nonce,admission:phase==='notice'?'notice':phase==='submission'?'submit':'none',proof,paymentAccepted:false,retryAllowed:false};}
test('current phase packets round-trip privately with exact request, phase, channel and immutable identity',()=>{
 const original=createCurrentPhaseRequest('opening',identity,input,input.proof,connection,key,now);
 const decoded=decodeCurrentPhaseRequest(original.ciphertext,key,input,input.proof,connection,now);
 assert.deepEqual(decoded,original.request);assert.ok(Object.isFrozen(decoded)&&Object.isFrozen(decoded.identity));
 const bytes=createCurrentPhaseResponse(decoded,packet('opening'),input,input.proof,connection,key,now,new Set());
 const result=decodeCurrentPhaseResponse(bytes,key,decoded,input,input.proof,connection,now,new Set());
 assert.equal(result.phase,'opening');assert.equal(result.paymentAccepted,false);
 assert.doesNotMatch(original.ciphertext.toString(),/public-fixture-password|public-fixture-bypass|synthetic-/);
 assert.equal(key.equals(Buffer.alloc(32,7)),true);
});
test('wrong keys, changed ciphertext, wrong channel and authenticated oversized plaintext reject',()=>{
 const original=createCurrentPhaseRequest('opening',identity,input,input.proof,connection,key,now);
 const altered=Buffer.from(original.ciphertext);altered[altered.length-1]^=1;
 for(const [bytes,secret,channel] of [[original.ciphertext,Buffer.alloc(32,8),connection],[altered,key,connection],
  [original.ciphertext,key,'f'.repeat(32)],[seal({large:'x'.repeat(33000)},key),key,connection]] as const)
  assert.throws(()=>decodeCurrentPhaseRequest(bytes,secret,input,input.proof,channel,now));
});
test('requests reject stale identity, foreign member, extra secrets and changed original provider session',()=>{
 for(const member of [{...identity,userId:'other'},{...identity,observedAt:new Date(now-30001).toISOString()},
  {...identity,STRIPE_SECRET_KEY:'public-forbidden-fixture'}])
  assert.throws(()=>createCurrentPhaseRequest('opening',member as CurrentMemberIdentity,input,input.proof,connection,key,now));
 const changed={...input.proof,checkout:{...input.proof.checkout,sessionId:'cs_test_other',url:'https://checkout.stripe.com/c/pay/cs_test_other#public'}};
 assert.throws(()=>createCurrentPhaseRequest('opening',identity,input,changed,connection,key,now));
 const original=createCurrentPhaseRequest('opening',identity,input,input.proof,connection,key,now);
 assert.throws(()=>decodeCurrentPhaseRequest(original.ciphertext,key,input,input.proof,connection,now+30001));
});
test('responses cannot replay another request, reuse a phase nonce, change phase or freshen a foreign proof',()=>{
 const first=createCurrentPhaseRequest('opening',identity,input,input.proof,connection,key,now);
 const second=createCurrentPhaseRequest('opening',identity,input,input.proof,connection,key,now);
 const bytes=createCurrentPhaseResponse(first.request,packet('opening'),input,input.proof,connection,key,now,new Set());
 assert.throws(()=>decodeCurrentPhaseResponse(bytes,key,second.request,input,input.proof,connection,now,new Set()));
 assert.throws(()=>decodeCurrentPhaseResponse(bytes,key,first.request,input,input.proof,connection,now,new Set(['e'.repeat(32)])));
 assert.throws(()=>createCurrentPhaseResponse(first.request,packet('submission'),input,input.proof,connection,key,now,new Set()));
 const foreign={...input.proof,customerAccountId:'acct_other'};
 assert.throws(()=>createCurrentPhaseResponse(first.request,packet('opening',foreign),input,input.proof,connection,key,now,new Set()));
});
test('response proof must follow the request and cannot be old while the envelope looks fresh',()=>{
 const freshIdentity={...identity,observedAt:new Date(now+1000).toISOString()};
 const request=createCurrentPhaseRequest('opening',freshIdentity,input,input.proof,connection,key,now+1000);
 assert.throws(()=>createCurrentPhaseResponse(request.request,packet('opening'),input,input.proof,connection,key,now+1000,new Set()));
});
test('later phases retain immutable input but require new identity and provider observations',()=>{
 const later=now+60000,member={...identity,observedAt:new Date(later).toISOString()};
 const original=createCurrentPhaseRequest('fixture',member,input,input.proof,connection,key,later);
 assert.throws(()=>createCurrentPhaseResponse(original.request,packet('fixture'),input,input.proof,connection,key,later,new Set()));
 const fresh={...input.proof,checkout:{...input.proof.checkout,verifiedAt:new Date(later).toISOString()}};
 const response=createCurrentPhaseResponse(original.request,packet('fixture',fresh),input,input.proof,connection,key,later,new Set());
 assert.equal(decodeCurrentPhaseResponse(response,key,original.request,input,input.proof,connection,later,new Set()).proof.checkout.verifiedAt,new Date(later).toISOString());
});
function harness(options:{uploadFail?:boolean;badReadback?:boolean;badResponse?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'g2g-current-exchange-'));let uploads=0,downloads=0,contexts=0;
 let previous:CurrentCheckoutProof=input.proof;const responses=new Map<string,Buffer>(),used=new Set<string>();
 const p=input.profile,binding={releaseId:42,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
 const directory=join(root,`current-checkout-exchange-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}`);
 const transport:Pick<CurrentCheckoutPrivateDraft,'upload'|'download'>={async upload(phase,bytes){uploads++;
  assert.ok(existsSync(join(directory,phase+'.g2genc')));assert.ok(existsSync(join(directory,phase.replace('-request','-upload-intent')+'.json')));
  if(options.uploadFail)throw Error('public ambiguous upload fixture');
  const request=decodeCurrentPhaseRequest(bytes,key,input,previous,connection,now);const proofPacket=packet(request.phase,previous,uploads.toString(16).padStart(32,'0'));
  const response=createCurrentPhaseResponse(request,proofPacket,input,previous,connection,key,now,used);used.add(proofPacket.nonce);previous=proofPacket.proof;
  responses.set(request.phase+'-response',response);
  return {phase,assetId:uploads,name:assetName(binding,phase),size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),
   releaseId:42,jobId:p.job.jobId,jobNonce:p.job.jobNonce,headSha:p.job.headSha,operationId:p.operationId,anonymousDraft404:true,anonymousAsset404:true,
   observedAt:new Date(now).toISOString(),exactRetainedAssetVerified:true,readbackVerified:options.badReadback?false:true,retryAllowed:false,paymentAccepted:false} as unknown as RetainedCheckoutAsset;
 },async download(phase){downloads++;const bytes=Buffer.from(responses.get(phase)!);if(options.badResponse)bytes[bytes.length-1]^=1;return bytes;}};
 const verify=async()=>{contexts++;};const exchange=new CurrentCheckoutPhaseExchange(root,input,connection,key,42,transport,verify,()=>now);
 return {root,directory,transport,exchange,counters:()=>({uploads,downloads,contexts})};
}
test('durable exchange wires all four private RPC pairs and retains ciphertext before any upload',async()=>{
 const h=harness();for(const phase of ['opening','fixture','notice','submission'] as const){const result=await h.exchange.phase(phase,identity,new AbortController().signal);assert.equal(result.phase,phase);}
 assert.deepEqual(h.counters(),{uploads:4,downloads:4,contexts:8});
 for(const name of readdirSync(h.directory))if(name.endsWith('.json'))assert.doesNotMatch(readFileSync(join(h.directory,name),'utf8'),/public-fixture-password|public-fixture-bypass|checkout\.stripe|synthetic-/);
 await assert.rejects(()=>h.exchange.phase('submission',identity,new AbortController().signal));h.exchange.close();
 assert.ok(key.equals(Buffer.alloc(32,7)));
});
test('optional notice can be skipped but mandatory phases, repeated calls and changed sessions cannot',async()=>{
 const good=harness();for(const stage of ['opening','fixture','submission'] as const)await good.exchange.phase(stage,identity,new AbortController().signal);good.exchange.close();
 for(const stage of ['fixture','notice','submission'] as const){const h=harness();await assert.rejects(()=>h.exchange.phase(stage,identity,new AbortController().signal));assert.equal(h.counters().uploads,0);}
 const changed=harness();await changed.exchange.phase('opening',identity,new AbortController().signal);
 await assert.rejects(()=>changed.exchange.phase('fixture',{...identity,sessionVersion:1},new AbortController().signal));assert.equal(changed.counters().uploads,1);
});
test('uncertain upload, bad readback and corrupt response retain originals and never retry',async()=>{
 for(const options of [{uploadFail:true},{badReadback:true},{badResponse:true}]){const h=harness(options);
  await assert.rejects(()=>h.exchange.phase('opening',identity,new AbortController().signal));
  assert.ok(existsSync(join(h.directory,'opening-request.g2genc')));assert.ok(existsSync(join(h.directory,'opening-upload-intent.json')));
  await assert.rejects(()=>h.exchange.phase('opening',identity,new AbortController().signal));assert.equal(h.counters().uploads,1);
 }
});
test('a replacement exchange cannot reuse an existing operation/job namespace after restart',async()=>{
 const h=harness();await h.exchange.phase('opening',identity,new AbortController().signal);h.exchange.close();
 const replacement=new CurrentCheckoutPhaseExchange(h.root,input,connection,key,42,h.transport,async()=>{},()=>now);
 await assert.rejects(()=>replacement.phase('opening',identity,new AbortController().signal));assert.equal(h.counters().uploads,1);
});
test('aborted context or explicit close prevents any later upload',async()=>{
 const h=harness(),controller=new AbortController();controller.abort();await assert.rejects(()=>h.exchange.phase('opening',identity,controller.signal));assert.equal(h.counters().uploads,0);
 const idle=harness();idle.exchange.close();await assert.rejects(()=>idle.exchange.phase('opening',identity,new AbortController().signal));assert.equal(idle.counters().uploads,0);
});
test('concurrent phase calls abort the pending context and cannot upload after it resolves',async()=>{
 const h=harness();let release!:()=>void;
 const exchange=new CurrentCheckoutPhaseExchange(h.root,input,connection,key,42,h.transport,
  async()=>{await new Promise<void>(resolve=>{release=resolve;});},()=>now);
 const pending=exchange.phase('opening',identity,new AbortController().signal);void pending.catch(()=>undefined);
 await assert.rejects(()=>exchange.phase('opening',identity,new AbortController().signal));
 release();await assert.rejects(()=>pending);assert.equal(h.counters().uploads,0);
});
