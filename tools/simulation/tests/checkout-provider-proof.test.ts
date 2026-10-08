// Synthetic provider responses only; no key/SDK execution/network or paid acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalCheckoutProofReader,stripeCheckoutReads} from '../src/checkout-provider-proof.ts';
import {approved,validateProof,type Manifest} from '../src/hosted-checkout-policy.ts';
import type Stripe from 'stripe';
import {createProofRequest,decodeProofRequest,createProofResponse,decodeProofResponse} from '../src/checkout-proof-exchange.ts';
import {seal} from '../src/hosted-community-bundle.ts';
import {CheckoutDurableParent} from '../src/checkout-durable-parent.ts';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assetName,digest} from '../src/hosted-checkout-policy.ts';
import type {RetainedCheckoutAsset} from '../src/hosted-checkout-github.ts';
import {validateMemberStart} from '../src/checkout-hosted-member.mjs';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const NOW=Date.parse('2026-10-08T19:30:00Z'),HEAD='b'.repeat(40);
const target={customerAccountId:'acct_fixtureCustomer',clockId:'clock_fixtureClock',frozenTime:1780000000,sessionId:'cs_test_fixtureSession'};
function manifest():Manifest{return{protocol:1,purpose:'one-member-test-checkout-policy',
 job:{repository:approved.repository,actor:approved.actor,triggeringActor:approved.actor,event:'workflow_dispatch',ref:'refs/heads/main',
  attempt:1,id:'123456789',headSha:HEAD,nonce:'c'.repeat(32),publicRepository:true,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24},
 releaseId:123,createdAt:new Date(NOW).toISOString(),runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,
 origin:approved.origin,databaseIdentity:approved.databaseIdentity,sourceDigest:approved.sourceDigest,canonicalSourceDigest:approved.canonicalSourceDigest,
 rootLockDigest:approved.rootLockDigest,runnerDigest:approved.runnerDigest,currency:'usd',maximumAmountCents:1500,expectedTier:'sustainer',scenario:'success',
 budget:{runBudgetCents:2500,actorBudgetCents:1500,priorExpiredReservedCents:1000,candidateReservedCents:1500,
  originalAdmissionDigest:'1'.repeat(64),expiredHistoryDigests:['2'.repeat(64),'3'.repeat(64)],noReset:true},
 rootProof:{observedAt:new Date(NOW).toISOString(),localIsolationVerified:true,normalMemberOnly:true,noMemberTokens:true,
  noCheckoutSubmitAdmission:true,canonicalCustomerClockVerified:true,releaseVerified:true,supportsTestSubscriptionsOnly:true}};}
