/** Explicit native Linux entrypoint. Import is inert. No Stripe, SQL, admin,
 * MCP or runner-member credential. Ordinary-member credentials arrive encrypted
 * only after native readiness. No automatic session creation or financial retry. */
import { randomBytes } from 'node:crypto';
import { existsSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync,lstatSync,realpathSync } from 'node:fs';
import { basename,dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { z } from 'zod';
import { chromium } from 'playwright';
import { approved,checkMemory,validateChildEnvironment } from './hosted-checkout-policy.ts';
import { checkoutParentSourceSnapshot,runHostedCheckoutParent } from './hosted-checkout-parent.ts';
import { publishCheckoutReadiness } from './checkout-readiness.ts';
import { downloadBootstrapInput,checkoutResponseBytes } from './checkout-input-mailbox.ts';
import { decryptInput } from './hosted-checkout-protocol.ts';
import { CheckoutPrivateDraft,CheckoutBootstrapFailureDraft } from './hosted-checkout-github.ts';
import { retainCheckoutBootstrapFailure } from './checkout-bootstrap-retention.ts';
const base=fileURLToPath(new URL('../',import.meta.url));
const fail=():never=>{throw Error('Native Checkout bootstrap stopped; originals retained; no financial retry.');};
function guard(value:unknown):asserts value {if(!value)fail();}
export function checkoutBrowserCacheRoot(executable:string) {
 // The executable lives inside <cache>/chromium-<revision>/<platform>/chrome.
 // Child Playwright needs the shared cache, including the headless-shell sibling.
 guard(/^chromium-[0-9]+$/.test(basename(dirname(dirname(executable)))));
 return dirname(dirname(dirname(executable)));
}
export function checkoutBootstrapConfiguration(environment:NodeJS.ProcessEnv,platform:string,nodeMajor:number) {
 guard(platform==='linux'&&nodeMajor===24&&environment.GITHUB_REPOSITORY===approved.repository&&
  environment.GITHUB_REPOSITORY_OWNER===approved.actor&&environment.GITHUB_ACTOR===approved.actor&&
  environment.GITHUB_TRIGGERING_ACTOR===approved.actor&&environment.GITHUB_REF==='refs/heads/main'&&
  environment.GITHUB_EVENT_NAME==='workflow_dispatch'&&environment.GITHUB_RUN_ATTEMPT==='1'&&environment.GITHUB_JOB==='checkout-parent');
 // Fail closed on accidental configuration forwarding, without printing values.
 guard(!Object.keys(environment).some(key=>/^(STRIPE_|DATABASE_|GOOGLE_|GMAIL_|RESEND_|NEXTAUTH_|AUTH_SECRET|SIM_CREDENTIALS|SIM_RUNNER|COMMUNITY_)/.test(key)));
 return z.object({headSha:z.string().regex(/^[a-f0-9]{40}$/),expectedHead:z.string().regex(/^[a-f0-9]{40}$/),
  runId:z.string().regex(/^[1-9][0-9]{0,19}$/),releaseId:z.coerce.number().int().positive(),
  key:z.string().regex(/^[a-f0-9]{64}$/),token:z.string().min(20).max(4096),path:z.string().min(1)}).strict().parse({
  headSha:environment.GITHUB_SHA,expectedHead:environment.CHECKOUT_EXPECTED_SHA,runId:environment.GITHUB_RUN_ID,
  releaseId:environment.CHECKOUT_RELEASE_ID,key:environment.CHECKOUT_BUNDLE_KEY,token:environment.CHECKOUT_GITHUB_TOKEN,path:environment.PATH});
}
function original(directory:string,name:string,value:unknown) {
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));guard(bytes.length<=2*1024*1024);
 const fd=openSync(join(directory,name),'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 const dir=openSync(directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
 const saved=readFileSync(join(directory,name));try{guard(saved.equals(bytes));}finally{saved.fill(0);if(!Buffer.isBuffer(value))bytes.fill(0);}
}
/** No runtime-injection path: only this explicit command can report native
 * source/process/bootstrap evidence. Tests call configuration policy separately. */
