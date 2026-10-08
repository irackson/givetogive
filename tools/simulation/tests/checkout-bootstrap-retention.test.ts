// Real filesystem/crypto, injected transport. No native or financial acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,readdirSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainCheckoutBootstrapFailure } from '../src/checkout-bootstrap-retention.ts';
import { unseal } from '../src/hosted-community-bundle.ts';
import { approved,assetName } from '../src/hosted-checkout-policy.ts';
import type { CheckoutBootstrapFailureDraft } from '../src/hosted-checkout-github.ts';
function fixture(mode='ok'){
 const directory=mkdtempSync(join(tmpdir(),'g2g-bootstrap-retain-')),key=Buffer.alloc(32,4),binding={headSha:'a'.repeat(40),releaseId:456,jobId:'789',jobNonce:'b'.repeat(32)};
 const lease=JSON.stringify({headSha:binding.headSha,jobNonce:binding.jobNonce,maximumMemberLaunches:1,paymentAccepted:false,retryAllowed:false});
 writeFileSync(join(directory,'bootstrap-lease.json'),lease,{flag:'wx',mode:0o600});
 let uploads=0;
 const draft={upload:async(__phase:string,bytes:Buffer)=>{
  uploads++;
  if(mode==='uncertain')throw Error('PRIVATE-ERROR-FIXTURE');
  if(mode==='original-change')writeFileSync(join(directory,'bootstrap-lease.json'),'CHANGED-OFFLINE-FIXTURE');
  return {phase:'final',assetId:123,name:assetName({releaseId:456,operationId:approved.operationId,job:{id:binding.jobId,nonce:binding.jobNonce,headSha:binding.headSha}},'final'),
   size:bytes.length,ciphertextDigest:createHash('sha256').update(bytes).digest('hex'),releaseId:456,jobId:binding.jobId,jobNonce:binding.jobNonce,
   headSha:binding.headSha,operationId:approved.operationId,observedAt:new Date().toISOString(),anonymousDraft404:true,anonymousAsset404:true,
   exactRetainedAssetVerified:true,readbackVerified:mode!=='false-readback',paymentAccepted:false,retryAllowed:false};
 }} as unknown as Pick<CheckoutBootstrapFailureDraft,'upload'>;
 return {directory,key,binding,draft,lease,uploads:()=>uploads};
}
test('original pre-parent failure files are privately encrypted once without a financial manifest',async()=>{
 const f=fixture(),result=await retainCheckoutBootstrapFailure(f.binding,f.directory,f.key,'input-validation',f.draft,new AbortController().signal);
 assert.equal(result.paymentAccepted,false);assert.equal(f.uploads(),1);
 const clear=unseal(readFileSync(join(f.directory,result.name)),f.key) as {files:Array<{name:string;bytes:string}>;parentInvoked:boolean;failed:boolean};
 assert.equal(clear.parentInvoked,false);assert.equal(clear.failed,true);
 assert.equal(Buffer.from(clear.files.find(file=>file.name==='bootstrap-lease.json')!.bytes,'base64').toString(),f.lease);
 assert.ok(clear.files.some(file=>file.name==='bootstrap-failure.json'));
 await assert.rejects(retainCheckoutBootstrapFailure(f.binding,f.directory,f.key,'input-validation',f.draft,new AbortController().signal));assert.equal(f.uploads(),1);
});
test('uncertain transfer, changed originals or unconfirmed readback keep evidence without another upload',async()=>{
 for(const mode of ['uncertain','original-change','false-readback']){
  const f=fixture(mode);await assert.rejects(retainCheckoutBootstrapFailure(f.binding,f.directory,f.key,'input-transfer',f.draft,new AbortController().signal));
  assert.equal(f.uploads(),1);assert.ok(readdirSync(f.directory).includes('bootstrap-final-upload.intent.json'));
  assert.equal(readdirSync(f.directory).includes('bootstrap-final-upload.result.json'),false);
  await assert.rejects(retainCheckoutBootstrapFailure(f.binding,f.directory,f.key,'input-transfer',f.draft,new AbortController().signal));assert.equal(f.uploads(),1);
 }
});
test('foreign files or any parent directory prevent fallback final retention',async()=>{
 for(const mode of ['foreign-file','parent-directory']){
  const f=fixture();if(mode==='foreign-file')writeFileSync(join(f.directory,'unexpected-trace.har'),'OFFLINE-FIXTURE');
  else mkdirSync(join(f.directory,`checkout-parent-${approved.operationId}-${f.binding.jobId}-${f.binding.jobNonce}`));
  await assert.rejects(retainCheckoutBootstrapFailure(f.binding,f.directory,f.key,'input-transfer',f.draft,new AbortController().signal));assert.equal(f.uploads(),0);
 }
});