function fixture(){
 const m=manifest(),calls:string[]=[],data={platform:{id:String(approved.platformAccountId)},balance:{livemode:false},
  customer:{id:target.customerAccountId,livemode:false,configuration:{customer:{test_clock:target.clockId}}},
  clock:{id:target.clockId,name:`givetogive:${approved.runId}`,livemode:false,status:'ready',frozen_time:target.frozenTime},
  invoices:{data:[] as unknown[],has_more:false},subscriptions:{data:[] as unknown[],has_more:false},
  session:{id:target.sessionId,customer_account:target.customerAccountId,client_reference_id:approved.operationId,
   livemode:false,currency:'usd',amount_total:1500,mode:'subscription',status:'open',payment_status:'unpaid',expires_at:Math.floor(NOW/1000)+600,
   success_url:`${approved.origin}/giving/${approved.operationId}?checkout=returned`,cancel_url:`${approved.origin}/giving/${approved.operationId}?checkout=canceled`,
   url:`https://checkout.stripe.com/c/pay/${target.sessionId}`,invoice:null,subscription:null,payment_intent:null}};
 let time=NOW,afterRead:()=>void=()=>{};
 const read=(kind:keyof typeof data)=>{calls.push(kind);afterRead();return Promise.resolve(structuredClone(data[kind]));};
 const reader=new LocalCheckoutProofReader(m,HEAD,target,{platform:()=>read('platform'),balance:()=>read('balance'),
  customer:id=>{assert.equal(id,target.customerAccountId);return read('customer');},
  clock:id=>{assert.equal(id,target.clockId);return read('clock');},
  invoices:id=>{assert.equal(id,target.customerAccountId);return read('invoices');},
  subscriptions:id=>{assert.equal(id,target.customerAccountId);return read('subscriptions');},
  checkout:id=>{assert.equal(id,target.sessionId);return read('session');}},()=>time);
 return{m,calls,data,reader,signal:new AbortController(),setTime:(value:number)=>{time=value;},onRead:(value:()=>void)=>{afterRead=value;}};
}
test('inert constructor, exact seven fresh reads per phase, fresh nonce and narrow transferable proof',async()=>{
 const f=fixture();assert.deepEqual(f.calls,[]);
 const opening=await f.reader.read('open',f.signal.signal);validateProof(opening,f.m,'open',NOW);
 f.setTime(NOW+1000);const submission=await f.reader.read('pre-submit',f.signal.signal);
 validateProof(submission,f.m,'pre-submit',NOW+1000,opening);
 assert.notEqual(opening.proofNonce,submission.proofNonce);
 assert.deepEqual(f.calls,['platform','balance','customer','clock','invoices','subscriptions','session','platform','balance','customer','clock','invoices','subscriptions','session']);
 assert.equal('configuration' in submission,false);assert.equal('balance' in submission,false);
 await assert.rejects(f.reader.read('pre-submit',f.signal.signal));assert.equal(f.calls.length,14);
});
test('foreign/live customer, wrong clock, moving clock, foreign platform and balance fail before session read',async()=>{
 const mutations=[(f:ReturnType<typeof fixture>)=>{f.data.platform.id='acct_foreign';},
  (f:ReturnType<typeof fixture>)=>{f.data.balance.livemode=true;},
  (f:ReturnType<typeof fixture>)=>{f.data.customer.livemode=true;},
  (f:ReturnType<typeof fixture>)=>{f.data.customer.id='acct_foreign';},
  (f:ReturnType<typeof fixture>)=>{f.data.customer.configuration.customer.test_clock='clock_foreign';},
  (f:ReturnType<typeof fixture>)=>{f.data.clock.frozen_time++;},
  (f:ReturnType<typeof fixture>)=>{f.data.clock.status='advancing';},
  (f:ReturnType<typeof fixture>)=>{f.data.clock.name='foreign';}];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(f.reader.read('open',f.signal.signal));
  assert.equal(f.calls.includes('session'),false);const count=f.calls.length;await assert.rejects(f.reader.read('open',f.signal.signal));assert.equal(f.calls.length,count);}
});
test('amount/mode/owner/URL/expiry/settlement changes never yield a proof',async()=>{
 for(const patch of [{amount_total:500},{mode:'payment'},{customer_account:'acct_other'},{client_reference_id:'other'},
  {livemode:true},{payment_status:'paid'},{status:'expired'},{expires_at:Math.floor(NOW/1000)+15},
  {url:'https://checkout.stripe.com/c/pay/cs_test_other'},{success_url:'https://example.com'},
  {invoice:'in_fixture'},{subscription:'sub_fixture'},{payment_intent:'pi_fixture'}]){
  const f=fixture();Object.assign(f.data.session,patch);await assert.rejects(f.reader.read('open',f.signal.signal));
  assert.equal(f.calls.length,7);await assert.rejects(f.reader.read('open',f.signal.signal));assert.equal(f.calls.length,7);
 }
});
test('abort before/after read and slow round cannot mint newly timestamped proof',async()=>{
 for(const mode of ['before','during','slow']){const f=fixture();
  if(mode==='before')f.signal.abort();else f.onRead(()=>{if(mode==='during')f.signal.abort();else f.setTime(NOW+30001);});
  await assert.rejects(f.reader.read('open',f.signal.signal));assert.equal(f.calls.length,mode==='before'?0:1);
 }
});
test('pre-submit without opening, repeat opening, invalid target and closed reader are inert failures',async()=>{
 const f=fixture();await assert.rejects(f.reader.read('pre-submit',f.signal.signal));assert.deepEqual(f.calls,[]);
 const g=fixture();await g.reader.read('open',g.signal.signal);await assert.rejects(g.reader.read('open',g.signal.signal));assert.equal(g.calls.length,7);
 const h=fixture();h.reader.close();await assert.rejects(h.reader.read('open',h.signal.signal));assert.deepEqual(h.calls,[]);
 assert.throws(()=>new LocalCheckoutProofReader(manifest(),HEAD,{...target,extra:true},{} as never,()=>NOW));
});
test('provider-only invoice/subscription, hidden page or missing page marker blocks admission',async()=>{
 for(const kind of ['invoices','subscriptions'] as const){for(const mode of ['record','more','missing']){
  const f=fixture();if(mode==='record')f.data[kind].data.push({id:'orphan'});
  else if(mode==='more')f.data[kind].has_more=true;else Reflect.deleteProperty(f.data[kind],'has_more');
  await assert.rejects(f.reader.read('open',f.signal.signal));assert.equal(f.calls.includes('session'),false);
 }}
});
test('SDK projection exposes only seven GET methods and leaves policy/client configuration untouched',async()=>{
 const calls:unknown[]=[],get=(name:string)=>(...args:unknown[])=>{calls.push([name,args]);return Promise.resolve({});};
 const sdk={accounts:{retrieve:get('platform')},balance:{retrieve:get('balance')},v2:{core:{accounts:{retrieve:get('customer')}}},
  testHelpers:{testClocks:{retrieve:get('clock')}},invoices:{list:get('invoices')},subscriptions:{list:get('subscriptions')},checkout:{sessions:{retrieve:get('session')}}};
 const reads=stripeCheckoutReads(sdk as unknown as Stripe);assert.deepEqual(calls,[]);
 await reads.platform();await reads.balance();await reads.customer(target.customerAccountId);await reads.clock(target.clockId);
 await reads.invoices(target.customerAccountId);await reads.subscriptions(target.customerAccountId);await reads.checkout(target.sessionId);
 assert.deepEqual(calls,[['platform',[null]],['balance',[]],['customer',[target.customerAccountId,{include:['configuration.customer']}]],
  ['clock',[target.clockId]],['invoices',[{customer_account:target.customerAccountId,limit:1}]],
  ['subscriptions',[{customer_account:target.customerAccountId,status:'all',limit:1}]],['session',[target.sessionId]]]);
});

