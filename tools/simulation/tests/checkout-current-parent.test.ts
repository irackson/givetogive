import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { prepareCurrentCheckoutParent,runCurrentCheckoutParent,closePreparedCurrentCheckoutParent,type CurrentParentRuntime } from '../src/checkout-current-parent.ts';
import { createCurrentMemberClient } from '../src/checkout-current-ipc.ts';
import type { CheckoutIpcPeer } from '../src/checkout-broker-ipc.ts';
import { currentProfile,currentInput,head,source,now } from './fixtures/current-checkout.ts';
import { currentProfileDigest } from '../src/checkout-current-phase.ts';
const environment={PATH:'/public/bin',HOME:'/public/home',TMPDIR:'/public/tmp',PLAYWRIGHT_BROWSERS_PATH:'/public/browser'};
function harness(options:{browser?:boolean;wrongReady?:boolean;leak?:boolean;reuse?:boolean;output?:boolean}={}) {
 const root=mkdtempSync(join(tmpdir(),'g2g-current-parent-')),profile=currentProfile();
 type Send=(value:unknown,callback:(error?:Error)=>void)=>void;
 const child=new EventEmitter() as EventEmitter&{pid:number;connected:boolean;stdout:EventEmitter;stderr:EventEmitter;send:Send;kill:()=>boolean;disconnect:()=>void};
 const member=new EventEmitter() as EventEmitter&{send:Send};
 child.pid=400;child.connected=true;child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 let alive=true,browser=false,time=now,launches=0,transfers=0,sourceChecks=0,kills=0;let client:ReturnType<typeof createCurrentMemberClient>|undefined;
 const nonce='d'.repeat(32);
 const finish=()=>{alive=false;browser=options.leak??false;child.connected=false;child.emit('exit',0);};
 member.send=(value:unknown,callback:(error?:Error)=>void)=>{child.emit('message',value);callback();};
 child.send=(raw:unknown,callback:(error?:Error)=>void)=>{
  const value=raw as {kind:string;input:ReturnType<typeof currentInput>};
  callback();
  if(value.kind==='current-member-prepare')queueMicrotask(()=>{browser=options.browser!==false;
   if(options.output)child.stdout.emit('data',Buffer.from('public unexpected output'));
   child.emit('message',{protocol:1,kind:'current-member-ready',ready:{protocol:1,purpose:'current-member-browser-ready',connectionNonce:nonce,
    profileDigest:options.wrongReady?'e'.repeat(64):currentProfileDigest(profile),freeBytes:4*1024**3,browserConnected:true,memberSignIns:0,
    paymentAccepted:false,retryAllowed:false,executionEvidence:'injected-offline'}});});
  else if(value.kind==='current-member-input'){transfers++;client=createCurrentMemberClient(member as unknown as CheckoutIpcPeer,{profileDigest:value.input.profileDigest,connectionNonce:nonce});
   queueMicrotask(async()=>{try{for(const phase of ['opening','fixture','submission'] as const)await client!.phase(phase,
    {userId:value.input.member.userId,sessionVersion:0,observedAt:new Date(time).toISOString(),normalMemberOnly:true,billingManagementVerified:true},new AbortController().signal);
    client!.close();child.emit('message',{protocol:1,kind:'current-member-receipt',connectionNonce:nonce,profileDigest:value.input.profileDigest,
     receipt:{protocol:1,purpose:'current-member-receipt',phase:'submitted-pending-independent-verification',failed:false,memberSignIns:1,
      noticeRequests:0,submitAttempts:1,apiDisposed:true,driverClosed:true,executionEvidence:'injected-offline',paymentAccepted:false,retryAllowed:false,
      independentJobOsProviderLedgerVerificationRequired:true,privateDetailsWithheld:true}});finish();}catch{finish();}});
  }else member.emit('message',value);
 };
 child.kill=()=>{kills++;finish();return true;};child.disconnect=()=>{child.connected=false;finish();};
 const runtime:CurrentParentRuntime={now:()=>time,freeBytes:()=>4*1024**3,parentPid:100,
  pause:async()=>{time+=100;await new Promise<void>(resolve=>setImmediate(resolve));},launch:env=>{assert.deepEqual(env,environment);launches++;return child as unknown as ChildProcess;},
  processes:()=>[
   ...(alive?[{pid:400,parentPid:100,startTicks:options.reuse&&browser?'reused':'root',processGroup:400,session:400,state:'S'}]:[]),
   ...(browser?[{pid:401,parentPid:alive?400:1,startTicks:'browser',processGroup:400,session:400,state:'S'}]:[]),
  ],browserExecutable:row=>row.pid===401,verifySources:()=>{sourceChecks++;},
 };
 const controller=new AbortController();
 return {root,profile,runtime,controller,prepare:()=>prepareCurrentCheckoutParent(profile,head,source,{root,memberEnvironment:environment,signal:controller.signal,runtime}),
  counters:()=>({launches,transfers,sourceChecks,kills}),child};
}
test('ordinary member is launched once with public profile and independently observed browser before input',async()=>{
 const h=harness(),prepared=await h.prepare();assert.equal(prepared.parentEvidence,'injected-offline');assert.equal(prepared.browserExecutableObserved,true);
 assert.equal(h.counters().transfers,0);const phases:string[]=[];
 const result=await runCurrentCheckoutParent(prepared,currentInput(),{phase:async phase=>{phases.push(phase);return {publicFixture:true};}});
 assert.equal(result.failed,false);assert.equal(result.paymentAccepted,false);assert.equal(result.privateFinalRetentionStillRequired,true);
 assert.deepEqual(phases,['opening','fixture','submission']);assert.equal(h.counters().launches,1);assert.equal(h.counters().transfers,1);
 assert.ok(h.counters().sourceChecks>=6);
 const directory=join(h.root,`current-checkout-${h.profile.runId}-${h.profile.operationId}`);
 const intent=readFileSync(join(directory,'input-transfer-intent.json'),'utf8');assert.doesNotMatch(intent,/public-fixture-password|public-fixture-bypass|checkout\.stripe/);
 await assert.rejects(()=>runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>({})}));
 await assert.rejects(()=>h.prepare());assert.equal(h.counters().launches,1);
});
test('protocol readiness without an actual owned browser rejects before private transfer',async()=>{
 for(const options of [{browser:false},{wrongReady:true},{reuse:true},{output:true}]){
  const h=harness(options);await assert.rejects(()=>h.prepare());assert.equal(h.counters().transfers,0);assert.equal(h.counters().launches,1);
 }
});
test('preflight rejects secret environments, low memory, changed source and abort before any child launch',async()=>{
 for(const kind of ['environment','memory','source','abort'] as const){const h=harness();
  const env=kind==='environment'?{...environment,STRIPE_SECRET_KEY:'public-fixture-forbidden'}:environment;
  if(kind==='memory')h.runtime.freeBytes=()=>2.49*1024**3;
  if(kind==='source')h.runtime.verifySources=()=>{throw Error('public fixture');};
  if(kind==='abort')h.controller.abort();
  await assert.rejects(()=>prepareCurrentCheckoutParent(h.profile,head,source,{root:h.root,memberEnvironment:env,signal:h.controller.signal,runtime:h.runtime}));
  assert.equal(h.counters().launches,0);
 }
});
test('closing an idle prepared parent prevents input, drains the owned group and cannot be cloned',async()=>{
 const h=harness(),prepared=await h.prepare();
 await assert.rejects(()=>closePreparedCurrentCheckoutParent({...prepared}));
 const closed=await closePreparedCurrentCheckoutParent(prepared);assert.equal(closed.ownedGroupClosed,true);
 await assert.rejects(()=>runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>({})}));assert.equal(h.counters().transfers,0);
});
test('surviving browser processes make final closure unsuccessful even when the child claims success',async()=>{
 const h=harness({leak:true}),prepared=await h.prepare();
 const result=await runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>({})});
 assert.equal(result.failed,true);assert.equal(result.cleanup.ownedGroupClosed,false);assert.equal(result.paymentAccepted,false);
});

