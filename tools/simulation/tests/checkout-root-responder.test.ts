// Actual exclusive filesystem/crypto; injected provider/remote adapters only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { respondCheckoutProofRequest } from '../src/checkout-root-responder.ts';
import { approved,digest,assetName,type Manifest,type Proof } from '../src/hosted-checkout-policy.ts';
import { createProofRequest,decodeProofResponse } from '../src/checkout-proof-exchange.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
const NOW=Date.parse('2026-10-08T21:30:00Z'),HEAD='a'.repeat(40);
function fixture(mode='ok'){
 const manifest:Manifest={protocol:1,purpose:'one-member-test-checkout-policy',
  job:{repository:approved.repository,actor:approved.actor,triggeringActor:approved.actor,event:'workflow_dispatch',ref:'refs/heads/main',attempt:1,
   id:'123',headSha:HEAD,nonce:'b'.repeat(32),publicRepository:true,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24},
  releaseId:456,createdAt:new Date(NOW).toISOString(),runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,
  origin:approved.origin,databaseIdentity:approved.databaseIdentity,sourceDigest:approved.sourceDigest,canonicalSourceDigest:approved.canonicalSourceDigest,
  rootLockDigest:approved.rootLockDigest,runnerDigest:approved.runnerDigest,currency:'usd',maximumAmountCents:1500,expectedTier:'sustainer',scenario:'success',
  budget:{runBudgetCents:2500,actorBudgetCents:1500,priorExpiredReservedCents:1000,candidateReservedCents:1500,originalAdmissionDigest:'1'.repeat(64),expiredHistoryDigests:['2'.repeat(64),'3'.repeat(64)],noReset:true},
  rootProof:{observedAt:new Date(NOW).toISOString(),localIsolationVerified:true,normalMemberOnly:true,noMemberTokens:true,noCheckoutSubmitAdmission:true,
   canonicalCustomerClockVerified:true,releaseVerified:true,supportsTestSubscriptionsOnly:true}};
 const opening:Proof={protocol:1,kind:'local-operator-provider-read',phase:'open',proofNonce:'c'.repeat(32),manifestDigest:digest(manifest),jobId:'123',jobNonce:'b'.repeat(32),headSha:HEAD,
  runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,verifiedAt:new Date(NOW).toISOString(),platformAccountId:approved.platformAccountId,
  databaseIdentity:approved.databaseIdentity,customerAccountId:'acct_fixtureCustomer',sessionId:'cs_test_fixtureSession',url:'https://checkout.stripe.com/c/pay/cs_test_fixtureSession',
  livemode:false,currency:'usd',amountTotal:1500,mode:'subscription',status:'open',paymentStatus:'unpaid',expiresAt:NOW/1000+3600,
  successUrl:`${approved.origin}/giving/${approved.operationId}?checkout=returned`,cancelUrl:`${approved.origin}/giving/${approved.operationId}?checkout=canceled`,
  providerIdentityVerified:true,canonicalCustomerClockVerified:true,providerInvoiceAbsent:true,providerSubscriptionAbsent:true};
 const key=Buffer.alloc(32,4),request=createProofRequest(manifest,opening,key,NOW),calls:string[]=[];
 let now=NOW,closed=0;
 const root=mkdtempSync(join(tmpdir(),'g2g-root-proof-'));
 const options={root,key,signal:new AbortController().signal,now:()=>now,
  verifyCurrent:async()=>{calls.push('verify');if(mode==='wrong-bindings')throw Error('PRIVATE-OPERATOR-FIXTURE');},
  reader:{read:async()=>{calls.push('provider');if(mode==='provider-failure')throw Error('PRIVATE-PROVIDER-FIXTURE');
   return {...opening,phase:'pre-submit' as const,proofNonce:'d'.repeat(32),verifiedAt:new Date(now).toISOString()};},close:()=>{closed++;}},
  draft:{download:async()=>{calls.push('download');return Buffer.from(request.ciphertext);},upload:async(__phase:string,bytes:Buffer):Promise<RetainedCheckoutAsset>=>{
   calls.push('upload');if(mode==='uncertain-upload')throw Error('PRIVATE-TRANSFER-FIXTURE');if(mode==='stale-upload')now+=30001;
   if(mode==='ciphertext-change')bytes[40]^=1;
   return {phase:'submit-proof',assetId:789,name:assetName(manifest,'submit-proof'),size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),
    releaseId:456,jobId:'123',jobNonce:manifest.job.nonce,headSha:HEAD,operationId:approved.operationId,anonymousDraft404:true,anonymousAsset404:true,
    observedAt:new Date(now).toISOString(),exactRetainedAssetVerified:true,readbackVerified:(mode!=='false-readback') as true,paymentAccepted:false,retryAllowed:false};
  }}};
 return {manifest,opening,options,root,calls,request,closed:()=>closed,now:()=>now};
}
test('root retains original request/provider/response and one upload only after current binding checks',async()=>{
 const f=fixture(),result=await respondCheckoutProofRequest(f.manifest,HEAD,f.opening,f.options);
 assert.equal(result.paymentAccepted,false);assert.equal(result.privateResponseRetained,true);
 assert.deepEqual(f.calls,['verify','download','verify','provider','verify','upload']);assert.equal(f.closed(),1);
 const directory=join(f.root,readdirSync(f.root)[0]!);
 assert.ok(readdirSync(directory).includes('provider-read.intent.json'));assert.ok(readdirSync(directory).includes('response-upload.result.json'));
 const proof=decodeProofResponse(readFileSync(join(directory,assetName(f.manifest,'submit-proof'))),f.options.key,f.request.request,f.manifest,f.opening,f.now());
 assert.equal(proof.phase,'pre-submit');
 await assert.rejects(respondCheckoutProofRequest(f.manifest,HEAD,f.opening,f.options));assert.equal(f.calls.filter(call=>call==='upload').length,1);
});
test('binding/provider failures stop before upload; uncertain, changed, stale or false-readback responses never retry',async()=>{
 for(const mode of ['wrong-bindings','provider-failure','uncertain-upload','ciphertext-change','stale-upload','false-readback']){
  const f=fixture(mode);await assert.rejects(respondCheckoutProofRequest(f.manifest,HEAD,f.opening,f.options),/Local Checkout proof response unconfirmed/);
  assert.equal(f.calls.filter(call=>call==='upload').length,['wrong-bindings','provider-failure'].includes(mode)?0:1);
  const before=[...f.calls];await assert.rejects(respondCheckoutProofRequest(f.manifest,HEAD,f.opening,f.options));assert.deepEqual(f.calls,before);
  const directory=join(f.root,readdirSync(f.root)[0]!);assert.equal(readdirSync(directory).includes('response-upload.result.json'),false);
 }
});