export async function executeCheckoutBootstrap() {
 let key:Buffer|undefined,inputBytes:Buffer|undefined;
 const controller=new AbortController(),stop=()=>controller.abort();let directory:string|undefined;
 let recovery:{binding:{headSha:string;releaseId:number;jobId:string;jobNonce:string};token:string}|undefined;
 let phase:'readiness'|'input-transfer'|'input-validation'|'member-environment'='readiness',parentInvoked=false;
 try {
  guard(process.argv.length===3&&process.argv[2]==='--execute-native-bootstrap');
  const config=checkoutBootstrapConfiguration(process.env,process.platform,Number(process.versions.node.split('.')[0]));
  guard(config.headSha===config.expectedHead);checkMemory(freemem(),true);
  const source=checkoutParentSourceSnapshot(config.headSha);
  // Do not announce readiness against historical source approval. Root must
  // append a separately reviewed current tuple before dispatch, never rebind old evidence.
  guard(source.canonicalSourceDigest===approved.canonicalSourceDigest&&source.rootLockDigest===approved.rootLockDigest&&source.runnerDigest===approved.runnerDigest);
  guard(realpathSync(base)===base.replace(/[\\/]$/,''));
  const root=join(base,'.state');if(!existsSync(root))mkdirSync(root,{mode:0o700});
  guard(!lstatSync(root).isSymbolicLink()&&realpathSync(root)===root&&(lstatSync(root).mode&0o077)===0);
  directory=join(root,`checkout-bootstrap-${config.runId}`);mkdirSync(directory,{mode:0o700});
  const rootFd=openSync(root,'r');try{fsyncSync(rootFd);}finally{closeSync(rootFd);}
  const nonce=randomBytes(16).toString('hex');
  original(directory,'bootstrap-lease.json',{protocol:1,headSha:config.headSha,runId:config.runId,jobNonce:nonce,source,maximumMemberLaunches:1,paymentAccepted:false,retryAllowed:false});
  key=Buffer.from(config.key,'hex');delete process.env.CHECKOUT_BUNDLE_KEY;delete process.env.CHECKOUT_GITHUB_TOKEN;
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(900000)]);
  const response=await fetch(`https://api.github.com/repos/${approved.repository}/actions/runs/${config.runId}/jobs?filter=latest&per_page=100`,{
   headers:{Authorization:`Bearer ${config.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}
  const jobBytes=await checkoutResponseBytes(response,262144,signal);
  let jobId:string;
  try {
   const jobs=z.object({total_count:z.literal(1),jobs:z.array(z.object({id:z.number().int().positive(),name:z.literal('checkout-parent'),
    status:z.literal('in_progress'),head_sha:z.literal(config.headSha),run_id:z.coerce.string().pipe(z.literal(config.runId))})).length(1)}).parse(JSON.parse(jobBytes.toString('utf8')));
   jobId=String(jobs.jobs[0]!.id);
  }finally{jobBytes.fill(0);}
  recovery={binding:{headSha:config.headSha,releaseId:config.releaseId,jobId,jobNonce:nonce},token:config.token};
  const ready=await publishCheckoutReadiness({protocol:1,purpose:'checkout-parent-readiness',repository:approved.repository,
   headSha:config.headSha,runId:config.runId,jobId,jobNonce:nonce,observedAt:new Date().toISOString(),...source,freeBytes:freemem(),
   bootstrapSourceApprovalStillRequired:true,noCheckoutAdmission:true,paymentAccepted:false,retryAllowed:false},config.headSha,
   {token:config.token,directory,signal});
  guard(ready.transportEvidence==='github-live-run-job-readback');
  phase='input-transfer';
  const transferred=await downloadBootstrapInput({headSha:config.headSha,releaseId:config.releaseId,jobId,jobNonce:nonce},
   {token:config.token,signal,persistSelection:value=>original(directory!,'input-selection.intent.json',value)});
  inputBytes=transferred.ciphertext;original(directory,'original-input.g2genc',inputBytes);
  phase='input-validation';
  const input=decryptInput(inputBytes,key,config.headSha,Date.now());
  guard(input.manifest.releaseId===config.releaseId&&input.manifest.job.id===jobId&&input.manifest.job.nonce===nonce);
  phase='member-environment';
  const home=join(directory,'member-home'),temp=join(directory,'member-tmp');mkdirSync(home,{mode:0o700});mkdirSync(temp,{mode:0o700});
  const executable=chromium.executablePath();guard(lstatSync(executable).isFile());
  const environment=validateChildEnvironment({PATH:config.path,HOME:home,TMPDIR:temp,PLAYWRIGHT_BROWSERS_PATH:checkoutBrowserCacheRoot(executable)});
  const draft=new CheckoutPrivateDraft(input.manifest,config.headSha,config.token);
  parentInvoked=true;
  const result=await runHostedCheckoutParent(input,config.headSha,{root:directory,key,draft,memberEnvironment:environment,signal});
  original(directory,'bootstrap-result.json',{protocol:1,parentFailed:result.failed,finalRetentionVerified:!result.privateFinalRetentionStillRequired,
   nativeBootstrap:true,jobId,jobNonce:nonce,headSha:config.headSha,paymentAccepted:false,retryAllowed:false});
  guard(!result.failed);return {nativeBootstrap:true,privateFinalRetentionVerified:true,paymentAccepted:false,retryAllowed:false};
 }catch{
  if(!parentInvoked&&recovery&&directory&&key){
   const draft=new CheckoutBootstrapFailureDraft(recovery.binding,recovery.binding.headSha,recovery.token);
   await retainCheckoutBootstrapFailure(recovery.binding,directory,key,phase,draft,AbortSignal.timeout(180000));
  }
  return fail();
 }finally{key?.fill(0);inputBytes?.fill(0);process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 executeCheckoutBootstrap().then(result=>console.log(JSON.stringify(result))).catch(()=>{
  console.error('Native Checkout bootstrap stopped; private originals retained; no automatic retry.');process.exitCode=1;
 });
}
