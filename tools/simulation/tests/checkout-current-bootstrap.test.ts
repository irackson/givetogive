// Public fixtures, injected HTTP and temporary files only. No financial dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from 'node:fs';
import { join,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { currentProfile,now,head } from './fixtures/current-checkout.ts';
import { currentProfileDigest } from '../src/checkout-current-phase.ts';
import { currentCheckoutBootstrapConfiguration,validateCurrentBootstrapReadiness,collectCurrentBootstrapEvidence,retainCurrentBootstrapFinal } from '../src/checkout-current-bootstrap.ts';
import { observeCurrentCheckoutJob } from '../src/checkout-current-job.ts';
import { fileBytes,unseal } from '../src/hosted-community-bundle.ts';
import { assetName } from '../src/hosted-checkout-policy.ts';
import { createHash } from 'node:crypto';
const environment={GITHUB_REPOSITORY:'irackson/givetogive',GITHUB_REPOSITORY_OWNER:'irackson',GITHUB_ACTOR:'irackson',GITHUB_TRIGGERING_ACTOR:'irackson',
 GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'checkout-current-parent',
 GITHUB_SHA:head,CHECKOUT_EXPECTED_SHA:head,GITHUB_RUN_ID:'1234',CHECKOUT_RELEASE_ID:'42',CHECKOUT_BUNDLE_KEY:'d'.repeat(64),
 CHECKOUT_GITHUB_TOKEN:'public-fixture-token-only',PATH:'/public/bin'};
test('current bootstrap config is exact, separate from historical admission and excludes root credentials',()=>{
 assert.equal(currentCheckoutBootstrapConfiguration(environment,'linux',24).releaseId,42);
 for(const patch of [{GITHUB_JOB:'checkout-parent'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},
 {GITHUB_ACTOR:'other'},{GITHUB_TRIGGERING_ACTOR:'other'},{CHECKOUT_EXPECTED_SHA:'b'.repeat(40)},{GITHUB_REF:'refs/heads/other'},
 {STRIPE_SECRET_KEY:'public-forbidden'},{DATABASE_URL:'public-forbidden'},{GOOGLE_REFRESH_TOKEN:'public-forbidden'},
 {COMMUNITY_BUNDLE_KEY:'public-forbidden'},{CHECKOUT_GITHUB_TOKEN:'public-token\ninvalid'}])
 assert.throws(()=>currentCheckoutBootstrapConfiguration({...environment,...patch},'linux',24));
 assert.throws(()=>currentCheckoutBootstrapConfiguration(environment,'win32',24));assert.throws(()=>currentCheckoutBootstrapConfiguration(environment,'linux',22));
});
function readiness(){const profile=currentProfile();return {protocol:1,purpose:'current-checkout-browser-readiness',profile,profileDigest:currentProfileDigest(profile),
 connectionNonce:'d'.repeat(32),observedAt:new Date(now).toISOString(),freeBytes:4*1024**3,browserConnected:true,parentEvidence:'native-linux-parent',
 rootSourceAndJobReviewStillRequired:true,financialAdmission:false,paymentAccepted:false,retryAllowed:false};}
test('public readiness binds initial immutable profile but does not approve source or financial actions',()=>{
 const value=validateCurrentBootstrapReadiness(readiness(),now);assert.equal(value.financialAdmission,false);
 for(const patch of [{profileDigest:'0'.repeat(64)},{browserConnected:false},{parentEvidence:'injected-offline'},
 {observedAt:new Date(now-30001).toISOString()},{freeBytes:1024},{password:'public-forbidden'},{financialAdmission:true}])
 assert.throws(()=>validateCurrentBootstrapReadiness({...readiness(),...patch},now));
 const later={...readiness(),observedAt:new Date(now+60000).toISOString()};
 assert.equal(validateCurrentBootstrapReadiness(later,now+60000).profileDigest,later.profileDigest);
});
function jobFixture(){return {run:{id:1234,head_sha:head,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'in_progress',conclusion:null,
 path:'.github/workflows/checkout-current-staging.yml',actor:{login:'irackson'},triggering_actor:{login:'irackson'},repository:{full_name:'irackson/givetogive',private:false}},
 jobs:{total_count:1,jobs:[{id:5678,run_id:1234,head_sha:head,run_attempt:1,name:'checkout-current-parent',status:'in_progress',conclusion:null,labels:['ubuntu-24.04']}]}};}
const target={headSha:head,workflowRunId:'1234',jobId:'5678'};
test('current job observer makes exact bounded GETs and permanently labels injected evidence',async()=>{
 const data=jobFixture(),calls:string[]=[];const request:typeof fetch=async(url,options)=>{
 calls.push(String(url));assert.equal(options?.redirect,'error');assert.equal(options?.method,undefined);
 return Response.json(String(url).includes('/jobs?')?data.jobs:data.run);};
 const result=await observeCurrentCheckoutJob(target,{token:'public-fixture-token-only',signal:new AbortController().signal,request,now:()=>now});
 assert.equal(result.transportEvidence,'injected-offline-http');assert.equal(result.financialAdmission,false);assert.equal(result.observedAt,new Date(now).toISOString());
 assert.deepEqual(calls,['https://api.github.com/repos/irackson/givetogive/actions/runs/1234',
 'https://api.github.com/repos/irackson/givetogive/actions/runs/1234/jobs?filter=latest&per_page=100']);
});
test('foreign, completed, rerun, historical workflow or nonstandard runner jobs cannot establish readiness',async()=>{
 for(const mutate of [(d:ReturnType<typeof jobFixture>)=>{d.run.path='.github/workflows/checkout-staging.yml';},
 (d:ReturnType<typeof jobFixture>)=>{d.run.head_sha='b'.repeat(40);},(d:ReturnType<typeof jobFixture>)=>{d.run.run_attempt=2;},
 (d:ReturnType<typeof jobFixture>)=>{d.run.status='completed';},(d:ReturnType<typeof jobFixture>)=>{d.run.repository.private=true;},
 (d:ReturnType<typeof jobFixture>)=>{d.run.triggering_actor.login='other';},(d:ReturnType<typeof jobFixture>)=>{d.jobs.jobs[0]!.id=999;},
 (d:ReturnType<typeof jobFixture>)=>{d.jobs.jobs[0]!.labels=['self-hosted'];},(d:ReturnType<typeof jobFixture>)=>{d.jobs.jobs[0]!.status='queued';}]){
 const data=jobFixture();mutate(data);await assert.rejects(()=>observeCurrentCheckoutJob(target,{token:'public-fixture-token-only',signal:new AbortController().signal,
 request:async url=>Response.json(String(url).includes('/jobs?')?data.jobs:data.run),now:()=>now}));}
});
test('aborted, oversized, unsuccessful and slow job observations fail without another GET',async()=>{
 for(const mode of ['abort','large','http','slow'] as const){let calls=0,time=now;const controller=new AbortController();if(mode==='abort')controller.abort();
 const request:typeof fetch=async()=>{calls++;if(mode==='large')return new Response('x'.repeat(262145));if(mode==='http')return new Response('',{status:403});
 time=now+30001;return Response.json(jobFixture().run);};
 await assert.rejects(()=>observeCurrentCheckoutJob(target,{token:'public-fixture-token-only',signal:controller.signal,request,now:()=>time}));
 assert.equal(calls,mode==='abort'?0:1);}
});
function evidenceFixture(){const directory=mkdtempSync(join(tmpdir(),'g2g-current-final-')),profile=currentProfile();
 writeFileSync(join(directory,'bootstrap-lease.json'),JSON.stringify({profile,releaseId:42}),{mode:0o600});writeFileSync(join(directory,'bootstrap-result.json'),'{"failed":false}',{mode:0o600});
 return {directory,profile,cleanup(){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));rmSync(directory,{recursive:true});}};}
