import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkoutTransferChallenge,checkoutTransferChallengeMatches,validateCheckoutDiagnosticContext,inspectCheckoutDiagnosticMetadata } from '../src/checkout-transport-diagnostic.ts';
test('domain-separated diagnostic key proof binds the exact head and fresh challenge without returning the key',()=>{
 const key=Buffer.alloc(32,7),head='a'.repeat(40),nonce='b'.repeat(32);
 const proof=checkoutTransferChallenge(key,head,nonce);
 assert.equal(checkoutTransferChallengeMatches(key,head,nonce,proof),true);
 assert.equal(checkoutTransferChallengeMatches(Buffer.alloc(32,8),head,nonce,proof),false);
 assert.equal(checkoutTransferChallengeMatches(key,'c'.repeat(40),nonce,proof),false);
 assert.equal(checkoutTransferChallengeMatches(key,head,'d'.repeat(32),proof),false);
 assert.throws(()=>checkoutTransferChallengeMatches(key,head,nonce,'bad'));
});
test('diagnostic is exact manual Linux main execution and rejects provider or member configuration',()=>{
 const env={GITHUB_REPOSITORY:'irackson/givetogive',GITHUB_ACTOR:'irackson',GITHUB_TRIGGERING_ACTOR:'irackson',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'checkout-diagnostic',
  GITHUB_SHA:'a'.repeat(40),CHECKOUT_EXPECTED_SHA:'a'.repeat(40),CHECKOUT_DIAGNOSTIC_NONCE:'b'.repeat(32),
  CHECKOUT_DIAGNOSTIC_PROOF:'c'.repeat(64),CHECKOUT_BUNDLE_KEY:'d'.repeat(64),CHECKOUT_GITHUB_TOKEN:'PUBLIC-OFFLINE-NOT-A-TOKEN'};
 assert.equal(validateCheckoutDiagnosticContext(env,'linux',24).head,env.GITHUB_SHA);
 for(const change of [{GITHUB_ACTOR:'foreign'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},
  {CHECKOUT_EXPECTED_SHA:'f'.repeat(40)},{STRIPE_SECRET_KEY:'FIXTURE'},{DATABASE_URL:'FIXTURE'},{SIM_CREDENTIALS:'FIXTURE'}])
  assert.throws(()=>validateCheckoutDiagnosticContext({...env,...change},'linux',24));
 assert.throws(()=>validateCheckoutDiagnosticContext(env,'win32',24));
});
test('diagnostic reads only pinned original JSON metadata, never ciphertext or credentials',async()=>{
 const asset={id:623141370,name:'checkout-284c4f9d-6aec-4910-bbb2-ef7b1a9d2ff7-113565326479-1-ffebd4a021eb1f1918471d7e9fe4c5eb-input.g2genc',
  size:1964,digest:'sha256:6ae137db7015ff3738c4db236d863ccc9286e8b44012b889f7ba83e4f897dc6d',state:'uploaded'};
 let reads=0;
 const request:typeof fetch=async(url,options)=>{
  reads++;assert.equal(options?.method,'GET');assert.equal(options?.redirect,'error');
  assert.equal(new Headers(options?.headers).get('Accept'),'application/vnd.github+json');assert.equal(options?.body,undefined);
  const path=new URL(String(url)).pathname;assert.ok(['/repos/irackson/givetogive/releases/407301835','/repos/irackson/givetogive/releases/assets/623141370'].includes(path));
  if(!new Headers(options?.headers).has('Authorization'))return new Response(null,{status:404});
  return Response.json(path.endsWith('/623141370')?asset:{id:407301835,target_commitish:'b976c74e2899d4c5ed49f3afb84848b959930041',draft:true,published_at:null,assets:[asset]});
 };
 const result=await inspectCheckoutDiagnosticMetadata('PUBLIC-OFFLINE-NOT-A-TOKEN',new AbortController().signal,request);
 assert.equal(reads,6);assert.equal(result.ciphertextDownloaded,false);assert.equal(result.paymentAccepted,false);
 await assert.rejects(inspectCheckoutDiagnosticMetadata('PUBLIC-OFFLINE-NOT-A-TOKEN',new AbortController().signal,async()=>new Response(null,{status:403})));
});
test('diagnostic workflow is manual, no credential install/cache/artifacts and shares controller concurrency',()=>{
 const source=readFileSync(new URL('../../../.github/workflows/checkout-diagnostic.yml',import.meta.url),'utf8');
 assert.match(source,/workflow_dispatch:/);assert.doesNotMatch(source,/\n\s+(push|pull_request|schedule):/);
 assert.match(source,/group: givetogive-staging-community/);assert.match(source,/cancel-in-progress: false/);
 assert.match(source,/persist-credentials: false/);assert.doesNotMatch(source,/STRIPE_|DATABASE_|upload-artifact|save-cache/);
 assert.ok(source.indexOf('npm ci --ignore-scripts')<source.indexOf('CHECKOUT_BUNDLE_KEY:'));
});
