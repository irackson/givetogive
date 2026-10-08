// Policy/transport fixtures only; no hosted execution, authentication or payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,readdirSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutBootstrapConfiguration } from '../src/checkout-bootstrap.ts';
import { downloadBootstrapInput,initialCheckoutAssetName,checkoutResponseBytes } from '../src/checkout-input-mailbox.ts';
import { approved } from '../src/hosted-checkout-policy.ts';
import { seal } from '../src/hosted-community-bundle.ts';
const HEAD='a'.repeat(40);
test('native bootstrap configuration requires exact manual identity and excludes unrelated credentials',()=>{
 const env={GITHUB_REPOSITORY:approved.repository,GITHUB_REPOSITORY_OWNER:approved.actor,GITHUB_ACTOR:approved.actor,
  GITHUB_TRIGGERING_ACTOR:approved.actor,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',
  GITHUB_JOB:'checkout-parent',GITHUB_SHA:HEAD,CHECKOUT_EXPECTED_SHA:HEAD,GITHUB_RUN_ID:'123',CHECKOUT_RELEASE_ID:'456',
  CHECKOUT_BUNDLE_KEY:'b'.repeat(64),CHECKOUT_GITHUB_TOKEN:'PUBLIC-OFFLINE-NOT-A-CREDENTIAL',PATH:'/usr/bin'};
 assert.equal(checkoutBootstrapConfiguration(env,'linux',24).runId,'123');
 for(const override of [{GITHUB_ACTOR:'someone-else'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},
  {STRIPE_SECRET_KEY:'PUBLIC-FIXTURE'},{DATABASE_URL:'PUBLIC-FIXTURE'},{COMMUNITY_RECOVERY_TOKEN:'PUBLIC-FIXTURE'},
  {GITHUB_JOB:'staging-community'},{CHECKOUT_BUNDLE_KEY:'bad'}])assert.throws(()=>checkoutBootstrapConfiguration({...env,...override},'linux',24));
 assert.throws(()=>checkoutBootstrapConfiguration(env,'win32',24));assert.throws(()=>checkoutBootstrapConfiguration(env,'linux',22));
});
function fixture(mode='ok') {
 const binding={headSha:HEAD,releaseId:456,jobId:'789',jobNonce:'c'.repeat(32)},name=initialCheckoutAssetName(binding);
 const ciphertext=seal({offlineFixture:true},Buffer.alloc(32,7));
 const asset={id:1,name,size:ciphertext.length,digest:`sha256:${createHash('sha256').update(ciphertext).digest('hex')}`,state:'uploaded'};
 const release={id:456,draft:true,prerelease:false,published_at:null,target_commitish:HEAD,
  tag_name:`checkout-acceptance-${approved.operationId}`,body:JSON.stringify({protocol:1,purpose:'one-member-test-checkout-policy',
   repository:approved.repository,runId:approved.runId,operationId:approved.operationId,headSha:HEAD}),assets:[asset]};
 const directory=mkdtempSync(join(tmpdir(),'g2g-input-test-'));let downloads=0,inspections=0,pauses=0;
 const request:typeof fetch=async(url,options)=>{
  const parsed=new URL(String(url));
  if(parsed.hostname==='release-assets.githubusercontent.com') {
   assert.equal(options?.headers,undefined);downloads++;return new Response(ciphertext);
  }
  const authorized=Boolean(new Headers(options?.headers).get('Authorization'));
  if(!authorized)return new Response(null,{status:mode==='public'?200:404});
  if(parsed.pathname.endsWith('/releases/456')) {
   inspections++;let selected=release.assets;
   if(mode==='poll'&&pauses===0)selected=[];
   if(mode==='wrong-name')selected=[{...asset,name:'foreign-input.g2genc'}];
   if(mode==='changed-after'&&downloads>0)selected=[{...asset,id:2}];
   return Response.json({...release,target_commitish:mode==='wrong-head'?'f'.repeat(40):HEAD,assets:selected});
  }
  assert.ok(parsed.pathname.endsWith('/releases/assets/1'));
  if(mode==='cdn')return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/offlinefixture'}});
  if(mode==='foreign-cdn')return new Response(null,{status:302,headers:{location:'https://example.invalid/fixture'}});
  downloads++;if(mode==='uncertain')throw Error('PRIVATE-FIXTURE-TRANSFER-ERROR');
  if(mode==='hash')return new Response(Buffer.alloc(ciphertext.length,0));
  return new Response(ciphertext);
 };
 const options={token:'PUBLIC-OFFLINE-NOT-A-CREDENTIAL',signal:new AbortController().signal,request,
  persistSelection:(value:unknown)=>writeFileSync(join(directory,'selection.intent.json'),JSON.stringify(value),{flag:'wx',mode:0o600}),
  pause:async()=>{pauses++;assert.ok(pauses<=1);}};
 return {binding,options,ciphertext,directory,downloads:()=>downloads,inspections:()=>inspections};
}
test('exact initial input polls only absence, consumes one durable selection and strips auth on CDN redirects',async()=>{
 for(const mode of ['ok','poll','cdn']) {
  const f=fixture(mode),result=await downloadBootstrapInput(f.binding,f.options);
  assert.equal(result.transportEvidence,'injected-offline-http');assert.equal(result.paymentAccepted,false);
  assert.ok(result.ciphertext.equals(f.ciphertext));assert.equal(f.downloads(),1);
  await assert.rejects(downloadBootstrapInput(f.binding,f.options));assert.equal(f.downloads(),1);
  assert.deepEqual(readdirSync(f.directory),['selection.intent.json']);result.ciphertext.fill(0);
 }
});
test('public draft or wrong head/name cannot select or download any input',async()=>{
 for(const mode of ['public','wrong-head','wrong-name']) {
  const f=fixture(mode);await assert.rejects(downloadBootstrapInput(f.binding,f.options));
  assert.equal(f.downloads(),0);assert.deepEqual(readdirSync(f.directory),[]);
 }
});
test('uncertain download, changed inventory, wrong hash and foreign CDN never retry a selected transfer',async()=>{
 for(const mode of ['uncertain','changed-after','hash','foreign-cdn']) {
  const f=fixture(mode);await assert.rejects(downloadBootstrapInput(f.binding,f.options),/Checkout input transfer unconfirmed/);
  assert.deepEqual(readdirSync(f.directory),['selection.intent.json']);const before=f.downloads();
  await assert.rejects(downloadBootstrapInput(f.binding,f.options));assert.equal(f.downloads(),before);
 }
});
test('bounded input streams enforce byte count and cancellation',async()=>{
 await assert.rejects(checkoutResponseBytes(new Response(Buffer.alloc(10)),9,new AbortController().signal));
 await assert.rejects(checkoutResponseBytes(new Response(Buffer.alloc(10)),11,new AbortController().signal,11));
 const controller=new AbortController();let canceled=false;
 const response=new Response(new ReadableStream({cancel(){canceled=true;}}));
 setTimeout(()=>controller.abort(),10);await assert.rejects(checkoutResponseBytes(response,100,controller.signal));assert.equal(canceled,true);
});
test('dedicated workflow is manual, pinned, shared-concurrency and credential-isolated',()=>{
 const source=readFileSync(new URL('../../../.github/workflows/checkout-staging.yml',import.meta.url),'utf8');
 assert.match(source,/workflow_dispatch:/);assert.doesNotMatch(source,/\n\s+(push|pull_request|schedule):/);
 assert.match(source,/group: givetogive-staging-community/);assert.match(source,/cancel-in-progress: false/);
 assert.match(source,/github\.run_attempt == 1/);assert.match(source,/inputs\.expected_sha == github\.sha/);
 assert.match(source,/persist-credentials: false/);assert.match(source,/actions: read/);assert.match(source,/checks: write/);
 assert.equal([...source.matchAll(/uses: actions\/[a-z-]+@([a-f0-9]{40})/g)].length,2);
 assert.doesNotMatch(source,/STRIPE_|DATABASE_|upload-artifact|save-cache/);
 assert.ok(source.indexOf('npm ci --ignore-scripts')<source.indexOf('CHECKOUT_BUNDLE_KEY:'));
 assert.ok(source.indexOf('playwright install --with-deps chromium')<source.indexOf('CHECKOUT_BUNDLE_KEY:'));
});
