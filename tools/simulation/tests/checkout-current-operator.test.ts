// Public snapshot fixtures only; real provider/DB execution is a separate native check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCurrentOperatorSnapshot } from '../../../scripts/checkout-current-operator-inspect.mjs';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
const ids=['c89fc875-d2d2-41a9-81bd-a1cb246ad53c','92aa9a3f-d47f-4af1-a333-9456ea34b727',c.operationId];
function fixture(prepared=false){
 const members=[1,2,3].map(index=>{const suffix=String(index).padStart(3,'0');return {id:`synthetic-bcfa98ea084ed93e-${suffix}`,
 agent_id:`bot_bcfa98ea084ed93e_${suffix}`,email:`neighbor-bcfa98ea084ed93e-${suffix}@givetogive.invalid`,role:'member',is_synthetic:true,verified:true,frozen:false};});
 const plan={runId:c.runId,runBudgetCents:2500,actorBudgetCents:1500,steps:members.map((m,index)=>({operationId:ids[index],agentId:m.agent_id,
 maximumAmountCents:index===1?1500:500,checkout:{kind:'supporter',tier:index===1?'sustainer':'supporter',recurring:true},scenario:index===2?'decline':'success'}))};
 const data={run:{mode:'deterministic',environment:'staging',database_identity:String(c.databaseIdentity),agent_count:3,status:'created',created_by:'public-owner'},members,
 accounts:members.map((m,index)=>({user_id:m.id,stripe_account_id:'acct_public'+index,livemode:false})),
 bindings:members.map((m,index)=>({actor_id:m.id,entity_id:'clock_publicFixture',run_id:c.runId,environment:'staging',outcome:'completed',
 details:{accountId:'acct_public'+index,version:1,databaseIdentity:String(c.databaseIdentity),livemode:false}})),
 clockOperation:{status:'completed',result:{runId:c.runId,clockId:'clock_publicFixture',livemode:false,initialFrozenTime:1780000000}},
 payments:plan.steps.slice(0,prepared?3:2).map((s,index)=>({id:s.operationId,actor_id:members[index]!.id,status:index===2?'checkout_open':'expired',livemode:false,
 kind:'supporter',currency:'usd',gross_amount:s.maximumAmountCents,tier:s.checkout.tier,recurring:true,paid_at:null,refunded_amount:0,disputed_amount:0,checkout_id:'cs_test_public'+index})),
 counts:{subscriptions:0,coverage:0,ledger:0}};
 return {data,plan};
}
test('current snapshot preserves both prior original operations and exactly identifies the unused actor',()=>{
 const f=fixture(),result=validateCurrentOperatorSnapshot(f.data,f.plan);assert.equal(result.targets.length,3);assert.equal(result.payments.length,2);
 assert.equal(result.targets[2]!.actorId,c.memberId);assert.equal(result.frozenTime,1780000000);
 assert.deepEqual(result.payments.map(p=>p.id),ids.slice(0,2));
});
test('prepared observation requires exactly the same candidate, amount, actor and unpaid state',()=>{
 const f=fixture(true);assert.equal(validateCurrentOperatorSnapshot(f.data,f.plan,true).payments.length,3);
 assert.throws(()=>validateCurrentOperatorSnapshot(f.data,f.plan,false));
 for(const change of [(d:typeof f.data)=>{d.payments[2]!.actor_id=d.members[0]!.id;},
 (d:typeof f.data)=>{d.payments[2]!.gross_amount=1500;},(d:typeof f.data)=>{d.payments[2]!.status='expired';},
 (d:typeof f.data)=>{d.payments[2]!.checkout_id='cs_live_public';}]){
 const next=fixture(true);change(next.data);assert.throws(()=>validateCurrentOperatorSnapshot(next.data,next.plan,true));}
 assert.throws(()=>validateCurrentOperatorSnapshot(fixture().data,f.plan,true));
});
test('foreign member, moved clock, extra mapping or settled app state cannot qualify prerequisites',()=>{
 const mutations=[(d:ReturnType<typeof fixture>['data'])=>{d.run.database_identity='foreign';},
 (d:ReturnType<typeof fixture>['data'])=>{d.members[0]!.frozen=true;},(d:ReturnType<typeof fixture>['data'])=>{d.members[0]!.role='admin';},
 (d:ReturnType<typeof fixture>['data'])=>{d.members[0]!.verified=false;},(d:ReturnType<typeof fixture>['data'])=>{d.members[0]!.is_synthetic=false;},
 (d:ReturnType<typeof fixture>['data'])=>{d.members[0]!.email='foreign@givetogive.invalid';},
 (d:ReturnType<typeof fixture>['data'])=>{d.accounts[0]!.livemode=true;},
 (d:ReturnType<typeof fixture>['data'])=>{d.accounts.push({...d.accounts[0]!});},
 (d:ReturnType<typeof fixture>['data'])=>{d.bindings[0]!.entity_id='clock_other';},
 (d:ReturnType<typeof fixture>['data'])=>{d.bindings[0]!.details.databaseIdentity='foreign';},
 (d:ReturnType<typeof fixture>['data'])=>{d.clockOperation.result.livemode=true;},
 (d:ReturnType<typeof fixture>['data'])=>{d.clockOperation.result.initialFrozenTime=0;},
 (d:ReturnType<typeof fixture>['data'])=>{d.counts.subscriptions=1;},(d:ReturnType<typeof fixture>['data'])=>{d.counts.coverage=1;},
 (d:ReturnType<typeof fixture>['data'])=>{d.counts.ledger=1;},
 (d:ReturnType<typeof fixture>['data'])=>{d.payments[0]!.refunded_amount=500;},
 (d:ReturnType<typeof fixture>['data'])=>{d.payments[0]!.disputed_amount=500;},
 (d:ReturnType<typeof fixture>['data'])=>{d.payments[0]!.id=ids[1];},
 (d:ReturnType<typeof fixture>['data'])=>{d.payments[0]!.status='processing';}];
 for(const mutate of mutations){const f=fixture();mutate(f.data);assert.throws(()=>validateCurrentOperatorSnapshot(f.data,f.plan));}
});
test('current inspector default/import cannot authenticate, mutate or contact external providers',()=>{
 const entry=fileURLToPath(new URL('../../../scripts/checkout-current-operator-inspect.mjs',import.meta.url));
 const value=JSON.parse(execFileSync(process.execPath,[entry],{encoding:'utf8',windowsHide:true,timeout:15000}));
 assert.deepEqual(value,{execute:false,externalRequests:0,databaseWrites:0,memberActions:0,checkoutCreated:false,paymentAccepted:false});
});
