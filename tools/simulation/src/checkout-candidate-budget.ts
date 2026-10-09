/** SELECT-only observation of existing journals. No new plan/ledger, reset,
 * reservation, Checkout, or reusable financial permission. The caller
 * must independently verify member/provider identity and atomically admit once. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { validateSandboxPlan } from './sandbox-plan.ts';
import type { Credentials } from './protocol.ts';
const fail = (): never => { throw Error('Original candidate budget unconfirmed; no admission or reset.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function inspectUnusedCheckoutCandidateBudget(directory: string, expectedPlanDigest: string,
 credentials: Credentials, operationId: string) {
 let ui: DatabaseSync | undefined, financial: DatabaseSync | undefined;
 try {
  guard(/^[a-f0-9]{64}$/.test(expectedPlanDigest));
  const root = resolve(directory);
  for (let cursor=root;;cursor=dirname(cursor)) {
   guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor)===cursor);
   if (dirname(cursor)===cursor) break;
  }
  function existingFile(name: string, maximum: number) {
   const path=join(root,name), stat=lstatSync(path);
   guard(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1 && stat.size>0 && stat.size<=maximum);
   return path;
  }
  const planPath=existingFile('financial-plan.json',1048576), bytes=readFileSync(planPath);
  let plan;
  try { guard(hash(bytes)===expectedPlanDigest);plan=validateSandboxPlan(JSON.parse(bytes.toString('utf8')),credentials); }
  finally { bytes.fill(0); }
  guard(new Set(credentials.agents.map(a=>a.id)).size===credentials.agents.length &&
   new Set(credentials.agents.map(a=>a.userId)).size===credentials.agents.length);
  const step=plan.steps.find(s=>s.operationId===operationId);
  guard(step);
  const candidate=credentials.agents.find(a=>a.id===step.agentId);
  guard(candidate && typeof candidate.userId==='string' && candidate.userId.length>0);
  guard(!existsSync(join(root,`ui-acceptance-${operationId}.intent.json`)) &&
   !existsSync(join(root,`ui-acceptance-${operationId}.result.json`)));
  ui=new DatabaseSync(existingFile('financial-intents.sqlite',33554432),{readOnly:true});
  financial=new DatabaseSync(existingFile('financial-attempts.sqlite',33554432),{readOnly:true});
  ui.exec('BEGIN');financial.exec('BEGIN');
  const budgets=ui.prepare('SELECT run_id,run_budget,actor_budget FROM ui_checkout_budget').all();
  guard(budgets.length===1 && budgets[0]!.run_id===plan.runId &&
   budgets[0]!.run_budget===plan.runBudgetCents && budgets[0]!.actor_budget===plan.actorBudgetCents);
  const intents=ui.prepare('SELECT run_id,operation_id,actor_id,request_hash,maximum_cents,state FROM ui_checkout_intent').all();
  const attempts=financial.prepare('SELECT run_id,operation_id,actor_id,amount_cents,scenario,state FROM sandbox_attempts').all();
  const notices=financial.prepare('SELECT run_id,operation_id,actor_id FROM sandbox_agent_acknowledgments').all();
  guard([intents,attempts,notices].every(rows=>new Set(rows.map(row=>row.operation_id)).size===rows.length));
  let uiHeld=0,actorUiHeld=0,attemptHeld=0,actorAttemptHeld=0;
  for (const intent of intents) {
   const prior=plan.steps.find(s=>s.operationId===intent.operation_id),actor=credentials.agents.find(a=>a.id===prior?.agentId);
   guard(intent.run_id===plan.runId && prior && actor && intent.actor_id===actor.userId &&
    intent.operation_id!==operationId && intent.maximum_cents===prior.maximumAmountCents &&
    ['preparing','prepared','unresolved','rejected'].includes(String(intent.state)) &&
    intent.request_hash===hash(JSON.stringify({...prior.checkout,operationId:prior.operationId})));
   uiHeld+=prior.maximumAmountCents;if(actor.userId===candidate.userId)actorUiHeld+=prior.maximumAmountCents;
  }
  for (const attempt of attempts) {
   const prior=plan.steps.find(s=>s.operationId===attempt.operation_id),actor=credentials.agents.find(a=>a.id===prior?.agentId);
   guard(attempt.run_id===plan.runId && prior && actor && attempt.actor_id===actor.userId &&
    attempt.operation_id!==operationId && attempt.amount_cents===prior.maximumAmountCents && attempt.scenario===prior.scenario &&
    ['reserved','submitted','verified_success','verified_decline','verified_authentication_failure','canceled_unpaid','ambiguous'].includes(String(attempt.state)) &&
    intents.some(i=>i.operation_id===attempt.operation_id && i.actor_id===attempt.actor_id && i.state==='prepared'));
   attemptHeld+=prior.maximumAmountCents;if(actor.userId===candidate.userId)actorAttemptHeld+=prior.maximumAmountCents;
  }
  for (const notice of notices) guard(notice.run_id===plan.runId && notice.operation_id!==operationId &&
   attempts.some(a=>a.operation_id===notice.operation_id && a.actor_id===notice.actor_id));
  guard(uiHeld+step.maximumAmountCents<=plan.runBudgetCents && actorUiHeld+step.maximumAmountCents<=plan.actorBudgetCents &&
   attemptHeld+step.maximumAmountCents<=plan.runBudgetCents && actorAttemptHeld+step.maximumAmountCents<=plan.actorBudgetCents);
  // Never turn a SELECT snapshot into admission: another process can race it.
  const after=readFileSync(planPath);try { guard(hash(after)===expectedPlanDigest); } finally { after.fill(0); }
  ui.exec('COMMIT');financial.exec('COMMIT');
  return Object.freeze({readOnly:true,planDigest:expectedPlanDigest,candidateUnused:true,
   candidateMaximumCents:step.maximumAmountCents,uiHeldCents:uiHeld,attemptHeldCents:attemptHeld,
   actorUiHeldCents:actorUiHeld,actorAttemptHeldCents:actorAttemptHeld,
   originalRunBudgetCents:plan.runBudgetCents,originalActorBudgetCents:plan.actorBudgetCents,
   expiredAndAmbiguousHoldsPreserved:true,crossJournalAtomic:false,
   independentIdentityAndAtomicAdmissionStillRequired:true,financialAdmission:false,databaseWrites:0});
 } catch { return fail(); } finally {ui?.close();financial?.close();}
}
