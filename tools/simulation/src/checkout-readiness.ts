/** Public, credential-free readiness metadata only. This consumes no encrypted
 * asset slot and cannot authorize Checkout creation, submission or settlement.
 * Import is inert. The dedicated bootstrap must keep its admitted parent alive;
 * a later operator recheck of the exact live job is required before preparation. */
import { createHash } from 'node:crypto';
import { openSync, writeFileSync, fsyncSync, closeSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { approved, checkMemory } from './hosted-checkout-policy.ts';

const head = z.string().regex(/^[a-f0-9]{40}$/), sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const readinessSchema = z.object({ protocol:z.literal(1), purpose:z.literal('checkout-parent-readiness'),
 repository:z.literal(approved.repository), headSha:head, runId:id, jobId:id, jobNonce:z.string().regex(/^[a-f0-9]{32}$/),
 observedAt:z.iso.datetime(), canonicalSourceDigest:sha, rootLockDigest:sha, runnerDigest:sha,
 freeBytes:z.number().finite(), bootstrapSourceApprovalStillRequired:z.literal(true),
 noCheckoutAdmission:z.literal(true), paymentAccepted:z.literal(false), retryAllowed:z.literal(false) }).strict();
export type CheckoutReadiness = z.infer<typeof readinessSchema>;
const fail = (): never => { throw Error('Checkout readiness unconfirmed; no automatic publication retry or financial admission.'); };
function guard(value:unknown):asserts value { if(!value)fail(); }
export function validateCheckoutReadiness(raw:unknown,expectedHead:string,now:number) {
 const value=readinessSchema.parse(raw), age=now-Date.parse(value.observedAt);
 guard(Number.isFinite(now)&&value.headSha===expectedHead&&age>=-5000&&age<=30000);
 checkMemory(value.freeBytes,true);return value;
}
const name='GiveToGive Checkout parent readiness';
function exclusive(directory:string,filename:string,bytes:Buffer) {
 const path=resolve(directory);
 for(let cursor=path;;cursor=dirname(cursor)) {
  guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);
  if(dirname(cursor)===cursor)break;
 }
 guard(lstatSync(path).isDirectory()&&bytes.length<=16384);
 if(process.platform==='linux')guard((lstatSync(path).mode&0o077)===0);
 const fd=openSync(join(path,filename),'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 if(process.platform==='linux'){const dir=openSync(path,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
 const saved=readFileSync(join(path,filename));try{guard(saved.equals(bytes));}finally{saved.fill(0);}
}

/** The transport proves the exact GitHub run/job and one-shot publication. It
 * does NOT prove that a native waiting parent or reviewed source exists: native
 * bootstrap/source verification and a live operator recheck remain mandatory.
 * A supplied HTTP implementation is permanently tagged as offline evidence. */
export async function publishCheckoutReadiness(raw:unknown,expectedHead:string,options:{
 token:string;directory:string;signal:AbortSignal;request?:typeof fetch;now?:()=>number;
}) {
 const request=options.request??fetch, now=options.now??Date.now;
 try {
  guard(typeof options.token==='string'&&options.token.length>=20&&options.token.length<=4096&&!/[\r\n]/.test(options.token));
  const value=validateCheckoutReadiness(raw,expectedHead,now());
  const headers={Authorization:`Bearer ${options.token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'};
  const api=`https://api.github.com/repos/${approved.repository}`;
  const active=()=>{options.signal.throwIfAborted();validateCheckoutReadiness(value,expectedHead,now());};
  async function json(path:string,method='GET',body?:unknown,expectedStatus=200) {
   active();const signal=AbortSignal.any([options.signal,AbortSignal.timeout(15000)]);
   const response=await request(`${api}/${path}`,{method,headers,redirect:'error',
    signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
   try {
    guard(response.status===expectedStatus&&response.body);
    const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0;
    try {
     for(;;){
      active();signal.throwIfAborted();let remove=()=>{};
      const aborted=new Promise<never>((__resolve,reject)=>{const stop=()=>reject(Error('cancelled'));
       signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
      let part:ReadableStreamReadResult<Uint8Array>;
      try{part=await Promise.race([reader.read(),aborted]);}finally{remove();}
      signal.throwIfAborted();if(part.done)break;length+=part.value.byteLength;guard(length<=262144);chunks.push(Buffer.from(part.value));
     }
     const bytes=Buffer.concat(chunks);try{return JSON.parse(bytes.toString('utf8')) as unknown;}finally{bytes.fill(0);}
    }finally{for(const chunk of chunks)chunk.fill(0);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
   }finally{void response.body?.cancel().catch(()=>undefined);}
  }
  const runSchema=z.object({id:z.number().int().positive(),head_sha:head,event:z.literal('workflow_dispatch'),
   head_branch:z.literal('main'),run_attempt:z.literal(1),status:z.literal('in_progress'),conclusion:z.null(),
   path:z.literal('.github/workflows/checkout-staging.yml'),actor:z.object({login:z.literal(approved.actor)}),
   triggering_actor:z.object({login:z.literal(approved.actor)}),repository:z.object({full_name:z.literal(approved.repository),private:z.literal(false)})});
  async function live() {
   const run=runSchema.parse(await json(`actions/runs/${value.runId}`));guard(String(run.id)===value.runId&&run.head_sha===expectedHead);
   const jobs=z.object({total_count:z.literal(1),jobs:z.array(z.object({id:z.number().int().positive(),run_id:z.number().int().positive(),
    head_sha:head,run_attempt:z.literal(1),name:z.literal('checkout-parent'),status:z.literal('in_progress'),conclusion:z.null(),
    labels:z.array(z.string()).max(20)})).length(1)}).parse(await json(`actions/runs/${value.runId}/jobs?filter=latest&per_page=100`));
   const job=jobs.jobs[0]!;guard(String(job.id)===value.jobId&&String(job.run_id)===value.runId&&job.head_sha===expectedHead&&job.labels.includes('ubuntu-24.04'));
  }
  await live();
  const evidence={...value,transportEvidence:options.request?'injected-offline-http':'github-live-run-job-readback',
   nativeParentReadinessStillRequired:true as const};
  const summary=JSON.stringify(evidence),intent=Buffer.from(JSON.stringify({protocol:1,runId:value.runId,jobId:value.jobId,
   jobNonce:value.jobNonce,headSha:expectedHead,summaryDigest:createHash('sha256').update(summary).digest('hex'),
   maximumPublications:1,paymentAccepted:false,retryAllowed:false}));
  try{exclusive(options.directory,'readiness-publication.intent.json',intent);}finally{intent.fill(0);}
  const external=`checkout-ready-${value.runId}-${value.jobId}-${value.jobNonce}`;
  const checkSchema=z.object({id:z.number().int().positive(),name:z.literal(name),head_sha:head,
   external_id:z.literal(external),status:z.literal('in_progress'),conclusion:z.null(),
   app:z.object({slug:z.literal('github-actions')}),output:z.object({title:z.literal(name),summary:z.literal(summary)})});
  const created=checkSchema.parse(await json('check-runs','POST',{name,head_sha:expectedHead,external_id:external,
   status:'in_progress',started_at:value.observedAt,output:{title:name,summary}},201));
  guard(created.head_sha===expectedHead);
  await live();
  const retained=checkSchema.parse(await json(`check-runs/${created.id}`));guard(retained.id===created.id&&retained.head_sha===expectedHead);
  const result={protocol:1,checkRunId:retained.id,runId:value.runId,jobId:value.jobId,jobNonce:value.jobNonce,
   headSha:expectedHead,transportEvidence:evidence.transportEvidence,nativeParentReadinessStillRequired:true,
   privateInputTransferred:false,checkoutPrepared:false,paymentAccepted:false,retryAllowed:false};
  const bytes=Buffer.from(JSON.stringify(result));try{exclusive(options.directory,'readiness-publication.result.json',bytes);}finally{bytes.fill(0);}
  return result;
 }catch{return fail();}
}
