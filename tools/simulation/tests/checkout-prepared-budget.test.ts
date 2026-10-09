// Temporary, public fixtures only; no real journals, provider calls or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,renameSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { UiCheckoutPreparation } from '../src/ui-checkout-preparation.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { inspectPreparedCheckoutCandidateBudget } from '../src/checkout-prepared-budget.ts';
import { inspectUnusedCheckoutCandidateBudget } from '../src/checkout-candidate-budget.ts';
import type { Credentials } from '../src/protocol.ts';
import type { SandboxPlan } from '../src/sandbox-plan.ts';
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const headSha='a'.repeat(40);
const credentials:Credentials={runId:'prepared-budget-fixture',mode:'deterministic',origin:'https://givetogive-staging.vercel.app',
 databaseIdentity:'public-fixture',runnerToken:'public-fixture-token-000000',agents:['a','b','c'].map(id=>({
 id,userId:'member-'+id,token:'public-fixture-token-'+id,email:id+'@givetogive.invalid'}))};
const plan:SandboxPlan={runId:credentials.runId!,runBudgetCents:2500,actorBudgetCents:1500,steps:['a','b','c'].map((agentId,index)=>({
 operationId:`20000000-0000-4000-8000-00000000000${index+1}`,agentId,scenario:index===2?'decline':'success',
 maximumAmountCents:index===1?1500:500,expectedTier:index===2?'neighbor':index===1?'sustainer':'supporter',
 checkout:{kind:'supporter',tier:index===1?'sustainer':'supporter',recurring:true}}))};
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'g2g-prepared-budget-')),bytes=Buffer.from(JSON.stringify(plan)),digest=hash(bytes);
 const planPath=join(directory,'financial-plan.json'),uiPath=join(directory,'financial-intents.sqlite'),attemptPath=join(directory,'financial-attempts.sqlite');
 const current=plan.steps[2]!,intentPath=join(directory,`ui-acceptance-${current.operationId}.intent.json`);
 writeFileSync(planPath,bytes);
 const ui=new UiCheckoutPreparation(uiPath,plan);try{for(const step of plan.steps)await ui.prepare({userId:'member-'+step.agentId,
 query:async()=>undefined,mutate:async()=>({publicFixture:true})},'member-'+step.agentId,step);}finally{ui.close();}
 const ledger=new SandboxLedger(attemptPath,plan.runId,2500,1500);try{
 ledger.reserve(plan.steps[0]!.operationId,'member-a',500,'success');ledger.update(plan.steps[0]!.operationId,'ambiguous');}finally{ledger.close();}
 // Different property order is valid; exact byte readback must not compare parsed key order.
 const intent={preparationOnly:true,createdAt:'2026-10-08T01:00:00.000Z',maximumAmountCents:500,scenario:'decline',
 planDigest:digest,headSha,actorId:'member-c',operationId:current.operationId,runId:plan.runId};
 writeFileSync(intentPath,JSON.stringify(intent));
 const inspect=(financialState:'unadmitted'|'reserved'|'submitted'='unadmitted',noticeConsumed=false)=>
 inspectPreparedCheckoutCandidateBudget(directory,digest,credentials,current.operationId,{financialState,noticeConsumed,headSha});
 const financial=(fn:(ledger:SandboxLedger)=>void)=>{const l=new SandboxLedger(attemptPath,plan.runId,2500,1500);try{fn(l);}finally{l.close();}};
 return {directory,digest,planPath,uiPath,attemptPath,intentPath,intent,current,inspect,financial,
 cleanup(){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));rmSync(directory,{recursive:true});}};
}
function change(path:string,sql:string){const db=new DatabaseSync(path);try{db.exec(sql);}finally{db.close();}}
test('prepared observation preserves every old hold, counts current UI once and writes nothing',async()=>{
 const f=await fixture();try{const paths=[f.planPath,f.uiPath,f.attemptPath,f.intentPath],before=paths.map(p=>hash(readFileSync(p)));
 const result=f.inspect();assert.equal(result.uiHeldCents,2500);assert.equal(result.attemptHeldCents,500);
 assert.equal(result.actorUiHeldCents,500);assert.equal(result.actorAttemptHeldCents,0);
 assert.equal(result.expiredAndAmbiguousHoldsPreserved,true);assert.equal(result.crossJournalAtomic,false);
 assert.equal(result.financialAdmission,false);assert.equal(result.databaseWrites,0);
 assert.deepEqual(paths.map(p=>hash(readFileSync(p))),before);
 assert.throws(()=>inspectUnusedCheckoutCandidateBudget(f.directory,f.digest,credentials,f.current.operationId),/budget unconfirmed/);
 }finally{f.cleanup();}
});
test('original reservation, consumed notice and submitted boundaries must match exactly',async()=>{
 const f=await fixture();try{assert.throws(()=>f.inspect('reserved'),/budget unconfirmed/);
 f.financial(l=>l.reserve(f.current.operationId,'member-c',500,'decline'));
 assert.equal(f.inspect('reserved').attemptHeldCents,1000);assert.throws(()=>f.inspect(),/budget unconfirmed/);
 assert.throws(()=>f.inspect('reserved',true),/budget unconfirmed/);
 f.financial(l=>l.acknowledgeAgentNotice(f.current.operationId,'member-c'));
 assert.throws(()=>f.inspect('reserved'),/budget unconfirmed/);assert.equal(f.inspect('reserved',true).noticeConsumed,true);
 f.financial(l=>l.update(f.current.operationId,'submitted'));
 assert.throws(()=>f.inspect('reserved',true),/budget unconfirmed/);assert.equal(f.inspect('submitted',true).attemptHeldCents,1000);
 f.financial(l=>l.update(f.current.operationId,'ambiguous'));assert.throws(()=>f.inspect('submitted',true),/budget unconfirmed/);
 }finally{f.cleanup();}
});
test('missing stores, missing intent and stale source fail without replacement creation',async()=>{
 for(const which of ['uiPath','attemptPath','intentPath'] as const){const f=await fixture();try{
 renameSync(f[which],f[which]+'.preserved');assert.throws(()=>f.inspect(),/budget unconfirmed/);assert.equal(existsSync(f[which]),false);
 }finally{f.cleanup();}}
 const f=await fixture();try{writeFileSync(f.intentPath,JSON.stringify({...f.intent,headSha:'b'.repeat(40)}));assert.throws(()=>f.inspect(),/budget unconfirmed/);
 assert.throws(()=>inspectPreparedCheckoutCandidateBudget(f.directory,'0'.repeat(64),credentials,f.current.operationId,{financialState:'unadmitted',noticeConsumed:false,headSha}),/budget unconfirmed/);
 }finally{f.cleanup();}
});
test('prior unresolved holds stay counted but an unresolved current operation cannot proceed',async()=>{
 const f=await fixture();try{change(f.uiPath,`UPDATE ui_checkout_intent SET state='unresolved' WHERE operation_id='${plan.steps[1]!.operationId}'`);
 assert.equal(f.inspect().uiHeldCents,2500);change(f.uiPath,`UPDATE ui_checkout_intent SET state='unresolved' WHERE operation_id='${f.current.operationId}'`);
 assert.throws(()=>f.inspect(),/budget unconfirmed/);
 }finally{f.cleanup();}
});
test('foreign records, changed budgets, unmatched notices and existing results prohibit continuation',async()=>{
 for(const mutation of [
 (f:Awaited<ReturnType<typeof fixture>>)=>change(f.uiPath,'UPDATE ui_checkout_budget SET run_budget=3000'),
 (f:Awaited<ReturnType<typeof fixture>>)=>change(f.uiPath,"UPDATE ui_checkout_intent SET actor_id='other'"),
 (f:Awaited<ReturnType<typeof fixture>>)=>change(f.attemptPath,"UPDATE sandbox_attempts SET run_id='other'"),
 (f:Awaited<ReturnType<typeof fixture>>)=>change(f.attemptPath,`INSERT INTO sandbox_agent_acknowledgments VALUES ('${plan.runId}','${f.current.operationId}','member-c',1)`),
 (f:Awaited<ReturnType<typeof fixture>>)=>writeFileSync(join(f.directory,`ui-acceptance-${f.current.operationId}.result.json`),'{}')
 ]){const f=await fixture();try{mutation(f);assert.throws(()=>f.inspect(),/budget unconfirmed/);}finally{f.cleanup();}}
 const f=await fixture();try{assert.throws(()=>f.inspect('unadmitted',true),/budget unconfirmed/);}finally{f.cleanup();}
});
