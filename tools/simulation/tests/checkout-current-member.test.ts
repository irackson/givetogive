import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCurrentCheckoutMember,runCurrentCheckoutMember,closePreparedCurrentCheckoutMember,
 deriveCurrentMemberIdentity,type CurrentMemberRuntime,type CurrentMemberBroker } from '../src/checkout-current-member.ts';
import { validateCurrentCheckoutInput } from '../src/checkout-current-input.ts';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
import { now,head,source,currentInput,memberReadFixtures } from './fixtures/current-checkout.ts';
function fixture(){
 const input=currentInput(),reads=memberReadFixtures(),calls:string[]=[],controller=new AbortController();let time=now,nonce=0;
 const controls:{fail?:string;notice?:boolean;closeFails?:boolean;sessionCloseFails?:boolean;proofChange?:Record<string,unknown>;
  packetNonce?:string;advanceAfterProof?:boolean;hook?:(phase:string)=>Promise<void>}={notice:true};
 const step=(name:string)=>{calls.push(name);if(controls.fail===name)throw Error('PRIVATE-ADAPTER-FAILURE-WITHHELD');};
 const runtime:CurrentMemberRuntime={now:()=>time,driver:notice=>({
  async prepareBrowser(){step('browser');},preparedBrowserObservation:()=>({browserConnected:true,contextAbsent:true,checkoutAbsent:true,
   freeBytes:4*1024**3,paymentAccepted:false}),bindPreparedStagingAccess:()=>{step('bind');},async open(){step('open');},
  async fillFixture(scenario){assert.equal(scenario,'decline');if(controls.notice)await notice();step('fill');},async submit(){step('submit');},
  async closeConfirmed(){step('close');return {contextClosed:!controls.closeFails,browserClosed:!controls.closeFails,independentOsClosureRequired:true,paymentAccepted:false};},
 }),async signIn(account,bypass){assert.equal(account.userId,c.memberId);assert.equal(bypass,input.stagingBypass);step('sign-in');return{
  async readSession(){step('session');if(controls.advanceAfterProof&&nonce>0)time=now+31001;return structuredClone(reads.session);},
  async query(procedure){step(procedure);if(procedure==='billing.availability')return structuredClone(reads.availability);
   if(procedure==='billing.myOverview')return structuredClone(reads.overview);
   if(procedure==='billing.mySubscriptions')return structuredClone(reads.subscriptions);
   assert.equal(procedure,'billing.payment');return structuredClone(reads.payment);},
  async close(){step('api-close');if(controls.sessionCloseFails)throw Error('PRIVATE-CLOSE-FAILURE');},
 };}};
 const broker:CurrentMemberBroker={async phase(phase,identity,signal){signal.throwIfAborted();assert.equal(identity.userId,c.memberId);
  step('root-'+phase);await controls.hook?.(phase);return {protocol:1,purpose:'current-member-phase-proof',profileDigest:input.profileDigest,
   phase,nonce:controls.packetNonce??(++nonce).toString(16).padStart(32,'0'),admission:phase==='notice'?'notice':phase==='submission'?'submit':'none',
   proof:{...input.proof,checkout:{...input.proof.checkout,verifiedAt:new Date(time).toISOString(),...controls.proofChange}},
   paymentAccepted:false,retryAllowed:false};}};
 return {input,reads,calls,controls,controller,runtime,broker,
  prepare:()=>prepareCurrentCheckoutMember(input.profile,head,source,{signal:controller.signal,runtime})};
}
test('browser is acquired before private input/login, and injected readiness is never native evidence',async()=>{
 const f=fixture(),prepared=await f.prepare();assert.deepEqual(f.calls,['browser']);
 assert.equal(prepared.ready.executionEvidence,'injected-offline');assert.equal(prepared.ready.memberSignIns,0);
 assert.equal(prepared.ready.paymentAccepted,false);await closePreparedCurrentCheckoutMember(prepared);assert.deepEqual(f.calls,['browser','close']);
 await assert.rejects(runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal));
});
test('current fixed decline sequences normal identity, fresh root phases, notice, fill and one submit',async()=>{
 const f=fixture(),prepared=await f.prepare(),result=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);
 assert.equal(result.failed,false);assert.equal(result.submitAttempts,1);assert.equal(result.noticeRequests,1);assert.equal(result.memberSignIns,1);
 assert.equal(result.apiDisposed,true);assert.equal(result.driverClosed,true);assert.equal(result.paymentAccepted,false);
 assert.equal(result.phase,'submitted-pending-independent-verification');assert.equal(result.executionEvidence,'injected-offline');
 assert.deepEqual(f.calls.filter(s=>s.startsWith('root-')),['root-opening','root-fixture','root-notice','root-submission']);
 assert.ok(f.calls.indexOf('root-notice')<f.calls.indexOf('fill')&&f.calls.indexOf('root-submission')<f.calls.indexOf('submit'));
 await assert.rejects(runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal));assert.equal(f.calls.filter(s=>s==='submit').length,1);
});
test('each phase/root/driver failure consumes this adapter instance without later submit or retry',async()=>{
 for(const fail of ['sign-in','session','billing.payment','root-opening','open','root-fixture','root-notice','fill','root-submission','submit']){
  const f=fixture();f.controls.fail=fail;const prepared=await f.prepare();
  const result=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);assert.equal(result.failed,true);
  assert.equal(result.paymentAccepted,false);assert.ok(result.submitAttempts<=1);assert.equal(f.calls.filter(s=>s==='close').length,1);
  if(fail!=='submit')assert.equal(result.submitAttempts,0);
  await assert.rejects(runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal));
 }
});
test('invalid input and expired/changed root proofs stop before filling and do not expose private diagnostics',async()=>{
 for(const proofChange of [{actorId:'other'},{amountTotal:1500},{status:'expired'},
  {url:'https://checkout.stripe.com/c/pay/cs_test_other'},{verifiedAt:new Date(now-30001).toISOString()}]){
  const f=fixture();f.controls.proofChange=proofChange;const prepared=await f.prepare();
  const receipt=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);assert.equal(receipt.failed,true);
  assert.equal(receipt.submitAttempts,0);assert.equal(f.calls.includes('fill'),false);assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);
 }
 const f=fixture(),prepared=await f.prepare();const result=await runCurrentCheckoutMember(prepared,{...f.input,adminToken:'PRIVATE'},f.broker,f.controller.signal);
 assert.equal(result.failed,true);assert.equal(result.memberSignIns,0);assert.equal(f.calls.includes('sign-in'),false);
});
test('phase nonce reuse, member role/version changes and proof ageing during identity recheck prevent later actions',async()=>{
 for(const kind of ['nonce','role','version','age']){const f=fixture();
  if(kind==='nonce')f.controls.packetNonce='d'.repeat(32);
  if(kind==='age')f.controls.advanceAfterProof=true;
  f.controls.hook=async phase=>{if(phase==='fixture'&&kind==='role')f.reads.session.user.role='admin';
   if(phase==='fixture'&&kind==='version')f.reads.session.user.sessionVersion=1;};
  const prepared=await f.prepare(),receipt=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);
  assert.equal(receipt.failed,true);assert.equal(receipt.submitAttempts,0);assert.equal(f.calls.includes('fill'),false);
 }
});
test('explicit resource close or abort while a phase is pending cancels actions and closes exactly once',async()=>{
 for(const kind of ['close','abort']){const f=fixture(),prepared=await f.prepare();
  f.controls.hook=async phase=>{if(phase==='fixture'){if(kind==='close')await closePreparedCurrentCheckoutMember(prepared);else f.controller.abort();}};
  const receipt=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);
  assert.equal(receipt.failed,true);assert.equal(receipt.submitAttempts,0);assert.equal(f.calls.filter(s=>s==='close').length,1);
  assert.equal(f.calls.includes('fill'),false);
 }
});
test('cleanup failures remain failures even after the only submit, never positive resource or paid receipts',async()=>{
 for(const kind of ['driver','api']){const f=fixture();if(kind==='driver')f.controls.closeFails=true;else f.controls.sessionCloseFails=true;
  const prepared=await f.prepare(),receipt=await runCurrentCheckoutMember(prepared,f.input,f.broker,f.controller.signal);
  assert.equal(receipt.failed,true);assert.equal(receipt.submitAttempts,1);assert.equal(receipt.paymentAccepted,false);
  assert.equal(kind==='driver'?receipt.driverClosed:receipt.apiDisposed,false);
 }
});
test('identity requires unchanged active normal member and exact unpaid supporter operation/coverage',()=>{
 const input=currentInput(),proof=validateCurrentCheckoutInput(input,input.profile,now).proof,reads=memberReadFixtures();
 const derive=()=>deriveCurrentMemberIdentity(reads.session,reads.session,reads.availability,reads.overview,reads.subscriptions,reads.payment,proof,now);
 assert.equal(derive().userId,c.memberId);
 for(const change of [{grossAmount:1500},{tier:'sustainer'},{paidAt:new Date(now).toISOString()},{refundedAmount:1},{disputedAmount:1},
  {id:'another-operation'},{expiresAt:new Date(now+3600001+1000).toISOString()}]){
  const r=memberReadFixtures();Object.assign(r.payment,change);
  assert.throws(()=>deriveCurrentMemberIdentity(r.session,r.session,r.availability,r.overview,r.subscriptions,r.payment,proof,now));
 }
});
test('without injected runtime or owned native IPC, preparation cannot claim a native browser or login',async()=>{
 const input=currentInput();await assert.rejects(prepareCurrentCheckoutMember(input.profile,head,source,{signal:new AbortController().signal}));
});
