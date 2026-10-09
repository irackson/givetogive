// CURRENT local prerequisites. Import/default is inert. SELECT/provider GET only;
// no member sign-in, new Checkout, journal creation/reset, grant or submission.
import { fileURLToPath } from 'node:url';
import { resolve,join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { currentCheckoutCandidate as c } from '../tools/simulation/src/checkout-current-profile.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const guard=value=>{if(!value)throw Error('Current operator prerequisites rejected; private details withheld.');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Pure checks of actual restricted-role SELECT results. Does not authenticate
 * supplied data; native inspector below must obtain it independently. */
export function validateCurrentOperatorSnapshot(data,plan,prepared=false){
 guard(data&&plan&&plan.runId===c.runId&&plan.runBudgetCents===2500&&plan.actorBudgetCents===1500&&plan.steps.length===3);
 const run=data.run;guard(run&&run.mode==='deterministic'&&run.environment==='staging'&&run.database_identity===c.databaseIdentity&&
 run.agent_count===3&&['created','paused','running'].includes(run.status)&&typeof run.created_by==='string');
 guard(Array.isArray(data.members)&&data.members.length===3&&Array.isArray(data.accounts)&&data.accounts.length===3&&
 Array.isArray(data.bindings)&&data.bindings.length===3&&Array.isArray(data.payments)&&data.payments.length===(prepared?3:2));
 const members=[...data.members].sort((a,b)=>a.id.localeCompare(b.id));
 const targets=[];for(const [index,member] of members.entries()){
 const suffix=String(index+1).padStart(3,'0');guard(member.id===`synthetic-bcfa98ea084ed93e-${suffix}`&&member.agent_id===`bot_bcfa98ea084ed93e_${suffix}`&&
 member.email===`neighbor-bcfa98ea084ed93e-${suffix}@givetogive.invalid`&&member.role==='member'&&member.is_synthetic===true&&member.verified===true&&member.frozen===false);
 const mappings=data.accounts.filter(a=>a.user_id===member.id),bindings=data.bindings.filter(b=>b.actor_id===member.id);
 guard(mappings.length===1&&bindings.length===1);const account=mappings[0],binding=bindings[0];
 guard(/^acct_[A-Za-z0-9]+$/.test(account.stripe_account_id)&&account.livemode===false&&binding.run_id===c.runId&&binding.environment==='staging'&&
 binding.outcome==='completed'&&/^clock_[A-Za-z0-9]+$/.test(binding.entity_id)&&binding.details?.accountId===account.stripe_account_id&&
 binding.details.version===1&&binding.details.databaseIdentity===c.databaseIdentity&&binding.details.livemode===false);
 targets.push({actorId:member.id,customerAccountId:account.stripe_account_id,clockId:binding.entity_id});
 }
 guard(new Set(targets.map(t=>t.customerAccountId)).size===3&&new Set(targets.map(t=>t.clockId)).size===1);
 const clock=data.clockOperation;guard(clock?.status==='completed'&&clock.result?.runId===c.runId&&clock.result.livemode===false&&
 clock.result.clockId===targets[0].clockId&&Number.isSafeInteger(clock.result.initialFrozenTime)&&clock.result.initialFrozenTime>0);
 guard(data.counts?.subscriptions===0&&data.counts.coverage===0&&data.counts.ledger===0);
 guard(new Set(data.payments.map(p=>p.id)).size===data.payments.length);
 for(const payment of data.payments){const step=plan.steps.find(s=>s.operationId===payment.id),actor=members.find(m=>m.agent_id===step?.agentId);
 guard(step&&actor&&payment.actor_id===actor.id&&payment.livemode===false&&payment.kind==='supporter'&&payment.currency==='usd'&&
 payment.gross_amount===step.maximumAmountCents&&payment.tier===step.checkout.tier&&payment.recurring===true&&payment.paid_at===null&&
 payment.refunded_amount===0&&payment.disputed_amount===0&&/^cs_test_[A-Za-z0-9]+$/.test(payment.checkout_id));
 guard(payment.id===c.operationId?prepared&&payment.status==='checkout_open':['checkout_open','expired'].includes(payment.status));
 }
 guard(plan.steps.slice(0,2).every(step=>data.payments.some(p=>p.id===step.operationId))&&
 (prepared?data.payments.some(p=>p.id===c.operationId):!data.payments.some(p=>p.id===c.operationId)));
 return {targets,frozenTime:clock.result.initialFrozenTime,payments:data.payments};
}
export async function inspectCurrentCheckoutPrerequisites(boundary='unused'){
 let sql;const start=Date.now(),active=()=>guard(Date.now()>=start&&Date.now()-start<=90000);
 try{guard(process.platform==='win32'&&Number(process.versions.node.split('.')[0])===24);
 const prepared=boundary!=='unused';guard(boundary==='unused'||(boundary&&typeof boundary==='object'&&!Array.isArray(boundary)));
 const {isolatedConfiguration,verifyIsolatedTarget}=await import('./isolated-environment.ts');
 const configuration=isolatedConfiguration(process.env,'staging');guard(configuration.identity===c.databaseIdentity&&process.env.APP_URL===c.origin&&
 process.env.SUPPORTERS_ENABLED==='true'&&['PAYMENTS_ENABLED','FUNDS_ENABLED','STRIPE_LIVE_APPROVED'].every(k=>process.env[k]==='false')&&
 process.env.STRIPE_PLATFORM_ACCOUNT_ID==='acct_1UKPU8Ded7vKVapt'&&/^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY??''));
 const {validateSavedCredentials}=await import('../tools/simulation/src/provisioning.ts');
 const {validateSandboxPlan}=await import('../tools/simulation/src/sandbox-plan.ts');
 const {inspectUnusedCheckoutCandidateBudget}=await import('../tools/simulation/src/checkout-candidate-budget.ts');
 const {inspectPreparedCheckoutCandidateBudget}=await import('../tools/simulation/src/checkout-prepared-budget.ts');
 const directory=join(root,'tools/simulation/.state/runs',c.runId);
 const credentials=validateSavedCredentials(JSON.parse(readFileSync(join(directory,'credentials.json'),'utf8')),
 {runId:c.runId,mode:'deterministic',origin:c.origin,databaseIdentity:c.databaseIdentity,population:3});
 const bytes=readFileSync(join(directory,'financial-plan.json'));let plan;
 try{guard(bytes.length<=1048576&&hash(bytes)===c.planDigest);plan=validateSandboxPlan(JSON.parse(bytes.toString()),credentials);}finally{bytes.fill(0);}
 const candidate=credentials.agents.find(a=>a.id===c.agentId);guard(candidate?.userId===c.memberId&&candidate.email===c.memberEmail&&candidate.password);
 const observeBudget=()=>prepared?inspectPreparedCheckoutCandidateBudget(directory,c.planDigest,credentials,c.operationId,boundary):
 inspectUnusedCheckoutCandidateBudget(directory,c.planDigest,credentials,c.operationId);
 const budget=observeBudget();active();
 const {default:postgres}=await import('postgres');sql=postgres(configuration.directUrl,{max:1,connect_timeout:15,idle_timeout:5,onnotice(){}});
 const data=await sql.begin('read only',async tx=>{
 await verifyIsolatedTarget(tx,configuration);active();
 const runs=await tx.unsafe('SELECT mode,environment,database_identity,agent_count,status,created_by FROM givetogive_simulation_run WHERE id=$1',[c.runId]);guard(runs.length===1);
 const members=await tx.unsafe('SELECT a.id AS agent_id,u.id,u.email,u.role,u.is_synthetic,u.email_verified IS NOT NULL AS verified,u.frozen_at IS NOT NULL AS frozen FROM givetogive_user u JOIN givetogive_simulation_agent a ON a.user_id=u.id WHERE a.run_id=$1 ORDER BY u.id',[c.runId]);
 const accounts=await tx.unsafe('SELECT a.user_id,a.stripe_account_id,a.livemode FROM givetogive_payment_account a JOIN givetogive_simulation_agent sa ON sa.user_id=a.user_id WHERE sa.run_id=$1',[c.runId]);
 const bindings=await tx.unsafe("SELECT actor_id,entity_id,details,run_id,environment,outcome FROM givetogive_operation_event WHERE action='simulation_clock_bind' AND run_id=$1",[c.runId]);
 const {clockCreateId}=await import('../src/server/simulation/clock-policy.ts');
 const ops=await tx.unsafe("SELECT status,result FROM givetogive_tool_operation WHERE actor_id=$1 AND correlation_id=$2 AND tool='simulation_clock_create'",[runs[0].created_by,clockCreateId(c.runId)]);guard(ops.length===1);
 const ids=members.map(m=>m.id);
 const payments=await tx.unsafe('SELECT id,actor_id,status,livemode,gross_amount,paid_at,recurring,currency,kind,tier,checkout_id,refunded_amount,disputed_amount FROM givetogive_payment WHERE actor_id=ANY($1::text[])',[ids]);
 const [counts]=await tx.unsafe('SELECT (SELECT count(*)::int FROM givetogive_payment_subscription WHERE actor_id=ANY($1::text[])) AS subscriptions,(SELECT count(*)::int FROM givetogive_supporter_paid_coverage c JOIN givetogive_payment_subscription s ON s.id=c.subscription_id WHERE s.actor_id=ANY($1::text[])) AS coverage,(SELECT count(*)::int FROM givetogive_payment_ledger l JOIN givetogive_payment p ON p.id=l.payment_id WHERE p.actor_id=ANY($1::text[])) AS ledger',[ids]);
 active();return {run:runs[0],members,accounts,bindings,clockOperation:ops[0],payments,counts};});
 const snapshot=validateCurrentOperatorSnapshot(data,plan,prepared);
 const {default:Stripe}=await import('stripe');const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',timeout:15000,maxNetworkRetries:0});
 const {stripeCheckoutReads}=await import('../tools/simulation/src/checkout-provider-proof.ts');const reads=stripeCheckoutReads(stripe);
 guard((await reads.platform()).id===process.env.STRIPE_PLATFORM_ACCOUNT_ID);active();guard((await reads.balance()).livemode===false);active();
 const clock=await reads.clock(snapshot.targets[0].clockId);active();guard(clock.id===snapshot.targets[0].clockId&&clock.name===`givetogive:${c.runId}`&&
 clock.livemode===false&&clock.status==='ready'&&clock.frozen_time===snapshot.frozenTime);
 for(const target of snapshot.targets){const customer=await reads.customer(target.customerAccountId);active();guard(customer.id===target.customerAccountId&&customer.livemode===false&&customer.configuration?.customer?.test_clock===clock.id);
 for(const list of [await reads.invoices(customer.id),await reads.subscriptions(customer.id)]){active();guard(Array.isArray(list.data)&&list.data.length===0&&list.has_more===false);}}
 for(const payment of snapshot.payments){const target=snapshot.targets.find(t=>t.actorId===payment.actor_id),session=await reads.checkout(payment.checkout_id);active();
 guard(session.id===payment.checkout_id&&session.customer_account===target.customerAccountId&&session.client_reference_id===payment.id&&session.livemode===false&&
 session.amount_total===payment.gross_amount&&session.currency==='usd'&&session.mode==='subscription'&&session.payment_status==='unpaid'&&
 session.invoice===null&&session.subscription===null&&session.payment_intent===null);
 guard(payment.id===c.operationId?session.status==='open'&&session.expires_at*1000>Date.now()+15000:session.status==='expired'&&session.expires_at*1000<=Date.now());}
 const after=observeBudget();guard(JSON.stringify(after)===JSON.stringify(budget));active();
 const target=snapshot.targets.find(t=>t.actorId===c.memberId),candidatePayment=snapshot.payments.find(p=>p.id===c.operationId);
 return {budget,target:{...target,frozenTime:snapshot.frozenTime,...(candidatePayment?{sessionId:candidatePayment.checkout_id}:{})},
 summary:{observedAt:new Date(start).toISOString(),readOnly:true,environment:'staging',originalBudgetVerified:true,candidateUnused:!prepared,candidatePrepared:prepared,
 activeSyntheticMembers:3,restrictedDatabaseRoleVerified:true,providerIdentityVerified:true,providerTestMode:true,allThreeCanonicalClockBindingsVerified:true,
 clockReady:true,providerInvoicesAbsent:true,providerSubscriptionsAbsent:true,priorExpiredProviderSessions:2,appSubscriptions:0,paidCoverage:0,ledgerEntries:0,
 memberActions:0,databaseWrites:0,checkoutCreated:false,submitAttempted:false,paymentAccepted:false,releaseVerificationStillRequired:true}};
 }catch{throw Error('Current operator prerequisites rejected; private details withheld.');}finally{await sql?.end({timeout:5});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length===3&&process.argv[2]==='--inspect-readonly'){const value=await inspectCurrentCheckoutPrerequisites();console.log(JSON.stringify(value.summary));}
 else{guard(process.argv.length===2);console.log(JSON.stringify({execute:false,externalRequests:0,databaseWrites:0,memberActions:0,checkoutCreated:false,paymentAccepted:false}));}}
 catch{console.error('Current operator prerequisites rejected; private details withheld.');process.exitCode=1;}
}
