// Real codec/phase controllers and temporary SQLite; private transport/provider
// observations are injected doubles, NOT actual GitHub or Stripe acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,existsSync,readFileSync,readdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { currentInput,currentProfile,now } from './fixtures/current-checkout.ts';
import { validateCurrentCheckoutInput } from '../src/checkout-current-input.ts';
import { CurrentCheckoutPhaseExchange,createCurrentPhaseRequest } from '../src/checkout-current-exchange.ts';
import { CurrentCheckoutRootResponder } from '../src/checkout-current-responder.ts';
import { CurrentCheckoutRootBroker } from '../src/checkout-current-root.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { assetName } from '../src/hosted-checkout-policy.ts';
import type { CurrentCheckoutPrivateDraft } from '../src/checkout-current-draft.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
import type { CurrentCheckoutPhase } from '../src/checkout-current-phase.ts';
import type { CurrentMemberIdentity } from '../src/checkout-current-member.ts';
const input=validateCurrentCheckoutInput(currentInput(),currentProfile(),now),key=Buffer.alloc(32,7),connection='d'.repeat(32);
const identity:CurrentMemberIdentity={userId:input.member.userId,sessionVersion:0,observedAt:new Date(now).toISOString(),normalMemberOnly:true,billingManagementVerified:true};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function fixture(options:{badReadback?:boolean;uploadFail?:boolean;corruptRequest?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'g2g-current-responder-')),p=input.profile;
 const binding={releaseId:42,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
 const directory=join(root,`current-checkout-responder-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}`);
 const ledger=new SandboxLedger(join(root,'original-fixture.sqlite'),p.runId,2500,1500);
 ledger.reserve('c89fc875-d2d2-41a9-81bd-a1cb246ad53c','public-prior-member',500,'success');
 ledger.update('c89fc875-d2d2-41a9-81bd-a1cb246ad53c','ambiguous');
 let reads=0,uploads=0,downloads=0,contexts=0;const requests=new Map<string,Buffer>(),responses=new Map<string,Buffer>();
 const broker=new CurrentCheckoutRootBroker(input,{root,key,ledger,reader:{async read(){reads++;return structuredClone(input.proof);},close(){}},
 verifyCurrent:async()=>{},verifyOriginalBudget:async()=>{},readMember:async()=>identity,now:()=>now});
 const receipt=(phase:Parameters<typeof assetName>[1],bytes:Buffer)=>({phase,assetId:uploads+10,name:assetName(binding,phase),size:bytes.length,
 ciphertextDigest:hash(bytes),releaseId:42,jobId:p.job.jobId,jobNonce:p.job.jobNonce,headSha:p.job.headSha,operationId:p.operationId,
 anonymousDraft404:true,anonymousAsset404:true,observedAt:new Date(now).toISOString(),exactRetainedAssetVerified:true,
 readbackVerified:!options.badReadback,retryAllowed:false,paymentAccepted:false}) as unknown as RetainedCheckoutAsset;
 const transport:Pick<CurrentCheckoutPrivateDraft,'download'|'upload'>={async download(phase){downloads++;
 const bytes=Buffer.from(requests.get(phase)!);if(options.corruptRequest)bytes[bytes.length-1]^=1;return bytes;},async upload(phase,bytes){uploads++;
 assert.ok(existsSync(join(directory,phase+'.g2genc')));assert.ok(existsSync(join(directory,phase.replace('-response','-upload-intent')+'.json')));
 responses.set(phase,Buffer.from(bytes));if(options.uploadFail)throw Error('Public ambiguous upload fixture');return receipt(phase,bytes);}};
 const verifyContext=async()=>{contexts++;};
 const responder=new CurrentCheckoutRootResponder(input,{root,key,connectionNonce:connection,releaseId:42,broker,transport,verifyContext,now:()=>now});
 const parentTransport:Pick<CurrentCheckoutPrivateDraft,'download'|'upload'>={async upload(phase,bytes){
 requests.set(phase,Buffer.from(bytes));await responder.respond(phase.replace('-request','') as CurrentCheckoutPhase,new AbortController().signal);
 return {...receipt(phase,bytes),readbackVerified:true};},async download(phase){return Buffer.from(responses.get(phase)!);}};
 const exchange=new CurrentCheckoutPhaseExchange(root,input,connection,key,42,parentTransport,async()=>{},()=>now);
 return {root,directory,ledger,broker,transport,responder,exchange,requests,responses,verifyContext,counters:()=>({reads,uploads,downloads,contexts}),
 request(phase:CurrentCheckoutPhase){const value=createCurrentPhaseRequest(phase,identity,input,input.proof,connection,key,now);requests.set(phase+'-request',value.ciphertext);},
 cleanup(){exchange.close();responder.close();ledger.close();for(const bytes of [...requests.values(),...responses.values()])bytes.fill(0);
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true});}};
}
test('encrypted parent exchanges reach the root broker once per phase and retain original holds',async()=>{
 const f=fixture();try{assert.deepEqual(f.counters(),{reads:0,uploads:0,downloads:0,contexts:0});assert.equal(existsSync(f.directory),false);
 for(const phase of ['opening','fixture','notice','submission'] as const){const packet=await f.exchange.phase(phase,identity,new AbortController().signal);assert.equal(packet.phase,phase);}
 assert.deepEqual(f.counters(),{reads:4,uploads:4,downloads:4,contexts:16});
 assert.equal(f.ledger.get(input.profile.operationId)?.state,'submitted');assert.equal(f.ledger.report().length,2);
 assert.equal(f.ledger.get('c89fc875-d2d2-41a9-81bd-a1cb246ad53c')?.state,'ambiguous');
 for(const name of readdirSync(f.directory))if(name.endsWith('.json'))assert.doesNotMatch(readFileSync(join(f.directory,name),'utf8'),/public-fixture-password|public-fixture-bypass|checkout\.stripe|synthetic-/);
 assert.ok(key.equals(Buffer.alloc(32,7)));await assert.rejects(()=>f.responder.respond('submission',new AbortController().signal));
 }finally{f.cleanup();}
});
test('optional notice is not fabricated when the parent goes directly to submission',async()=>{
 const f=fixture();try{for(const phase of ['opening','fixture','submission'] as const)await f.exchange.phase(phase,identity,new AbortController().signal);
 assert.equal(f.counters().uploads,3);assert.equal(existsSync(join(f.directory,'notice-upload-intent.json')),false);
 }finally{f.cleanup();}
});
test('corrupt or wrong-phase requests cannot reach root reservation',async()=>{
 for(const mode of ['corrupt','wrong-phase'] as const){const f=fixture({corruptRequest:mode==='corrupt'});try{
 f.request(mode==='corrupt'?'opening':'fixture');if(mode==='wrong-phase')f.requests.set('opening-request',f.requests.get('fixture-request')!);
 await assert.rejects(()=>f.responder.respond('opening',new AbortController().signal));assert.equal(f.counters().reads,0);assert.equal(f.counters().uploads,0);
 assert.equal(f.ledger.get(input.profile.operationId),undefined);await assert.rejects(()=>f.responder.respond('opening',new AbortController().signal));
 assert.equal(f.counters().downloads,1);
 }finally{f.cleanup();}}
});
test('uncertain response upload and bad retained metadata preserve admitted holds and cannot retry',async()=>{
 for(const options of [{uploadFail:true},{badReadback:true}]){const f=fixture(options);try{
 f.request('opening');await assert.rejects(()=>f.responder.respond('opening',new AbortController().signal));
 assert.equal(f.ledger.get(input.profile.operationId)?.state,'reserved');assert.equal(f.counters().uploads,1);
 assert.ok(existsSync(join(f.directory,'opening-response.g2genc')));assert.ok(existsSync(join(f.directory,'opening-upload-intent.json')));
 await assert.rejects(()=>f.responder.respond('opening',new AbortController().signal));assert.equal(f.counters().uploads,1);
 }finally{f.cleanup();}}
});
test('replacement responder rejects the durable namespace and cannot download or admit again',async()=>{
 const f=fixture();try{f.request('opening');await f.responder.respond('opening',new AbortController().signal);
 const replacement=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,
 transport:f.transport,verifyContext:f.verifyContext,now:()=>now});
 await assert.rejects(()=>replacement.respond('opening',new AbortController().signal));assert.equal(f.counters().downloads,1);assert.equal(f.counters().reads,1);
 }finally{f.cleanup();}
});
test('request original replacement after download halts before any root action',async()=>{
 const f=fixture();try{f.request('opening');let contexts=0;
 const responder=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,transport:f.transport,
 verifyContext:async()=>{if(++contexts===2)writeFileSync(join(f.directory,'opening-request.g2genc'),Buffer.alloc(50));},now:()=>now});
 await assert.rejects(()=>responder.respond('opening',new AbortController().signal));assert.equal(f.counters().reads,0);assert.equal(f.ledger.get(input.profile.operationId),undefined);
 }finally{f.cleanup();}
});
test('abort releases an ignored pending context, closes the channel and prevents late admission',async()=>{
 const f=fixture();let release!:()=>void;try{const controller=new AbortController();
 const responder=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,transport:f.transport,
 verifyContext:async()=>{await new Promise<void>(done=>{release=done;});},now:()=>now});
 const pending=responder.respond('opening',controller.signal);controller.abort();await assert.rejects(()=>pending);
 release();await new Promise<void>(done=>setImmediate(done));assert.equal(f.counters().downloads,0);assert.equal(f.ledger.get(input.profile.operationId),undefined);
 await assert.rejects(()=>responder.respond('opening',new AbortController().signal));
 }finally{f.cleanup();}
});
test('foreign retained response identities cannot turn an upload into an accepted phase',async()=>{
 for(const patch of [{jobId:'999'},{jobNonce:'f'.repeat(32)},{headSha:'b'.repeat(40)},{releaseId:43},
 {operationId:'20000000-0000-4000-8000-000000000001'},{phase:'fixture-response'},{anonymousDraft404:false},
 {observedAt:new Date(now-30001).toISOString()},{ciphertextDigest:'0'.repeat(64)}]){
 const f=fixture();try{f.request('opening');const transport={...f.transport,async upload(...args:Parameters<typeof f.transport.upload>){
 return {...await f.transport.upload(...args),...patch} as unknown as RetainedCheckoutAsset;}};
 const responder=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,transport,
 verifyContext:f.verifyContext,now:()=>now});
 await assert.rejects(()=>responder.respond('opening',new AbortController().signal));assert.equal(f.ledger.get(input.profile.operationId)?.state,'reserved');
 assert.equal(existsSync(join(f.directory,'opening-upload-result.json')),false);assert.equal(f.counters().uploads,1);
 }finally{f.cleanup();}}
});
test('final context cannot replace the original response after its upload readback',async()=>{
 const f=fixture();try{f.request('opening');let contexts=0;
 const responder=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,transport:f.transport,
 verifyContext:async()=>{if(++contexts===4)writeFileSync(join(f.directory,'opening-response.g2genc'),Buffer.alloc(50));},now:()=>now});
 await assert.rejects(()=>responder.respond('opening',new AbortController().signal));assert.equal(f.counters().uploads,1);
 assert.equal(f.ledger.get(input.profile.operationId)?.state,'reserved');assert.equal(existsSync(join(f.directory,'opening-upload-result.json')),false);
 }finally{f.cleanup();}
});
test('concurrent root response calls close the pending exchange without a later download',async()=>{
 const f=fixture();let release!:()=>void;try{
 const responder=new CurrentCheckoutRootResponder(input,{root:f.root,key,connectionNonce:connection,releaseId:42,broker:f.broker,transport:f.transport,
 verifyContext:async()=>{await new Promise<void>(done=>{release=done;});},now:()=>now});
 const first=responder.respond('opening',new AbortController().signal);void first.catch(()=>undefined);
 await assert.rejects(()=>responder.respond('opening',new AbortController().signal));await assert.rejects(()=>first);release();
 await new Promise<void>(done=>setImmediate(done));assert.equal(f.counters().downloads,0);assert.equal(f.ledger.get(input.profile.operationId),undefined);
 }finally{f.cleanup();}
});
