// Provider doubles and temporary SQLite only. No staging key, journal or payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,readdirSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CurrentCheckoutProofReader } from '../src/checkout-current-provider.ts';
import { CurrentCheckoutRootBroker } from '../src/checkout-current-root.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { currentInput,currentProfile,now } from './fixtures/current-checkout.ts';
import { validateCurrentCheckoutInput } from '../src/checkout-current-input.ts';
import { validateCurrentCheckoutPhase,type CurrentCheckoutPhase } from '../src/checkout-current-phase.ts';
import type { CurrentMemberIdentity } from '../src/checkout-current-member.ts';
const input=validateCurrentCheckoutInput(currentInput(),currentProfile(),now);
const identity:CurrentMemberIdentity={userId:input.member.userId,sessionVersion:0,observedAt:new Date(now).toISOString(),normalMemberOnly:true,billingManagementVerified:true};
function provider(){const calls:string[]=[],target={customerAccountId:input.proof.customerAccountId,sessionId:input.proof.checkout.sessionId,clockId:'clock_publicFixture',frozenTime:1780000000};
 const p=input.profile,data={platform:{id:input.proof.platformAccountId},balance:{livemode:false},
  customer:{id:target.customerAccountId,livemode:false,configuration:{customer:{test_clock:target.clockId}}},
  clock:{id:target.clockId,name:`givetogive:${p.runId}`,livemode:false,status:'ready',frozen_time:target.frozenTime},
  invoices:{data:[] as unknown[],has_more:false},subscriptions:{data:[] as unknown[],has_more:false},
  session:{id:target.sessionId,customer_account:target.customerAccountId,client_reference_id:p.operationId,livemode:false,currency:'usd',amount_total:500,
   mode:'subscription',status:'open',payment_status:'unpaid',expires_at:input.proof.checkout.expiresAt,url:input.proof.checkout.url,
   success_url:`${p.origin}/giving/${p.operationId}?checkout=returned`,cancel_url:`${p.origin}/giving/${p.operationId}?checkout=canceled`,invoice:null,subscription:null,payment_intent:null}};
 let time=now,onRead=()=>{};const read=async(kind:keyof typeof data)=>{calls.push(kind);onRead();return structuredClone(data[kind]);};
 const reader=new CurrentCheckoutProofReader(input,target,{platform:()=>read('platform'),balance:()=>read('balance'),customer:()=>read('customer'),clock:()=>read('clock'),
  invoices:()=>read('invoices'),subscriptions:()=>read('subscriptions'),checkout:()=>read('session')},()=>time);
 return {reader,data,calls,setTime:(value:number)=>{time=value;},onRead:(fn:()=>void)=>{onRead=fn;}};
}
test('current provider reader is inert and performs seven exact fresh GET observations per ordered phase',async()=>{
 const f=provider();assert.deepEqual(f.calls,[]);
 for(const phase of ['opening','fixture','notice','submission'] as const){const proof=await f.reader.read(phase,new AbortController().signal);
  assert.equal(proof.checkout.amountTotal,500);assert.equal(proof.checkout.url,input.proof.checkout.url);assert.equal(proof.checkout.verifiedAt,new Date(now).toISOString());}
 assert.equal(f.calls.length,28);await assert.rejects(()=>f.reader.read('submission',new AbortController().signal));assert.equal(f.calls.length,28);
});
test('foreign/live/moving-clock and provider-only state reject before transferable proof',async()=>{
 const mutate=[(f:ReturnType<typeof provider>)=>{f.data.balance.livemode=true;},(f:ReturnType<typeof provider>)=>{f.data.customer.id='acct_other';},
  (f:ReturnType<typeof provider>)=>{f.data.clock.status='advancing';},(f:ReturnType<typeof provider>)=>{f.data.clock.frozen_time++;},
  (f:ReturnType<typeof provider>)=>{f.data.invoices.data.push({id:'public_orphan'});},(f:ReturnType<typeof provider>)=>{f.data.subscriptions.has_more=true;}];
 for(const change of mutate){const f=provider();change(f);await assert.rejects(()=>f.reader.read('opening',new AbortController().signal));const count=f.calls.length;
  await assert.rejects(()=>f.reader.read('opening',new AbortController().signal));assert.equal(f.calls.length,count);}
});
test('changed amount, session fragment, owner, return URL and settled state cannot produce a proof',async()=>{
 for(const patch of [{amount_total:1500},{url:input.proof.checkout.url+'changed'},{client_reference_id:'other'},
  {success_url:'https://example.invalid'},{payment_status:'paid'},{status:'expired'},{invoice:'in_public'}]){
  const f=provider();Object.assign(f.data.session,patch);await assert.rejects(()=>f.reader.read('opening',new AbortController().signal));assert.equal(f.calls.length,7);
 }
});
test('abort and slow provider rounds cannot freshen old proof timestamps or repeat reads',async()=>{
 for(const mode of ['abort','slow'] as const){const f=provider(),controller=new AbortController();
  f.onRead(()=>{if(mode==='abort')controller.abort();else f.setTime(now+30001);});
  await assert.rejects(()=>f.reader.read('opening',controller.signal));assert.equal(f.calls.length,1);
 }
});
function rootFixture(budget=2500){const root=mkdtempSync(join(tmpdir(),'g2g-current-root-')),ledger=new SandboxLedger(join(root,'original.sqlite'),input.profile.runId,budget,1500),f=provider();
 ledger.reserve('c89fc875-d2d2-41a9-81bd-a1cb246ad53c','other-public-member',500,'success');ledger.update('c89fc875-d2d2-41a9-81bd-a1cb246ad53c','ambiguous');
 const calls:string[]=[],directory=join(root,`current-checkout-root-${input.profile.runId}-${input.profile.operationId}`);
 const options={root,key:Buffer.alloc(32,7),ledger,reader:f.reader,verifyCurrent:async(phase:CurrentCheckoutPhase)=>{calls.push('context:'+phase);},
  verifyOriginalBudget:async(phase:CurrentCheckoutPhase)=>{calls.push('budget:'+phase);},readMember:async()=>identity,now:()=>now};
 const broker=new CurrentCheckoutRootBroker(input,options);return {root,directory,ledger,f,options,broker,calls};
}
test('root reserves/acknowledges/submits once in the supplied ledger and preserves prior ambiguous holds',async()=>{
 const h=rootFixture();const noticeFlags:boolean[]=[];
 h.options.verifyOriginalBudget=async(...args:[CurrentCheckoutPhase,AbortSignal?,boolean?])=>{noticeFlags.push(args[2]??false);};
 let previous=input.proof;const nonces=new Set<string>();try{
  for(const phase of ['opening','fixture','notice','submission'] as const){const packet=await h.broker.phase(phase,identity,new AbortController().signal);
   validateCurrentCheckoutPhase(packet,phase,input.profile,previous,now,nonces);nonces.add(packet.nonce);previous=packet.proof;
   assert.equal(h.ledger.get(input.profile.operationId)?.state,phase==='submission'?'submitted':'reserved');}
  assert.deepEqual(noticeFlags,[false,false,false,true]);
  assert.equal(h.ledger.report().length,2);assert.equal(h.ledger.report().reduce((total,row)=>total+Number(row.reservedCents),0),1000);
  assert.equal(h.ledger.get('c89fc875-d2d2-41a9-81bd-a1cb246ad53c')?.state,'ambiguous');
  await assert.rejects(()=>h.broker.phase('submission',identity,new AbortController().signal));
  for(const file of readdirSync(h.directory))if(file.endsWith('.json'))assert.doesNotMatch(readFileSync(join(h.directory,file),'utf8'),/public-fixture-password|public-fixture-bypass|checkout\.stripe/);
 }finally{h.broker.close();h.ledger.close();}
});
test('budget exhaustion never releases prior holds or makes a failed phase retryable',async()=>{
 const h=rootFixture(500);try{await assert.rejects(()=>h.broker.phase('opening',identity,new AbortController().signal));assert.equal(h.ledger.report().length,1);
  assert.equal(h.ledger.get(input.profile.operationId),undefined);assert.ok(existsSync(join(h.directory,'opening-admission-intent.json')));
  await assert.rejects(()=>h.broker.phase('opening',identity,new AbortController().signal));assert.equal(h.ledger.report().length,1);
 }finally{h.broker.close();h.ledger.close();}
});
test('lost reservation response retains the committed hold and forbids a second admission',async()=>{
 const h=rootFixture();const reserve=h.ledger.reserve.bind(h.ledger);
 h.ledger.reserve=(...args)=>{reserve(...args);throw Error('public ambiguous response fixture');};
 try{await assert.rejects(()=>h.broker.phase('opening',identity,new AbortController().signal));assert.equal(h.ledger.get(input.profile.operationId)?.state,'reserved');
  await assert.rejects(()=>h.broker.phase('opening',identity,new AbortController().signal));assert.equal(h.ledger.report().length,2);
 }finally{h.broker.close();h.ledger.close();}
});
test('independent member mismatch or original-budget rejection prevents reservation',async()=>{
 for(const mode of ['member','budget'] as const){const h=rootFixture();
  if(mode==='member')h.options.readMember=async()=>({...identity,userId:'other'});
  else h.options.verifyOriginalBudget=async()=>{throw Error('public denied budget fixture');};
  try{await assert.rejects(()=>h.broker.phase('opening',identity,new AbortController().signal));assert.equal(h.ledger.get(input.profile.operationId),undefined);}
  finally{h.broker.close();h.ledger.close();}
 }
});
