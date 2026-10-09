/** Current native workflow observation only. GETs cannot approve payment, prove
 * OS ownership or replace source/member/journal checks. Injected HTTP is offline. */
import { z } from 'zod';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
const fail=():never=>{throw Error('Current Checkout job observation rejected; private details withheld.');};
function guard(value:unknown):asserts value{if(!value)fail();}
const id=z.string().regex(/^[1-9][0-9]{0,19}$/),head=z.string().regex(/^[a-f0-9]{40}$/);
const target=z.object({headSha:head,workflowRunId:id,jobId:id.optional()}).strict();
export async function observeCurrentCheckoutJob(raw:unknown,options:{token:string;signal:AbortSignal;request?:typeof fetch;now?:()=>number}){
 try{const expected=target.parse(raw),now=options.now??Date.now,start=now(),request=options.request??fetch;
 guard(Number.isFinite(start)&&typeof options.token==='string'&&options.token.length>=20&&options.token.length<=4096&&!/[\r\n]/.test(options.token));
 const active=()=>{options.signal.throwIfAborted();guard(now()>=start&&now()-start<=30000);};
 const json=async(path:string)=>{active();const signal=AbortSignal.any([options.signal,AbortSignal.timeout(15000)]);
 const response=await request(`https://api.github.com/repos/irackson/givetogive/${path}`,{headers:{Authorization:`Bearer ${options.token}`,
 Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',signal});
 if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}
 const bytes=await checkoutResponseBytes(response,262144,signal);try{active();return JSON.parse(bytes.toString());}finally{bytes.fill(0);}};
 const run=z.object({id:z.number().int().positive(),head_sha:head,event:z.literal('workflow_dispatch'),head_branch:z.literal('main'),
 run_attempt:z.literal(1),status:z.literal('in_progress'),conclusion:z.null(),path:z.literal('.github/workflows/checkout-current-staging.yml'),
 actor:z.object({login:z.literal('irackson')}),triggering_actor:z.object({login:z.literal('irackson')}),
 repository:z.object({full_name:z.literal('irackson/givetogive'),private:z.literal(false)})}).parse(await json(`actions/runs/${expected.workflowRunId}`));
 guard(String(run.id)===expected.workflowRunId&&run.head_sha===expected.headSha);
 const jobs=z.object({total_count:z.literal(1),jobs:z.array(z.object({id:z.number().int().positive(),run_id:z.number().int().positive(),head_sha:head,
 run_attempt:z.literal(1),name:z.literal('checkout-current-parent'),status:z.literal('in_progress'),conclusion:z.null(),labels:z.array(z.string()).max(20)})).length(1)})
 .parse(await json(`actions/runs/${expected.workflowRunId}/jobs?filter=latest&per_page=100`));
 const job=jobs.jobs[0]!;guard(String(job.run_id)===expected.workflowRunId&&job.head_sha===expected.headSha&&job.labels.includes('ubuntu-24.04')&&
 (!expected.jobId||String(job.id)===expected.jobId));active();
 return Object.freeze({headSha:expected.headSha,workflowRunId:expected.workflowRunId,jobId:String(job.id),observedAt:new Date(start).toISOString(),
 status:'in_progress' as const,transportEvidence:options.request?'injected-offline-http' as const:'github-live-current-job' as const,
 financialAdmission:false,paymentAccepted:false});
 }catch{return fail();}
}