test('backend failure is terminal and cannot cause another private transfer or member launch',async()=>{
 const h=harness(),prepared=await h.prepare();let phases=0;
 const result=await runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>{phases++;throw Error('public failure fixture');}});
 assert.equal(result.failed,true);assert.equal(result.paymentAccepted,false);assert.equal(phases,1);assert.equal(h.counters().transfers,1);
 await assert.rejects(()=>runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>({})}));
 await assert.rejects(()=>h.prepare());assert.equal(h.counters().launches,1);
});
test('idle cancellation closes the owner and prohibits late private input',async()=>{
 const h=harness(),prepared=await h.prepare();h.controller.abort();
 const closure=await closePreparedCurrentCheckoutParent(prepared);
 assert.equal(closure.ownedGroupClosed,true);assert.equal(h.counters().kills,1);
 await assert.rejects(()=>runCurrentCheckoutParent(prepared,currentInput(),{phase:async()=>({})}));assert.equal(h.counters().transfers,0);
});
test('cleanup never signals a replacement process with the same PID',async()=>{
 const h=harness(),prepared=await h.prepare();
 h.runtime.processes=()=>[{pid:400,parentPid:100,startTicks:'replacement',processGroup:400,session:400,state:'S'}];
 await closePreparedCurrentCheckoutParent(prepared);
 assert.equal(h.counters().kills,0);
});
test('invalid or stale private input closes the prepared owner before transfer',async()=>{
 for(const kind of ['secret','stale'] as const){const h=harness(),prepared=await h.prepare();const input=currentInput();
  const value=kind==='secret'?{...input,STRIPE_SECRET_KEY:'public-forbidden-fixture'}:
   {...input,proof:{...input.proof,checkout:{...input.proof.checkout,verifiedAt:new Date(now-30001).toISOString()}}};
  const result=await runCurrentCheckoutParent(prepared,value,{phase:async()=>({})});
  assert.equal(result.failed,true);assert.equal(h.counters().transfers,0);assert.equal(result.paymentAccepted,false);
 }
});
