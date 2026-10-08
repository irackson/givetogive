// Explicit native operator. Default/import is inert. One original admission;
// no financial replay, direct tier grants, live mode, new keys or public artifacts.
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, lstatSync, realpathSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const guard=value=>{if(!value)throw Error('Native Checkout operator stopped; originals retained; no automatic retry.');};
/** GitHub API 2026-03-10 returns 200 with the exact created run, not legacy 204. */
export function checkoutDispatchRunId(value) {
 guard(value&&Number.isSafeInteger(value.workflow_run_id)&&value.workflow_run_id>0);
 const id=String(value.workflow_run_id);
 guard(value.run_url===`https://api.github.com/repos/irackson/givetogive/actions/runs/${id}`&&
  value.html_url===`https://github.com/irackson/givetogive/actions/runs/${id}`&&
  Object.keys(value).length===3);
 return id;
}

export async function executeNativeCheckoutOperator() {
 guard(process.platform==='win32'&&Number(process.versions.node.split('.')[0])===24);
 const { approved, approvedSourceTuple, validateManifest }=await import('../tools/simulation/src/hosted-checkout-policy.ts');
 const { inspectLocalCheckoutPrerequisites }=await import('./checkout-operator-inspect.mjs');
 const { inspectLocalCheckoutRelease, recheckLocalCheckoutRelease }=await import('./checkout-release-inspect.mjs');
 const { checkoutRunnerFiles }=await import('../tools/simulation/src/hosted-checkout-parent.ts');
 const { loadCheckoutTransferKey }=await import('../tools/simulation/scripts/provision-checkout-key.mjs');
 const { validateSavedCredentials }=await import('../tools/simulation/src/provisioning.ts');
 const { UiSession }=await import('../tools/simulation/src/ui-session.ts');
 const { UiCheckoutPreparation }=await import('../tools/simulation/src/ui-checkout-preparation.ts');
 const { observeCheckoutReadiness }=await import('../tools/simulation/src/checkout-readiness-observer.ts');
 const { checkoutResponseBytes }=await import('../tools/simulation/src/checkout-input-mailbox.ts');
 const { prepareHostedCheckoutInput }=await import('../tools/simulation/src/checkout-root-preparation.ts');
 const { respondCheckoutProofRequest }=await import('../tools/simulation/src/checkout-root-responder.ts');
 const { LocalCheckoutProofReader, stripeCheckoutReads }=await import('../tools/simulation/src/checkout-provider-proof.ts');
 const { CheckoutPrivateDraft }=await import('../tools/simulation/src/hosted-checkout-github.ts');
 const { unseal }=await import('../tools/simulation/src/hosted-community-bundle.ts');
 const { stripeClient }=await import('../src/server/payments/stripe.ts');
 const signal=AbortSignal.timeout(1200000);
 let key,session,preparation,prepared,draft,directory,phase='local-prerequisites',failure;
 let token;
 const progress=()=>console.log(JSON.stringify({phase,paymentAccepted:false,retryAllowed:false}));
 const original=(name,value)=>{
  guard(directory&&/^[a-z0-9.-]+$/.test(name));
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  guard(bytes.length<=8*1024*1024);
  const fd=openSync(join(directory,name),'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);if(!Buffer.isBuffer(value))bytes.fill(0);}
 };
 try {
  progress();let prerequisites=await inspectLocalCheckoutPrerequisites();
  const release=await inspectLocalCheckoutRelease(), head=release.headSha;
  const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000});
  const runner=createHash('sha256');
  for(const name of checkoutRunnerFiles)runner.update(name).update('\0').update(git(['show',`${head}:tools/simulation/src/${name}`])).update('\0');
  runner.update('package-lock.json').update('\0').update(git(['show',`${head}:tools/simulation/package-lock.json`])).update('\0');
  runner.update('.github/workflows/checkout-staging.yml').update('\0').update(git(['show',`${head}:.github/workflows/checkout-staging.yml`])).update('\0');
  const source={sourceDigest:release.sourceDigest,canonicalSourceDigest:release.canonicalSourceDigest,rootLockDigest:release.rootLockDigest,runnerDigest:runner.digest('hex')};
  guard(approvedSourceTuple(source));
  const localState=join(root,'tools/simulation/.state');
  guard(lstatSync(localState).isDirectory()&&!lstatSync(localState).isSymbolicLink()&&realpathSync(localState)===localState);
  directory=join(localState,`checkout-native-${approved.operationId}-${head}`);mkdirSync(directory,{mode:0o700});
  original('operator-lease.json',{headSha:head,operationId:approved.operationId,maximumDispatches:1,maximumPreparations:1,maximumSubmits:1,paymentAccepted:false,retryAllowed:false});
  original('release.original.json',release);original('prerequisites.original.json',prerequisites.summary);
  key=loadCheckoutTransferKey();
  const tokenBytes=execFileSync('gh',['auth','token'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16384});
  try{token=tokenBytes.toString().trim();guard(token.length>=20&&!/[\r\n]/.test(token));}finally{tokenBytes.fill(0);}
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'};
  async function gh(path,method='GET',body,expected=200) {
   signal.throwIfAborted();const response=await fetch(`https://api.github.com/repos/${approved.repository}${path?'/'+path:''}`,{
    method,headers,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),...(body===undefined?{}:{body:JSON.stringify(body)})});
   guard(response.status===expected);
   if(expected===204){void response.body?.cancel().catch(()=>undefined);return;}
   const bytes=await checkoutResponseBytes(response,1048576,signal);
   try{return JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}
  }
  const repo=await gh('');guard(repo.full_name===approved.repository&&repo.private===false);
  const tag=`checkout-acceptance-${approved.operationId}`;
  const absent=await fetch(`https://api.github.com/repos/${approved.repository}/releases/tags/${tag}`,{headers,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  try{guard(absent.status===404);}finally{void absent.body?.cancel().catch(()=>undefined);}
  const credentials=validateSavedCredentials(JSON.parse(readFileSync(join(localState,'runs',approved.runId,'credentials.json'),'utf8')),
   {runId:approved.runId,mode:'deterministic',origin:approved.origin,databaseIdentity:approved.databaseIdentity,population:3});
  const member=credentials.agents.find(value=>value.id===approved.memberId);
  guard(member?.userId===approved.actorId&&member.email===approved.memberEmail&&member.password);
  const account={id:member.id,userId:member.userId,email:member.email,password:member.password};
  const bypass=JSON.parse(readFileSync(join(localState,'protection.json'),'utf8')).vercelProtectionBypass;
  guard(typeof bypass==='string'&&bypass.length>=16);
  phase='normal-member-sign-in';progress();original('normal-sign-in.intent.json',{actorId:approved.actorId,maximumPosts:1,retryAllowed:false});
  session=await UiSession.signIn(approved.origin,account,bypass);
  phase='private-draft';progress();
  original('draft-create.intent.json',{headSha:head,tag,maximumPosts:1,retryAllowed:false});
  const created=await gh('releases','POST',{tag_name:tag,target_commitish:head,name:'Private staging Checkout acceptance',draft:true,prerelease:false,
   body:JSON.stringify({protocol:1,purpose:'one-member-test-checkout-policy',repository:approved.repository,runId:approved.runId,operationId:approved.operationId,headSha:head})},201);
  guard(Number.isSafeInteger(created.id)&&created.id>0&&created.draft===true&&created.prerelease===false&&created.published_at===null&&created.target_commitish===head&&created.assets.length===0);
  const releaseId=created.id;original('draft-create.result.json',{releaseId,headSha:head,tag,paymentAccepted:false});
  const anonymous=await fetch(`https://api.github.com/repos/${approved.repository}/releases/${releaseId}`,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  try{guard(anonymous.status===404);}finally{void anonymous.body?.cancel().catch(()=>undefined);}
  const existing=await gh('actions/workflows/checkout-staging.yml/runs?event=workflow_dispatch&branch=main&per_page=30');
  guard(Array.isArray(existing.workflow_runs)&&!existing.workflow_runs.some(run=>['queued','in_progress','waiting','pending','requested'].includes(run.status)));
  phase='native-dispatch';progress();original('workflow-dispatch.intent.json',{headSha:head,releaseId,maximumPosts:1,retryAllowed:false});
  const dispatched=await gh('actions/workflows/checkout-staging.yml/dispatches','POST',{ref:'main',inputs:{expected_sha:head,release_id:String(releaseId)}},200);
  const runId=checkoutDispatchRunId(dispatched),discoveryEnd=Date.now()+600000;
  const run=await gh(`actions/runs/${runId}`);
  guard(String(run.id)===runId&&run.head_sha===head&&run.run_attempt===1&&run.head_branch==='main'&&run.event==='workflow_dispatch'&&
   run.actor?.login===approved.actor&&run.triggering_actor?.login===approved.actor&&run.path==='.github/workflows/checkout-staging.yml');
  original('workflow-dispatch.result.json',{runId,headSha:head,releaseId,retryAllowed:false});
  phase='native-readiness';progress();let check;
  while(!check){
   guard(Date.now()<discoveryEnd);const current=await gh(`actions/runs/${runId}`);guard(current.status!=='completed');
   const checks=await gh(`commits/${head}/check-runs?check_name=${encodeURIComponent('GiveToGive Checkout parent readiness')}&per_page=100`);
   const matches=checks.check_runs.filter(value=>value.external_id?.startsWith(`checkout-ready-${runId}-`));
   guard(matches.length<=1);check=matches[0];if(!check)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  const binding={headSha:head,runId,checkRunId:String(check.id),canonicalSourceDigest:source.canonicalSourceDigest,rootLockDigest:source.rootLockDigest,runnerDigest:source.runnerDigest};
  const observation=await observeCheckoutReadiness(binding,{token,signal});guard(observation.transportEvidence==='github-live-readiness-observation');
  const readiness=observation.readiness;original('readiness.original.json',observation);
  const manifest=validateManifest({protocol:1,purpose:'one-member-test-checkout-policy',
   job:{repository:approved.repository,actor:approved.actor,triggeringActor:approved.actor,event:'workflow_dispatch',ref:'refs/heads/main',attempt:1,
    id:readiness.jobId,headSha:head,nonce:readiness.jobNonce,publicRepository:true,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24},
   releaseId,createdAt:new Date().toISOString(),runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,origin:approved.origin,
   databaseIdentity:approved.databaseIdentity,...source,currency:'usd',maximumAmountCents:1500,expectedTier:'sustainer',scenario:'success',
   budget:{runBudgetCents:2500,actorBudgetCents:1500,priorExpiredReservedCents:1000,candidateReservedCents:1500,
    originalAdmissionDigest:prerequisites.original.originalAdmissionDigest,expiredHistoryDigests:prerequisites.original.expiredHistoryDigests,noReset:true},
   rootProof:{observedAt:prerequisites.summary.observedAt,localIsolationVerified:true,normalMemberOnly:true,noMemberTokens:true,
    noCheckoutSubmitAdmission:true,canonicalCustomerClockVerified:true,releaseVerified:true,supportsTestSubscriptionsOnly:true}},head,Date.now());
  original('manifest.original.json',manifest);draft=new CheckoutPrivateDraft(manifest,head,token);
  preparation=new UiCheckoutPreparation(prerequisites.original.originalStore,prerequisites.original.plan);
  const verifyCurrent=async()=>{
   await recheckLocalCheckoutRelease(release);
   const currentPhase=preparation.state(approved.operationId)===undefined?'unused':'prepared';
   prerequisites=await inspectLocalCheckoutPrerequisites(currentPhase);
   await session.verifyIdentity();
   await observeCheckoutReadiness(binding,{token,signal,original:readiness});
  };
  phase='normal-checkout-preparation';progress();
  prepared=await prepareHostedCheckoutInput(manifest,head,{root:directory,key,readiness,account,stagingBypass:bypass,session,
   plan:prerequisites.original.plan,preparation,verifyCurrent,signal,draft,
   createOwnedReader:async m=>{
    const target=prerequisites.target;guard(prerequisites.original.candidatePrepared&&target?.sessionId);
    return new LocalCheckoutProofReader(m,head,{customerAccountId:target.customerAccountId,clockId:target.clockId,frozenTime:target.frozenTime,sessionId:target.sessionId},stripeCheckoutReads(stripeClient()));
   }});
  phase='pre-submit-proof';progress();
  await respondCheckoutProofRequest(manifest,head,prepared.opening,{root:directory,key,draft,reader:prepared.reader,verifyCurrent,signal});
  phase='original-final-recovery';progress();
 }catch{failure=true;progress();}
 finally{
  try{
   if(draft&&key){
    original('final-download.intent.json',{maximumDownloads:1,paymentAccepted:false,retryAllowed:false});
    const final=await draft.download('final',AbortSignal.timeout(720000));
    try{original('final.original.g2genc',final);const decoded=unseal(final,key);
     guard(decoded&&typeof decoded==='object');original('final-recovery.result.json',{originalRetained:true,authenticatedDecryption:true,
      ciphertextDigest:createHash('sha256').update(final).digest('hex'),paymentAccepted:false,independentSettlementRequired:true,retryAllowed:false});
    }finally{final.fill(0);}
   }
  }catch{failure=true;phase='final-recovery-unconfirmed';progress();}
  prepared?.reader.close();preparation?.close();await session?.close();key?.fill(0);token=undefined;
 }
 guard(!failure);
 return {nativeRunFinished:true,originalFinalRetained:true,paymentAccepted:false,independentSettlementRequired:true,retryAllowed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length===3&&process.argv[2]==='--execute-reviewed')console.log(JSON.stringify(await executeNativeCheckoutOperator()));
  else{guard(process.argv.length===2);console.log(JSON.stringify({execute:false,externalRequests:0,checkoutCreated:false,paymentAccepted:false}));}
 }catch{console.error('Native Checkout operator stopped; originals retained; no automatic retry.');process.exitCode=1;}
}
