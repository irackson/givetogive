// Only the exact failed, prepared-but-never-admitted operation. Read-only; no
// creation, reset, financial retry, old draft repair or closure-success claim.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { unseal, fileBytes } from '../tools/simulation/src/hosted-community-bundle.ts';
import { assetName } from '../tools/simulation/src/hosted-checkout-policy.ts';
export const preparedHandoffBinding=Object.freeze({
 headSha:'b6e1b7b7cc5c5f6fdf6402b9ec597383ff979743',runId:'37965625759',
 operationId:'398c5cf9-62de-4908-afb0-ce6321e8b3ad',
 originalDigest:'e24c052e287d818f7978d148e672997d957e837c357b039c6bc6a211265d8890',
});
const fail=()=>{throw Error('Prepared handoff ineligible; originals and holds retained; private details withheld.');};
const guard=value=>{if(!value)fail();};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Authenticated failure classification only, not financial authority. */
export function validatePreparedHandoffFailure(value,expectedProfileDigest) {
 const b=preparedHandoffBinding;
 const envelope=z.object({protocol:z.literal(1),purpose:z.literal('current-checkout-native-originals'),
  profileDigest:z.literal(expectedProfileDigest),binding:z.object({releaseId:z.number().int().positive(),operationId:z.literal(b.operationId),
   job:z.object({id:z.literal('113939127604'),nonce:z.literal('1f8e6f6d5714013aa242a7a0cce8ef06'),headSha:z.literal(b.headSha)}).strict()}).strict(),
  files:z.array(z.object({name:z.string().max(256),digest:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.string().max(90000)}).strict()).max(32),
  excludedMemberRuntimeDirectories:z.literal(true),independentClosureAndSettlementRequired:z.literal(true),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict().parse(value);
 guard(new Set(envelope.files.map(file=>file.name)).size===envelope.files.length);
 const json=suffix=>{const matches=envelope.files.filter(file=>file.name.endsWith(suffix));guard(matches.length===1);
  const bytes=fileBytes(matches[0]);try{return JSON.parse(bytes.toString());}finally{bytes.fill(0);}};
 const worker=z.object({protocol:z.literal(1),purpose:z.literal('current-member-receipt'),phase:z.literal('opening'),failed:z.literal(true),
  executionEvidence:z.literal('native-playwright-adapter'),memberSignIns:z.literal(1),noticeRequests:z.literal(0),submitAttempts:z.literal(0),
  apiDisposed:z.literal(true),driverClosed:z.literal(true),independentJobOsProviderLedgerVerificationRequired:z.literal(true),
  privateDetailsWithheld:z.literal(true),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict().parse(json('/worker-receipt.json'));
 const parent=json('/parent-receipt.json');guard(parent.worker&&Object.keys(parent.worker).length===Object.keys(worker).length&&
  Object.keys(worker).every(name=>parent.worker[name]===worker[name])&&parent.executionEvidence==='native-linux-parent');
 z.object({ownedGroupClosed:z.literal(true),exitObserved:z.literal(false),exitCode:z.null(),publicOutputBytes:z.literal(0),
  escapedDescendantObserved:z.literal(false),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict().parse(parent.cleanup);
 // The original exit event gap stays recorded. Require exact terminal native
 // job separately, not a fabricated successful parent receipt.
 guard(!envelope.files.some(file=>/\/(?:fixture|notice|submission)-|opening-response/.test(file.name)));
 return {binding:envelope.binding,previousWorkerFailed:true,previousSubmitAttempts:0,previousNoticeRequests:0,
  originalExitEventUnobserved:true,originalOsGroupClosed:true,paymentAccepted:false,financialAdmission:false};
}
export async function observePreparedHandoffEligibility(key) {
 guard(process.platform==='win32'&&Buffer.isBuffer(key)&&key.length===32);
 const b=preparedHandoffBinding,root=resolve(fileURLToPath(new URL('../tools/simulation/.state/',import.meta.url)),`current-native-${b.operationId}-association-recovery-v1`);
 const digest=createHash('sha256');let count=0;
 const visit=(relative='')=>{const path=join(root,relative);guard(!lstatSync(path).isSymbolicLink()&&realpathSync(path)===path);
  for(const name of readdirSync(path).sort()){const child=relative?relative+'/'+name:name,stat=lstatSync(join(root,child));guard(!stat.isSymbolicLink());
   if(stat.isDirectory())visit(child);else{guard(stat.isFile()&&stat.nlink===1&&stat.size<=65536&&++count<=32);
    const bytes=readFileSync(join(root,child));try{digest.update(child).update('\0').update(bytes).update('\0');}finally{bytes.fill(0);}}}};
 visit();guard(count===27&&digest.digest('hex')===b.originalDigest);
 const ready=JSON.parse(readFileSync(join(root,`current-dispatch-${b.operationId}`,'readiness.original.json'),'utf8')).readiness;
 const ciphertext=readFileSync(join(root,'final.original.g2genc'));let proof;
 try{proof=validatePreparedHandoffFailure(unseal(ciphertext,key,2097152),hash(Buffer.from(JSON.stringify(ready.profile))));}finally{ciphertext.fill(0);}
 const bytes=execFileSync('gh',['auth','token'],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000});let token;
 try{token=bytes.toString().trim();}finally{bytes.fill(0);}guard(token.length>=20);
 try{const base='https://api.github.com/repos/irackson/givetogive/',signal=AbortSignal.timeout(30000);
  const get=async path=>{const response=await fetch(base+path,{redirect:'error',signal,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});guard(response.ok);return response.json();};
  z.object({id:z.literal(Number(b.runId)),head_sha:z.literal(b.headSha),event:z.literal('workflow_dispatch'),head_branch:z.literal('main'),
   run_attempt:z.literal(1),status:z.literal('completed'),conclusion:z.literal('failure'),path:z.literal('.github/workflows/checkout-current-staging.yml'),
   actor:z.object({login:z.literal('irackson')}),triggering_actor:z.object({login:z.literal('irackson')})}).parse(await get('actions/runs/'+b.runId));
  const p=ready.profile,association={protocol:1,purpose:'current-cohort-private-checkout-draft',repository:p.job.repository,runId:p.runId,
   operationId:p.operationId,headSha:p.job.headSha,workflowRunId:p.job.workflowRunId,jobId:p.job.jobId,jobNonce:p.job.jobNonce,profileDigest:ready.profileDigest};
  const release=z.object({id:z.literal(proof.binding.releaseId),draft:z.literal(true),prerelease:z.literal(false),published_at:z.null(),
   target_commitish:z.literal(b.headSha),tag_name:z.literal(`checkout-current-${b.operationId}-association-recovery-v1`),body:z.literal(JSON.stringify(association)),
   assets:z.array(z.object({name:z.string(),digest:z.string()})).length(3)}).parse(await get('releases/'+proof.binding.releaseId));
  guard(release.assets.map(file=>file.name).sort().join(',')===['input','opening-request','final'].map(phase=>assetName(proof.binding,phase)).sort().join(','));
  const final=release.assets.find(file=>file.name===assetName(proof.binding,'final'));
  const originalFinal=readFileSync(join(root,'final.original.g2genc'));try{guard(final.digest==='sha256:'+hash(originalFinal));}finally{originalFinal.fill(0);}
  const anonymous=await fetch(base+'releases/'+proof.binding.releaseId,{redirect:'manual',signal});try{guard(anonymous.status===404);}finally{await anonymous.body?.cancel();}
  return Object.freeze({...proof,originalDigest:b.originalDigest,originalPreparationHead:b.headSha,priorJobTerminalFailed:true,
   originalDraftPrivateAndUnchanged:true,oldDraftNotRebound:true,newPreparationsAllowed:0,providerAndOriginalBudgetRecheckRequired:true,
   transportEvidence:'github-live-prepared-handoff',financialRetryAuthorized:false});
 }finally{token=undefined;}
}
