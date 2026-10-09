/** Explicit Linux CURRENT bootstrap. Default/import is inert. Root supplies
 * ordinary-member input only after owned Chromium readiness. No Stripe/SQL/admin
 * key, financial preparation, settlement assertion or automatic financial retry. */
import { randomBytes,createHash } from 'node:crypto';
import { existsSync,mkdirSync,lstatSync,realpathSync,readdirSync,openSync,fsyncSync,closeSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { z } from 'zod';
import { chromium } from 'playwright';
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile,type CurrentCheckoutProfile } from './checkout-current-profile.ts';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { checkoutParentSourceSnapshot } from './hosted-checkout-parent.ts';
import { checkMemory,validateChildEnvironment,assetName,limits } from './hosted-checkout-policy.ts';
import { checkoutBrowserCacheRoot } from './checkout-bootstrap.ts';
import { prepareCurrentCheckoutParent,inspectPreparedCurrentCheckoutParent,runCurrentCheckoutParent,closePreparedCurrentCheckoutParent } from './checkout-current-parent.ts';
import { observeCurrentCheckoutJob } from './checkout-current-job.ts';
import { currentProfileDigest,currentPhaseNames } from './checkout-current-phase.ts';
import { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
import { awaitCurrentDraftAssociation } from './checkout-current-association.ts';
import { decryptCurrentCheckoutInput } from './checkout-current-input.ts';
import { CurrentCheckoutPhaseExchange } from './checkout-current-exchange.ts';
import { readBootstrapOriginal,writeBootstrapOriginal } from './checkout-bootstrap-retention.ts';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
import { seal,unseal,privateFile,type PrivateFile } from './hosted-community-bundle.ts';
const base=fileURLToPath(new URL('../',import.meta.url));
const fail=():never=>{throw Error('Current native bootstrap stopped; originals retained; no retry; private details withheld.');};
function guard(value:unknown):asserts value{if(!value)fail();}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const digest=(value:unknown)=>hash(Buffer.from(JSON.stringify(value)));
const bootstrapStages=z.enum(['configuration','memory','source','job','profile','state','browser-environment','browser-readiness',
 'readiness-publication','association','input-transfer','input-validation','member-execution','final-retention','diagnostic-cleanup']);
/** Fixed stage codes only: never forward exception text, environment values,
 * provider URLs, cookies or worker output into a public diagnostic. */
export function currentBootstrapFailureDiagnostic(phase:unknown,diagnosticOnly:unknown,retained:unknown){
 return {nativeBootstrapFailed:true,phase:bootstrapStages.parse(phase),diagnosticOnly:z.boolean().parse(diagnosticOnly),
 privateFinalRetentionVerified:z.boolean().parse(retained),independentClosureAndSettlementRequired:true,
 paymentAccepted:false,retryAllowed:false,privateDetailsWithheld:true};
}
export function currentCheckoutBootstrapConfiguration(env:NodeJS.ProcessEnv,platform:string,nodeMajor:number){
 guard(platform==='linux'&&nodeMajor===24&&env.GITHUB_REPOSITORY==='irackson/givetogive'&&env.GITHUB_REPOSITORY_OWNER==='irackson'&&
 env.GITHUB_ACTOR==='irackson'&&env.GITHUB_TRIGGERING_ACTOR==='irackson'&&env.GITHUB_REF==='refs/heads/main'&&
 env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_RUN_ATTEMPT==='1'&&env.GITHUB_JOB==='checkout-current-parent');
 guard(!Object.keys(env).some(key=>/^(STRIPE_|DATABASE_|GOOGLE_|GMAIL_|RESEND_|NEXTAUTH_|AUTH_SECRET|SIM_CREDENTIALS|SIM_RUNNER|COMMUNITY_)/.test(key)));
 const config=z.object({headSha:z.string().regex(/^[a-f0-9]{40}$/),expectedHead:z.string().regex(/^[a-f0-9]{40}$/),
 workflowRunId:z.string().regex(/^[1-9][0-9]{0,19}$/),releaseId:z.coerce.number().int().positive(),key:z.string().regex(/^[a-f0-9]{64}$/),
 token:z.string().min(20).max(4096).refine(value=>!/[\r\n]/.test(value)),path:z.string().min(1)}).strict().parse({
 headSha:env.GITHUB_SHA,expectedHead:env.CHECKOUT_EXPECTED_SHA,workflowRunId:env.GITHUB_RUN_ID,releaseId:env.CHECKOUT_RELEASE_ID,
 key:env.CHECKOUT_BUNDLE_KEY,token:env.CHECKOUT_GITHUB_TOKEN,path:env.PATH});
 guard(config.headSha===config.expectedHead);return config;
}
function contained(path:string){for(let cursor=resolve(path);;cursor=dirname(cursor)){guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);if(dirname(cursor)===cursor)break;}}
function record(directory:string,name:string,value:unknown){const bytes=Buffer.from(JSON.stringify(value));try{writeBootstrapOriginal(directory,name,bytes);}finally{bytes.fill(0);}}
/** Strict public readiness shape; credentials/provider URLs are never permitted. */
export function validateCurrentBootstrapReadiness(raw:unknown,now:number){
 const value=z.object({protocol:z.literal(1),purpose:z.literal('current-checkout-browser-readiness'),profile:z.unknown(),profileDigest:z.string().regex(/^[a-f0-9]{64}$/),
 connectionNonce:z.string().regex(/^[a-f0-9]{32}$/),observedAt:z.iso.datetime(),freeBytes:z.number().finite(),browserConnected:z.literal(true),
 parentEvidence:z.literal('native-linux-parent'),rootSourceAndJobReviewStillRequired:z.literal(true),financialAdmission:z.literal(false),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict().parse(raw);
 guard(Number.isFinite(now));const candidate=value.profile as CurrentCheckoutProfile;
 const profile=validateCurrentCheckoutProfile(candidate,candidate.job.headSha,candidate.source,Date.parse(candidate.job.observedAt));
 const age=now-Date.parse(value.observedAt);guard(age>=-5000&&age<=30000&&value.profileDigest===currentProfileDigest(profile));checkMemory(value.freeBytes,false);
 return {...value,profile};
}
async function publish(profile:CurrentCheckoutProfile,ready:ReturnType<typeof inspectPreparedCurrentCheckoutParent>,directory:string,token:string,signal:AbortSignal){
 guard(ready.executionEvidence==='native-linux-parent');
 const value=validateCurrentBootstrapReadiness({protocol:1,purpose:'current-checkout-browser-readiness',profile,profileDigest:ready.profileDigest,
 connectionNonce:ready.connectionNonce,observedAt:ready.observedAt,freeBytes:ready.freeBytes,browserConnected:true,parentEvidence:ready.executionEvidence,
 rootSourceAndJobReviewStillRequired:true,financialAdmission:false,paymentAccepted:false,retryAllowed:false},Date.now());
 const summary=JSON.stringify(value),name='GiveToGive current Checkout browser readiness';
 const external=`current-checkout-ready-${profile.job.workflowRunId}-${profile.job.jobId}-${profile.job.jobNonce}`;
 const target={headSha:profile.job.headSha,workflowRunId:profile.job.workflowRunId,jobId:profile.job.jobId};
 const json=async(path:string,method='GET',body?:unknown,expected=200)=>{signal.throwIfAborted();
 const response=await fetch(`https://api.github.com/repos/irackson/givetogive/${path}`,{method,headers:{Authorization:`Bearer ${token}`,
 Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',
 signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(response.status!==expected){void response.body?.cancel().catch(()=>undefined);fail();}
 const bytes=await checkoutResponseBytes(response,262144,signal);try{return JSON.parse(bytes.toString());}finally{bytes.fill(0);}};
 await observeCurrentCheckoutJob(target,{token,signal});
 record(directory,'readiness-publication.intent.json',{profileDigest:value.profileDigest,summaryDigest:digest(value),maximumPublications:1,paymentAccepted:false,retryAllowed:false});
 const check=z.object({id:z.number().int().positive(),name:z.literal(name),head_sha:z.literal(profile.job.headSha),external_id:z.literal(external),
 status:z.literal('in_progress'),conclusion:z.null(),app:z.object({slug:z.literal('github-actions')}),output:z.object({title:z.literal(name),summary:z.literal(summary)})});
 const created=check.parse(await json('check-runs','POST',{name,head_sha:profile.job.headSha,external_id:external,status:'in_progress',
 started_at:value.observedAt,output:{title:name,summary}},201));
 await observeCurrentCheckoutJob(target,{token,signal});const retained=check.parse(await json(`check-runs/${created.id}`));guard(retained.id===created.id);
 validateCurrentBootstrapReadiness(value,Date.now());record(directory,'readiness-publication.result.json',{checkRunId:retained.id,
 profileDigest:value.profileDigest,summaryDigest:digest(value),readbackVerified:true,paymentAccepted:false,retryAllowed:false});
}
const bootstrapNames=new Set(['bootstrap-lease.json','readiness-publication.intent.json','readiness-publication.result.json',
 'association-wait.intent.json','association-wait.result.json',
 'input-download.intent.json','original-input.g2genc','bootstrap-result.json']);
const parentNames=new Set(['launch-lease.json','browser-readiness.json','input-transfer-intent.json','worker-receipt.json','parent-receipt.json']);
const exchangeNames=new Set(['exchange-lease.json',...currentPhaseNames.flatMap(phase=>[`${phase}-request.g2genc`,`${phase}-response.g2genc`,
 `${phase}-upload-intent.json`,`${phase}-upload-result.json`,`${phase}-accepted.json`])]);
/** Fixed evidence inventory only, never browser home/tmp or arbitrary files. */
export function collectCurrentBootstrapEvidence(directory:string,profile:CurrentCheckoutProfile):PrivateFile[]{
 contained(directory);const files:PrivateFile[]=[];let total=0;
 const collect=(path:string,prefix:string,names:Set<string>)=>{contained(path);guard(lstatSync(path).isDirectory());
 for(const name of readdirSync(path).sort()){guard(names.has(name));const bytes=readBootstrapOriginal(join(path,name),65536);
 try{total+=bytes.length;guard(total<=2*1024*1024);files.push(privateFile(prefix+name,bytes));}finally{bytes.fill(0);}}};
 const parentName=`current-checkout-${profile.runId}-${profile.operationId}`;
 const exchangeName=`current-checkout-exchange-${profile.operationId}-${profile.job.jobId}-${profile.job.jobNonce}`;
 for(const name of readdirSync(directory).sort()){
 if(['final.original.g2genc','final-upload.intent.json','final-upload.result.json'].includes(name))continue;
 if(['member-home','member-tmp'].includes(name)){contained(join(directory,name));guard(lstatSync(join(directory,name)).isDirectory());continue;}
 if(name===parentName){collect(join(directory,name),name+'/',parentNames);continue;}
 if(name===exchangeName){collect(join(directory,name),name+'/',exchangeNames);continue;}
 guard(bootstrapNames.has(name));const bytes=readBootstrapOriginal(join(directory,name),65536);
 try{total+=bytes.length;guard(total<=2*1024*1024);files.push(privateFile(name,bytes));}finally{bytes.fill(0);}
 }
 guard(files.some(file=>file.name==='bootstrap-lease.json')&&files.some(file=>file.name==='bootstrap-result.json'));return files;
}
export async function retainCurrentBootstrapFinal(directory:string,profile:CurrentCheckoutProfile,key:Buffer,releaseId:number,
 draft:Pick<CurrentCheckoutPrivateDraft,'upload'>,signal:AbortSignal,now=Date.now){
 let encrypted:Buffer|undefined;
 try{const files=collectCurrentBootstrapEvidence(directory,profile),filesDigest=digest(files.map(({name,digest:sha})=>({name,digest:sha})));
 const binding={releaseId,operationId:profile.operationId,job:{id:profile.job.jobId,nonce:profile.job.jobNonce,headSha:profile.job.headSha}};
 record(directory,'final-upload.intent.json',{profileDigest:currentProfileDigest(profile),filesDigest,maximumUploads:1,paymentAccepted:false,retryAllowed:false});
 encrypted=seal({protocol:1,purpose:'current-checkout-native-originals',profileDigest:currentProfileDigest(profile),binding,files,
 excludedMemberRuntimeDirectories:true,independentClosureAndSettlementRequired:true,paymentAccepted:false,retryAllowed:false},key);
 guard(encrypted.length<=limits.checkpointBytes);const decoded=unseal(encrypted,key,4*1024*1024) as {files:PrivateFile[]};guard(digest(decoded.files)===digest(files));
 writeBootstrapOriginal(directory,'final.original.g2genc',encrypted,limits.checkpointBytes);
 const unchanged=()=>guard(digest(collectCurrentBootstrapEvidence(directory,profile).map(({name,digest:sha})=>({name,digest:sha})))===filesDigest);
 unchanged();signal.throwIfAborted();const raw=await draft.upload('final',encrypted,signal);signal.throwIfAborted();unchanged();
 const receipt=z.object({phase:z.literal('final'),assetId:z.number().int().positive(),name:z.literal(assetName(binding,'final')),size:z.literal(encrypted.length),
 ciphertextDigest:z.literal(hash(encrypted)),releaseId:z.literal(releaseId),jobId:z.literal(profile.job.jobId),jobNonce:z.literal(profile.job.jobNonce),
 headSha:z.literal(profile.job.headSha),operationId:z.literal(profile.operationId),anonymousDraft404:z.literal(true),anonymousAsset404:z.literal(true),
 observedAt:z.iso.datetime(),exactRetainedAssetVerified:z.literal(true),readbackVerified:z.literal(true),retryAllowed:z.literal(false),paymentAccepted:z.literal(false)}).strict().parse(raw);
 const original=readBootstrapOriginal(join(directory,'final.original.g2genc'),limits.checkpointBytes);try{guard(original.equals(encrypted));}finally{original.fill(0);}
 const age=now()-Date.parse(receipt.observedAt);guard(Number.isFinite(now())&&age>=-5000&&age<=30000);record(directory,'final-upload.result.json',receipt);
 return {privateFinalRetentionVerified:true,paymentAccepted:false,retryAllowed:false};
 }catch{return fail();}finally{encrypted?.fill(0);}
}
/** No injected runtime can report native bootstrap success. */
export async function executeCurrentCheckoutBootstrap(diagnosticOnly=false){
 let key:Buffer|undefined,inputBytes:Buffer|undefined,directory:string|undefined,profile:CurrentCheckoutProfile|undefined;
 let draft:CurrentCheckoutPrivateDraft|undefined,prepared:Awaited<ReturnType<typeof prepareCurrentCheckoutParent>>|undefined,exchange:CurrentCheckoutPhaseExchange|undefined;
 let result:Awaited<ReturnType<typeof runCurrentCheckoutParent>>|undefined,releaseId:number|undefined,retained=false;
 let phase:z.infer<typeof bootstrapStages>='configuration';const controller=new AbortController(),stop=()=>controller.abort();
 try{guard(typeof diagnosticOnly==='boolean'&&process.argv.length===3&&process.argv[2]===(diagnosticOnly?'--execute-readiness-diagnostic':'--execute-current-native-bootstrap'));
 const config=currentCheckoutBootstrapConfiguration(process.env,process.platform,Number(process.versions.node.split('.')[0]));releaseId=config.releaseId;
 phase='memory';checkMemory(freemem(),true);
 phase='source';const source=checkoutParentSourceSnapshot(config.headSha),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(900000)]);
 phase='job';
 const observed=await observeCurrentCheckoutJob({headSha:config.headSha,workflowRunId:config.workflowRunId},{token:config.token,signal});
 guard(observed.transportEvidence==='github-live-current-job');
 phase='profile';profile=validateCurrentCheckoutProfile({protocol:1,purpose:'current-cohort-one-checkout',runId:c.runId,agentId:c.agentId,operationId:c.operationId,
 planDigest:c.planDigest,databaseIdentity:c.databaseIdentity,origin:c.origin,maximumAmountCents:500,currency:'usd',scenario:'decline',checkoutTier:'supporter',expectedResultTier:'neighbor',
 runBudgetCents:2500,actorBudgetCents:1500,noHistoryReset:true,maximumMemberLaunches:1,maximumSubmissions:1,retryAllowed:false,financialAdmission:false,paymentAccepted:false,
 stagedDeploymentId:checkoutReleaseBinding.deploymentId,source,job:{repository:'irackson/givetogive',actor:'irackson',triggeringActor:'irackson',event:'workflow_dispatch',ref:'refs/heads/main',attempt:1,
 runner:'ubuntu-24.04',platform:'linux',nodeMajor:24,workflowRunId:config.workflowRunId,jobId:observed.jobId,jobNonce:randomBytes(16).toString('hex'),headSha:config.headSha,
 status:'in_progress',observedAt:observed.observedAt,freeBytes:freemem(),publicRepository:true}},config.headSha,source,Date.now());
 phase='state';const root=join(base,'.state');if(!existsSync(root))mkdirSync(root,{mode:0o700});contained(root);guard((lstatSync(root).mode&0o077)===0);
 directory=join(root,`${diagnosticOnly?'checkout-current-diagnostic':'checkout-current-bootstrap'}-${config.workflowRunId}`);mkdirSync(directory,{mode:0o700});
 const rootFd=openSync(root,'r');try{fsyncSync(rootFd);}finally{closeSync(rootFd);}
 record(directory,'bootstrap-lease.json',{profile,releaseId:config.releaseId,maximumMemberLaunches:1,financialAdmission:false,paymentAccepted:false,retryAllowed:false});
 key=Buffer.from(config.key,'hex');delete process.env.CHECKOUT_BUNDLE_KEY;delete process.env.CHECKOUT_GITHUB_TOKEN;
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 phase='browser-environment';const home=join(directory,'member-home'),temp=join(directory,'member-tmp');mkdirSync(home,{mode:0o700});mkdirSync(temp,{mode:0o700});
 const executable=chromium.executablePath();guard(lstatSync(executable).isFile());
 const environment=validateChildEnvironment({PATH:config.path,HOME:home,TMPDIR:temp,PLAYWRIGHT_BROWSERS_PATH:checkoutBrowserCacheRoot(executable)});
 // Association stays bound to the INITIAL public profile even if private input
 // later refreshes only observedAt/freeBytes of this exact job.
 phase='browser-readiness';
 prepared=await prepareCurrentCheckoutParent(profile,config.headSha,source,{root:directory,memberEnvironment:environment,signal});
 // This branch has no draft association, public financial readiness, input
 // download, member sign-in, provider access, preparation or submission.
 if(diagnosticOnly){phase='diagnostic-cleanup';const cleanup=await closePreparedCurrentCheckoutParent(prepared);
  guard(cleanup.ownedGroupClosed&&cleanup.exitObserved&&cleanup.publicOutputBytes===0&&!cleanup.escapedDescendantObserved);
  return {readinessDiagnosticOnly:true,nativeBrowserReadinessVerified:true,ownedBrowserGroupClosed:true,
   readinessPublished:false,privateInputTransferred:false,memberSignIns:0,checkoutPrepared:false,submitAttempts:0,
   paymentAccepted:false,retryAllowed:false};}
 draft=new CurrentCheckoutPrivateDraft(profile,config.headSha,source,config.releaseId,config.token);
 phase='readiness-publication';
 await publish(profile,inspectPreparedCurrentCheckoutParent(prepared),directory,config.token,signal);
 phase='association';
 record(directory,'association-wait.intent.json',{profileDigest:currentProfileDigest(profile),readOnly:true,maximumAssociationWrites:0,paymentAccepted:false,retryAllowed:false});
 const association=await awaitCurrentDraftAssociation(draft,config.releaseId,{token:config.token,signal,verifyCurrent:async scoped=>{
  const observed=await observeCurrentCheckoutJob({headSha:config.headSha,workflowRunId:config.workflowRunId,jobId:profile!.job.jobId},{token:config.token,signal:scoped});
  guard(observed.transportEvidence==='github-live-current-job');inspectPreparedCurrentCheckoutParent(prepared!);
 }});
 record(directory,'association-wait.result.json',association);
 phase='input-transfer';record(directory,'input-download.intent.json',{profileDigest:currentProfileDigest(profile),maximumDownloads:1,paymentAccepted:false,retryAllowed:false});
 inputBytes=await draft.download('input',signal);writeBootstrapOriginal(directory,'original-input.g2genc',inputBytes,65536);
 phase='input-validation';const input=decryptCurrentCheckoutInput(inputBytes,key,profile,Date.now());
 const target={headSha:config.headSha,workflowRunId:config.workflowRunId,jobId:profile.job.jobId};
 const verify=async(scoped:AbortSignal)=>{inspectPreparedCurrentCheckoutParent(prepared!);const current=checkoutParentSourceSnapshot(config.headSha);guard(digest(current)===digest(source));
 await observeCurrentCheckoutJob(target,{token:config.token,signal:scoped});inspectPreparedCurrentCheckoutParent(prepared!);};
 await verify(signal);exchange=new CurrentCheckoutPhaseExchange(directory,input,prepared.ready.connectionNonce,key,config.releaseId,draft,verify);
 phase='member-execution';result=await runCurrentCheckoutParent(prepared,input,exchange);record(directory,'bootstrap-result.json',{protocol:1,failed:result.failed,
 parent:result,independentClosureAndSettlementRequired:true,paymentAccepted:false,retryAllowed:false});
 phase='final-retention';await retainCurrentBootstrapFinal(directory,profile,key,config.releaseId,draft,signal);retained=true;guard(!result.failed);
 return {nativeBootstrap:true,privateFinalRetentionVerified:true,independentClosureAndSettlementRequired:true,paymentAccepted:false,retryAllowed:false};
 }catch{if(prepared)try{const cleanup=await closePreparedCurrentCheckoutParent(prepared);
 if(directory&&result===undefined)record(directory,'bootstrap-result.json',{protocol:1,failed:true,cleanup,independentClosureAndSettlementRequired:true,paymentAccepted:false,retryAllowed:false});
 }catch{/* Never claim successful cleanup from an exception. */}
 // No automatic second final upload. Uncertain transfer preserves its intent.
 if(directory&&profile&&key&&draft&&releaseId&&!existsSync(join(directory,'final-upload.intent.json'))&&existsSync(join(directory,'bootstrap-result.json'))){
 try{await retainCurrentBootstrapFinal(directory,profile,key,releaseId,draft,AbortSignal.timeout(180000));retained=true;}catch{/* Private original failure is retained locally. */}}
 console.error(JSON.stringify(currentBootstrapFailureDiagnostic(phase,diagnosticOnly,retained)));return fail();
 }finally{exchange?.close();key?.fill(0);inputBytes?.fill(0);process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===2)console.log(JSON.stringify({execute:false,externalRequests:0,financialAdmission:false,paymentAccepted:false}));
 else executeCurrentCheckoutBootstrap(process.argv[2]==='--execute-readiness-diagnostic').then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Current native bootstrap stopped; private details withheld.');process.exitCode=1;});
}
