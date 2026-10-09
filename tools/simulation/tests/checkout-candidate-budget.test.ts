import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { UiCheckoutPreparation } from '../src/ui-checkout-preparation.ts';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
import { inspectUnusedCheckoutCandidateBudget } from '../src/checkout-candidate-budget.ts';
import type { Credentials } from '../src/protocol.ts';
import type { SandboxPlan } from '../src/sandbox-plan.ts';

const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const credentials:Credentials={runId:'original-budget-fixture',mode:'deterministic',origin:'https://givetogive-staging.vercel.app',
 databaseIdentity:'public-fixture',runnerToken:'public-fixture-token-000000',agents:['a','b','c'].map(id=>({
  id,userId:'member-'+id,token:'public-fixture-token-'+id,email:id+'@givetogive.invalid'}))};
const plan:SandboxPlan={runId:credentials.runId!,runBudgetCents:2500,actorBudgetCents:1500,
 steps:['a','b','c'].map((agentId,index)=>({operationId:`10000000-0000-4000-8000-00000000000${index+1}`,
  agentId,scenario:index===2?'decline':'success',maximumAmountCents:index===1?1500:500,
  expectedTier:index===2?'neighbor':index===1?'sustainer':'supporter',
  checkout:{kind:'supporter',tier:index===1?'sustainer':'supporter',recurring:true}}))};
async function fixture() {
 const directory=mkdtempSync(join(tmpdir(),'givetogive-original-budget-'));
 const bytes=Buffer.from(JSON.stringify(plan));writeFileSync(join(directory,'financial-plan.json'),bytes);
 const digest=hash(bytes),uiPath=join(directory,'financial-intents.sqlite'),attemptPath=join(directory,'financial-attempts.sqlite');
 const ui=new UiCheckoutPreparation(uiPath,plan);
 try {for(const step of plan.steps.slice(0,2)) await ui.prepare({userId:'member-'+step.agentId,
  query:async()=>undefined,mutate:async()=>({syntheticFixture:true})},'member-'+step.agentId,step);}
 finally {ui.close();}
 const ledger=new SandboxLedger(attemptPath,plan.runId,plan.runBudgetCents,plan.actorBudgetCents);
 try {ledger.reserve(plan.steps[0]!.operationId,'member-a',500,'success');ledger.update(plan.steps[0]!.operationId,'ambiguous');}
 finally {ledger.close();}
 return {directory,digest,uiPath,attemptPath,inspect:()=>inspectUnusedCheckoutCandidateBudget(directory,digest,credentials,plan.steps[2]!.operationId),
  cleanup(){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));rmSync(directory,{recursive:true});}};
}
function change(path:string,sql:string) {const db=new DatabaseSync(path);try{db.exec(sql);}finally{db.close();}}

test('original UI and ambiguous financial holds remain counted, without modifying database or plan bytes',async()=>{
 const f=await fixture();try {
  const before=[f.uiPath,f.attemptPath,join(f.directory,'financial-plan.json')].map(p=>hash(readFileSync(p)));
  const result=f.inspect();
  assert.equal(result.uiHeldCents,2000);assert.equal(result.attemptHeldCents,500);
  assert.equal(result.candidateMaximumCents,500);assert.equal(result.actorUiHeldCents,0);
  assert.equal(result.originalRunBudgetCents,2500);assert.equal(result.originalActorBudgetCents,1500);
  assert.equal(result.candidateUnused,true);assert.equal(result.financialAdmission,false);
  assert.equal(result.independentIdentityAndAtomicAdmissionStillRequired,true);
  assert.equal(result.crossJournalAtomic,false);assert.equal(result.databaseWrites,0);
  assert.deepEqual([f.uiPath,f.attemptPath,join(f.directory,'financial-plan.json')].map(p=>hash(readFileSync(p))),before);
 }finally{f.cleanup();}
});
test('an unresolved prior UI reservation is not released to make more budget available',async()=>{
 const f=await fixture();try{
  change(f.uiPath,`UPDATE ui_checkout_intent SET state='unresolved' WHERE operation_id='${plan.steps[1]!.operationId}'`);
  assert.equal(f.inspect().uiHeldCents,2000);
 }finally{f.cleanup();}
});
test('missing journals and stale plan digests fail without creating a replacement store',async()=>{
 const f=await fixture();try{
  assert.throws(()=>inspectUnusedCheckoutCandidateBudget(f.directory,'0'.repeat(64),credentials,plan.steps[2]!.operationId),/budget unconfirmed/);
  renameSync(f.attemptPath,f.attemptPath+'.preserved');assert.throws(f.inspect,/budget unconfirmed/);
  assert.equal(existsSync(f.attemptPath),false);
 }finally{f.cleanup();}
});
test('a candidate UI lease alone blocks replay even when both database journals still show it unused',async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.directory,`ui-acceptance-${plan.steps[2]!.operationId}.intent.json`),'public-fixture');
  assert.throws(f.inspect,/budget unconfirmed/);
 }finally{f.cleanup();}
});
test('candidate preparation and candidate financial reservation each block another admission',async()=>{
 for(const kind of ['ui','attempt']) {
  const f=await fixture();try{
   if(kind==='ui') {const journal=new UiCheckoutPreparation(f.uiPath,plan);try{
    await journal.prepare({userId:'member-c',query:async()=>undefined,mutate:async()=>({syntheticFixture:true})},'member-c',plan.steps[2]!);
   }finally{journal.close();}}
   else {const journal=new SandboxLedger(f.attemptPath,plan.runId,2500,1500);try{
    journal.reserve(plan.steps[2]!.operationId,'member-c',500,'decline');
   }finally{journal.close();}}
   assert.throws(f.inspect,/budget unconfirmed/);
  }finally{f.cleanup();}
 }
});
test('foreign ownership, changed budgets, altered requests and unmatched notices cannot be hidden from review',async()=>{
 const changes=[{file:'ui',sql:"UPDATE ui_checkout_budget SET run_budget=3000"},
  {file:'ui',sql:"UPDATE ui_checkout_intent SET actor_id='other'"},
  {file:'ui',sql:"UPDATE ui_checkout_intent SET request_hash='changed'"},
  {file:'attempt',sql:"UPDATE sandbox_attempts SET scenario='decline'"},
  {file:'attempt',sql:"UPDATE sandbox_attempts SET run_id='other'"},
  {file:'attempt',sql:"INSERT INTO sandbox_agent_acknowledgments VALUES ('original-budget-fixture','10000000-0000-4000-8000-000000000003','member-c',1)"}];
 for(const c of changes){const f=await fixture();try{
  change(c.file==='ui'?f.uiPath:f.attemptPath,c.sql);assert.throws(f.inspect,/budget unconfirmed/);
 }finally{f.cleanup();}}
});