test('actual encrypted request/response round trip binds original nonce, proof and manifest',async()=>{
 const f=fixture(),key=Buffer.alloc(32,9),opening=await f.reader.read('open',f.signal.signal);
 const original=createProofRequest(f.m,opening,key,NOW+1000),decoded=decodeProofRequest(original.ciphertext,key,f.m,opening,NOW+1000);
 assert.deepEqual(decoded,original.request);f.setTime(NOW+1000);
 const proof=await f.reader.read('pre-submit',f.signal.signal),reply=createProofResponse(decoded,f.m,opening,proof,key,NOW+1000);
 assert.deepEqual(decodeProofResponse(reply,key,decoded,f.m,opening,NOW+1000),proof);
 assert.equal(reply.includes(Buffer.from(proof.url)),false);assert.equal(original.ciphertext.includes(Buffer.from(decoded.requestNonce)),false);
});
test('wrong key, modified ciphertext, other request nonce and stale exchange fail without fallback',async()=>{
 const f=fixture(),key=Buffer.alloc(32,9),opening=await f.reader.read('open',f.signal.signal);
 const original=createProofRequest(f.m,opening,key,NOW+1000);f.setTime(NOW+1000);const proof=await f.reader.read('pre-submit',f.signal.signal);
 const reply=createProofResponse(original.request,f.m,opening,proof,key,NOW+1000);
 assert.throws(()=>decodeProofResponse(reply,Buffer.alloc(32,8),original.request,f.m,opening,NOW+1000));
 const altered=Buffer.from(reply);altered[altered.length-1]^=1;
 assert.throws(()=>decodeProofResponse(altered,key,original.request,f.m,opening,NOW+1000));
 assert.throws(()=>decodeProofResponse(reply,key,{...original.request,requestNonce:'f'.repeat(32)},f.m,opening,NOW+1000));
 assert.throws(()=>decodeProofResponse(reply,key,original.request,f.m,opening,NOW+31001));
 assert.throws(()=>decodeProofRequest(original.ciphertext,key,f.m,{...opening,proofNonce:'f'.repeat(32)},NOW+1000));
});
test('fresh proof from before this request and extra encrypted fields cannot satisfy new request',async()=>{
 const f=fixture(),key=Buffer.alloc(32,9),opening=await f.reader.read('open',f.signal.signal);
 f.setTime(NOW+1000);const proof=await f.reader.read('pre-submit',f.signal.signal);
 const request=createProofRequest(f.m,opening,key,NOW+2000);
 assert.throws(()=>createProofResponse(request.request,f.m,opening,proof,key,NOW+2000));
 const extras=seal({...request.request,providerKey:'OFFLINE-NOT-A-KEY'},key);
 assert.throws(()=>decodeProofRequest(extras,key,f.m,opening,NOW+2000));
});

