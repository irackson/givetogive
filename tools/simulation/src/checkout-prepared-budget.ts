/** SELECT-only prepared-phase observation of ORIGINAL journals. Does not prepare,
 * create a ledger, release a hold, admit a financial action or permit replay.
 * The separate unused-only checker remains unchanged. Cross-journal reads cannot
 * replace the original ledger's atomic reservation/submission transactions. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync,lstatSync,realpathSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { z } from 'zod';
import { validateSandboxPlan } from './sandbox-plan.ts';
import { checkoutScenarios } from './sandbox-policy.ts';
import type { Credentials } from './protocol.ts';
const fail=():never=>{throw Error('Original prepared budget unconfirmed; no admission, reset or replay.');};
function guard(value:unknown):asserts value{if(!value)fail();}
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const boundarySchema=z.object({financialState:z.enum(['unadmitted','reserved','submitted']),noticeConsumed:z.boolean(),headSha:z.string().regex(/^[a-f0-9]{40}$/)}).strict();
const intentSchema=z.object({runId:z.string(),operationId:z.uuid(),actorId:z.string(),headSha:z.string().regex(/^[a-f0-9]{40}$/),
 planDigest:z.string().regex(/^[a-f0-9]{64}$/),scenario:z.enum(checkoutScenarios),
 maximumAmountCents:z.number().int().positive(),createdAt:z.iso.datetime(),preparationOnly:z.literal(true).optional()}).strict();
export function inspectPreparedCheckoutCandidateBudget(directory:string,expectedPlanDigest:string,credentials:Credentials,operationId:string,rawBoundary:unknown){
 let ui:DatabaseSync|undefined,financial:DatabaseSync|undefined;
 try{
  guard(/^[a-f0-9]{64}$/.test(expectedPlanDigest));const boundary=boundarySchema.parse(rawBoundary);
  guard(boundary.financialState!=='unadmitted'||!boundary.noticeConsumed);
  const root=resolve(directory);for(let cursor=root;;cursor=dirname(cursor)){guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);if(dirname(cursor)===cursor)break;}
  const file=(name:string,maximum:number)=>{const path=join(root,name),stat=lstatSync(path);guard(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=maximum);return path;};
  const planPath=file('financial-plan.json',1048576),bytes=readFileSync(planPath);let plan;
  try{guard(hash(bytes)===expectedPlanDigest);plan=validateSandboxPlan(JSON.parse(bytes.toString()),credentials);}finally{bytes.fill(0);}
  guard(new Set(credentials.agents.map(a=>a.id)).size===credentials.agents.length&&new Set(credentials.agents.map(a=>a.userId)).size===credentials.agents.length);
  const step=plan.steps.find(s=>s.operationId===operationId),candidate=credentials.agents.find(a=>a.id===step?.agentId);guard(step&&candidate?.userId);
  const intentPath=file(`ui-acceptance-${operationId}.intent.json`,16384),intentBytes=readFileSync(intentPath),intentDigest=hash(intentBytes);let intent;
  try{intent=intentSchema.parse(JSON.parse(intentBytes.toString()));}finally{intentBytes.fill(0);}
  guard(intent.runId===plan.runId&&intent.operationId===operationId&&intent.actorId===candidate.userId&&intent.headSha===boundary.headSha&&
   intent.planDigest===expectedPlanDigest&&intent.scenario===step.scenario&&intent.maximumAmountCents===step.maximumAmountCents&&
   !existsSync(join(root,`ui-acceptance-${operationId}.result.json`)));
  ui=new DatabaseSync(file('financial-intents.sqlite',33554432),{readOnly:true});financial=new DatabaseSync(file('financial-attempts.sqlite',33554432),{readOnly:true});
  ui.exec('BEGIN');financial.exec('BEGIN');
  const budgets=ui.prepare('SELECT run_id,run_budget,actor_budget FROM ui_checkout_budget').all();
  guard(budgets.length===1&&budgets[0]!.run_id===plan.runId&&budgets[0]!.run_budget===plan.runBudgetCents&&budgets[0]!.actor_budget===plan.actorBudgetCents);
  const intents=ui.prepare('SELECT run_id,operation_id,actor_id,request_hash,maximum_cents,state FROM ui_checkout_intent').all();
  const attempts=financial.prepare('SELECT run_id,operation_id,actor_id,amount_cents,scenario,state FROM sandbox_attempts').all();
  const notices=financial.prepare('SELECT run_id,operation_id,actor_id FROM sandbox_agent_acknowledgments').all();
  guard([intents,attempts,notices].every(rows=>new Set(rows.map(row=>row.operation_id)).size===rows.length));
  let uiHeld=0,actorUiHeld=0,attemptHeld=0,actorAttemptHeld=0;
  for(const row of intents){const entry=plan.steps.find(s=>s.operationId===row.operation_id),actor=credentials.agents.find(a=>a.id===entry?.agentId);
   guard(row.run_id===plan.runId&&entry&&actor&&row.actor_id===actor.userId&&row.maximum_cents===entry.maximumAmountCents&&
    ['preparing','prepared','unresolved','rejected'].includes(String(row.state))&&row.request_hash===hash(JSON.stringify({...entry.checkout,operationId:entry.operationId})));
   uiHeld+=entry.maximumAmountCents;if(actor.userId===candidate.userId)actorUiHeld+=entry.maximumAmountCents;
  }
  const prepared=intents.find(row=>row.operation_id===operationId);guard(prepared?.state==='prepared'&&prepared.actor_id===candidate.userId);
  for(const row of attempts){const entry=plan.steps.find(s=>s.operationId===row.operation_id),actor=credentials.agents.find(a=>a.id===entry?.agentId);
   guard(row.run_id===plan.runId&&entry&&actor&&row.actor_id===actor.userId&&row.amount_cents===entry.maximumAmountCents&&row.scenario===entry.scenario&&
    ['reserved','submitted','verified_success','verified_decline','verified_authentication_failure','canceled_unpaid','ambiguous'].includes(String(row.state))&&
    intents.some(i=>i.operation_id===row.operation_id&&i.actor_id===row.actor_id&&i.state==='prepared'));
   attemptHeld+=entry.maximumAmountCents;if(actor.userId===candidate.userId)actorAttemptHeld+=entry.maximumAmountCents;
  }
  const current=attempts.find(row=>row.operation_id===operationId);
  guard(boundary.financialState==='unadmitted'?!current:current?.state===boundary.financialState);
  for(const row of notices)guard(row.run_id===plan.runId&&attempts.some(a=>a.operation_id===row.operation_id&&a.actor_id===row.actor_id));
  const acknowledged=notices.find(row=>row.operation_id===operationId);guard(boundary.noticeConsumed?acknowledged?.actor_id===candidate.userId:!acknowledged);
  const additional=boundary.financialState==='unadmitted'?step.maximumAmountCents:0;
  guard(uiHeld<=plan.runBudgetCents&&actorUiHeld<=plan.actorBudgetCents&&attemptHeld+additional<=plan.runBudgetCents&&actorAttemptHeld+additional<=plan.actorBudgetCents);
  const after=readFileSync(planPath);try{guard(hash(after)===expectedPlanDigest);}finally{after.fill(0);}
  const afterIntent=readFileSync(intentPath);try{guard(hash(afterIntent)===intentDigest);}finally{afterIntent.fill(0);}
  ui.exec('COMMIT');financial.exec('COMMIT');
  return Object.freeze({readOnly:true,candidatePrepared:true,financialState:boundary.financialState,noticeConsumed:boundary.noticeConsumed,planDigest:expectedPlanDigest,
   candidateMaximumCents:step.maximumAmountCents,uiHeldCents:uiHeld,attemptHeldCents:attemptHeld,actorUiHeldCents:actorUiHeld,actorAttemptHeldCents:actorAttemptHeld,
   originalRunBudgetCents:plan.runBudgetCents,originalActorBudgetCents:plan.actorBudgetCents,expiredAndAmbiguousHoldsPreserved:true,crossJournalAtomic:false,
   independentIdentityAndAtomicAdmissionStillRequired:true,financialAdmission:false,databaseWrites:0});
 }catch{return fail();}finally{ui?.close();financial?.close();}
}