test('final evidence only includes fixed original files and excludes private member runtime directories',()=>{
 const f=evidenceFixture();try{mkdirSync(join(f.directory,'member-home'));writeFileSync(join(f.directory,'member-home','cookies'),'public-private-fixture');
 const parent=`current-checkout-${f.profile.runId}-${f.profile.operationId}`;mkdirSync(join(f.directory,parent));writeFileSync(join(f.directory,parent,'parent-receipt.json'),'{"failed":false}',{mode:0o600});
 const exchange=`current-checkout-exchange-${f.profile.operationId}-${f.profile.job.jobId}-${f.profile.job.jobNonce}`;
 mkdirSync(join(f.directory,exchange));writeFileSync(join(f.directory,exchange,'opening-request.g2genc'),Buffer.from('public-encrypted-fixture'),{mode:0o600});
 const files=collectCurrentBootstrapEvidence(f.directory,f.profile);assert.equal(files.length,4);assert.ok(files.some(file=>file.name===exchange+'/opening-request.g2genc'));
 assert.ok(!files.some(file=>file.name.includes('member-home')));for(const file of files)fileBytes(file).fill(0);
 }finally{f.cleanup();}
});
test('unknown files/directories, foreign operations and oversized originals reject final evidence collection',()=>{
 for(const mode of ['unknown','foreign-parent','oversized','missing-result'] as const){const f=evidenceFixture();try{
 if(mode==='unknown')writeFileSync(join(f.directory,'raw-provider-response.json'),'{}');
 if(mode==='foreign-parent')mkdirSync(join(f.directory,'current-checkout-foreign'));
 if(mode==='oversized')writeFileSync(join(f.directory,'original-input.g2genc'),Buffer.alloc(65537));
 if(mode==='missing-result')rmSync(join(f.directory,'bootstrap-result.json'));
 assert.throws(()=>collectCurrentBootstrapEvidence(f.directory,f.profile));
 }finally{f.cleanup();}}
});
test('symbolic evidence entries reject rather than following an unrelated file', {skip:process.platform!=='linux'},()=>{
 const f=evidenceFixture();try{symlinkSync(join(f.directory,'bootstrap-result.json'),join(f.directory,'original-input.g2genc'));
 assert.throws(()=>collectCurrentBootstrapEvidence(f.directory,f.profile));}finally{f.cleanup();}
});
test('final originals are encrypted, retained before upload and exact private metadata is checked',async()=>{
 const f=evidenceFixture(),key=Buffer.alloc(32,7);let uploads=0;try{
 const p=f.profile,binding={releaseId:42,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
 const result=await retainCurrentBootstrapFinal(f.directory,p,key,42,{async upload(phase,bytes){uploads++;
 assert.equal(phase,'final');assert.equal(readFileSync(join(f.directory,'final.original.g2genc')).equals(bytes),true);
 const intent=JSON.parse(readFileSync(join(f.directory,'final-upload.intent.json'),'utf8'));assert.equal(intent.maximumUploads,1);
 const value=unseal(bytes,key) as {files:{name:string}[];paymentAccepted:boolean};assert.equal(value.files.length,2);assert.equal(value.paymentAccepted,false);
 return {phase,assetId:10,name:assetName(binding,phase),size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),
 releaseId:42,jobId:p.job.jobId,jobNonce:p.job.jobNonce,headSha:p.job.headSha,operationId:p.operationId,anonymousDraft404:true,anonymousAsset404:true,
 observedAt:new Date(now).toISOString(),exactRetainedAssetVerified:true,readbackVerified:true,retryAllowed:false,paymentAccepted:false};
 }},new AbortController().signal,()=>now);
 assert.equal(result.privateFinalRetentionVerified,true);assert.equal(uploads,1);assert.equal(key.equals(Buffer.alloc(32,7)),true);
 await assert.rejects(()=>retainCurrentBootstrapFinal(f.directory,p,key,42,{async upload(){throw Error('Must not upload twice');}},new AbortController().signal,()=>now));
 }finally{key.fill(0);f.cleanup();}
});
test('uncertain or foreign final uploads preserve originals and cannot admit a second upload',async()=>{
 for(const mode of ['uncertain','foreign','changed-original'] as const){const f=evidenceFixture(),key=Buffer.alloc(32,7);let uploads=0;try{
 await assert.rejects(()=>retainCurrentBootstrapFinal(f.directory,f.profile,key,42,{async upload(phase,bytes){uploads++;
 if(mode==='uncertain')throw Error('Public ambiguous upload fixture');
 if(mode==='changed-original')writeFileSync(join(f.directory,'bootstrap-result.json'),'{"failed":true}');
 const p=f.profile,binding={releaseId:42,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
 return {phase,assetId:10,name:assetName(binding,phase),size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),
 releaseId:mode==='foreign'?43:42,jobId:p.job.jobId,jobNonce:p.job.jobNonce,headSha:p.job.headSha,operationId:p.operationId,anonymousDraft404:true,
 anonymousAsset404:true,observedAt:new Date(now).toISOString(),exactRetainedAssetVerified:true,readbackVerified:true,retryAllowed:false,paymentAccepted:false};
 }},new AbortController().signal,()=>now));assert.equal(uploads,1);
 await assert.rejects(()=>retainCurrentBootstrapFinal(f.directory,f.profile,key,42,{async upload(){uploads++;throw Error('Must not upload twice');}},new AbortController().signal,()=>now));
 assert.equal(uploads,1);assert.ok(readFileSync(join(f.directory,'final.original.g2genc')).length>36);
 }finally{key.fill(0);f.cleanup();}}
});
test('workflow remains manual, isolated and pinned; bootstrap default is genuinely inert',()=>{
 const workflow=readFileSync(fileURLToPath(new URL('../../../.github/workflows/checkout-current-staging.yml',import.meta.url)),'utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n\s+(push|schedule):/);
 assert.match(workflow,/group: givetogive-staging-community/);assert.match(workflow,/cancel-in-progress: false/);
 assert.match(workflow,/node-version: 24\.x/);assert.match(workflow,/persist-credentials: false/);
 assert.doesNotMatch(workflow,/STRIPE_|DATABASE_|SIM_CREDENTIALS|upload-artifact|cache@/);
 for(const match of workflow.matchAll(/uses: ([^\s]+)/g))assert.match(match[1]!,/@[a-f0-9]{40}$/);
 const command=fileURLToPath(new URL('../src/checkout-current-bootstrap.ts',import.meta.url));
 const result=JSON.parse(execFileSync(process.execPath,[command],{encoding:'utf8',windowsHide:true,timeout:15000}));
 assert.deepEqual(result,{execute:false,externalRequests:0,financialAdmission:false,paymentAccepted:false});
});