test('real parent files retain proof request before sole injected upload and original encrypted response before use',async()=>{
 for(const mode of ['normal','tamper','disk','ciphertext','abort','bad-receipt']){
  const f=fixture(),key=Buffer.alloc(32,9),opening=await f.reader.read('open',f.signal.signal);
  f.setTime(NOW+1000);const proof=await f.reader.read('pre-submit',f.signal.signal);
  const root=mkdtempSync(join(tmpdir(),'g2g-proof-exchange-'));
  const parent=new CheckoutDurableParent(root,f.m,HEAD,key,async()=>{throw Error('No financial upload admitted.');},()=>NOW+1000);
  let uploads=0,downloads=0,reply:Buffer|undefined;
  const transport={upload:async(phase:'open-proof',bytes:Buffer):Promise<RetainedCheckoutAsset>=>{
   uploads++;const directory=join(root,readdirSync(root)[0]!);
   assert.ok(readdirSync(directory).includes('proof-request-upload.intent.json'));
   assert.ok(readFileSync(join(directory,assetName(f.m,'open-proof'))).equals(bytes));
   const request=decodeProofRequest(bytes,key,f.m,opening,NOW+1000);
   assert.equal(digest(JSON.parse(readFileSync(join(directory,'proof-request.original.json'),'utf8'))),digest(request));
   reply=createProofResponse(request,f.m,opening,proof,key,NOW+1000);if(mode==='tamper')reply[reply.length-1]^=1;
   if(mode==='disk')writeFileSync(join(directory,'proof-request.original.json'),'{}');
   if(mode==='ciphertext')writeFileSync(join(directory,assetName(f.m,'open-proof')),Buffer.alloc(bytes.length,9));
   if(mode==='abort')f.signal.abort();
   return{phase,name:assetName(f.m,phase),assetId:9,size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),
    releaseId:f.m.releaseId,jobId:f.m.job.id,jobNonce:f.m.job.nonce,headSha:HEAD,operationId:f.m.operationId,
    anonymousDraft404:true,anonymousAsset404:(mode!=='bad-receipt') as true,exactRetainedAssetVerified:true,readbackVerified:true,
    observedAt:new Date(NOW+1000).toISOString(),retryAllowed:false,paymentAccepted:false};
  },download:async()=>{downloads++;return Buffer.from(reply!);}};
  try{
   if(mode!=='normal')await assert.rejects(parent.requestPreSubmitProof(opening,transport,f.signal.signal));
   else assert.deepEqual(await parent.requestPreSubmitProof(opening,transport,f.signal.signal),proof);
   const expectedDownloads=['normal','tamper','disk'].includes(mode)?1:0;
   assert.equal(uploads,1);assert.equal(downloads,expectedDownloads);
   if(expectedDownloads)assert.ok(readFileSync(join(root,readdirSync(root)[0]!,assetName(f.m,'submit-proof'))).equals(reply!));
   await assert.rejects(parent.requestPreSubmitProof(opening,transport,new AbortController().signal));assert.equal(uploads,1);assert.equal(downloads,expectedDownloads);
  }finally{parent.close();reply?.fill(0);}
 }
});

test('member start gate admits only exact normal-user input, Linux24 and four-variable environment',async()=>{
 const f=fixture(),opening=await f.reader.read('open',f.signal.signal),environment={PATH:'/usr/bin',HOME:'/home/fixture',TMPDIR:'/tmp/fixture',PLAYWRIGHT_BROWSERS_PATH:'/tmp/browsers'};
 const start={protocol:1,kind:'checkout-member-start',expectedHead:HEAD,
  binding:{manifestDigest:digest(f.m),connectionNonce:'c'.repeat(32)},input:{manifest:f.m,
   member:{id:approved.memberId,userId:approved.actorId,email:approved.memberEmail,password:'PUBLIC-OFFLINE-NOT-A-CREDENTIAL'},
   stagingBypass:'PUBLIC-OFFLINE-NOT-A-BYPASS',proof:opening}};
 assert.equal(validateMemberStart(start,environment,'linux',24,NOW).input.member.userId,approved.actorId);
 for(const [payload,env,platform,major] of [[start,environment,'win32',24],[start,environment,'linux',25],
  [start,{...environment,STRIPE_SECRET_KEY:'PUBLIC-OFFLINE-NOT-A-KEY'},'linux',24],
  [{...start,binding:{...start.binding,manifestDigest:'0'.repeat(64)}},environment,'linux',24],
  [{...start,expectedHead:'0'.repeat(40)},environment,'linux',24],
  [{...start,input:{...start.input,adminToken:'PUBLIC-OFFLINE-NOT-A-TOKEN'}},environment,'linux',24]] as const){
  assert.throws(()=>validateMemberStart(payload,env,platform,major,NOW));
 }
});
test('actual native member entrypoint rejects unapproved CLI or environment without public output',async()=>{
 for(const argument of ['--do-not-execute','--execute-hosted-member']){
  const child=fork(fileURLToPath(new URL('../src/checkout-hosted-member.mjs',import.meta.url)),[argument],{
   execArgv:['--experimental-strip-types'],env:{PATH:process.env.PATH!},stdio:['ignore','pipe','pipe','ipc']});
  let bytes=0;child.stdout?.on('data',data=>{bytes+=data.length;});child.stderr?.on('data',data=>{bytes+=data.length;});
  const code=await new Promise<number|null>((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Member rejection child timed out.'));},5000);
   child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  assert.equal(code,1);assert.equal(bytes,0);
 }
});
