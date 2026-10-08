// Real temporary filesystem; synthetic crypto/transport only. No network/env/payments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CheckoutDurableParent } from '../src/checkout-durable-parent.ts';
import { approved, digest, assetName, type Manifest } from '../src/hosted-checkout-policy.ts';
import { unseal } from '../src/hosted-community-bundle.ts';
import type { RetainedCheckoutAsset } from '../src/hosted-checkout-github.ts';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attachCheckoutBrokerParent,type CheckoutIpcPeer} from '../src/checkout-broker-ipc.ts';
const NOW=Date.parse('2026-10-08T19:00:00Z'),HEAD='b'.repeat(40),key=Buffer.alloc(32,7);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function manifest():Manifest{return{protocol:1,purpose:'one-member-test-checkout-policy',
 job:{repository:approved.repository,actor:approved.actor,triggeringActor:approved.actor,event:'workflow_dispatch',ref:'refs/heads/main',
  attempt:1,id:'123456789',headSha:HEAD,nonce:'c'.repeat(32),publicRepository:true,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24},
 releaseId:123,createdAt:new Date(NOW).toISOString(),runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,
 origin:approved.origin,databaseIdentity:approved.databaseIdentity,sourceDigest:approved.sourceDigest,canonicalSourceDigest:approved.canonicalSourceDigest,
 rootLockDigest:approved.rootLockDigest,runnerDigest:approved.runnerDigest,currency:'usd',maximumAmountCents:1500,expectedTier:'sustainer',scenario:'success',
 budget:{runBudgetCents:2500,actorBudgetCents:1500,priorExpiredReservedCents:1000,candidateReservedCents:1500,
  originalAdmissionDigest:'1'.repeat(64),expiredHistoryDigests:['2'.repeat(64),'3'.repeat(64)],noReset:true},
 rootProof:{observedAt:new Date(NOW).toISOString(),localIsolationVerified:true,normalMemberOnly:true,noMemberTokens:true,
  noCheckoutSubmitAdmission:true,canonicalCustomerClockVerified:true,releaseVerified:true,supportsTestSubscriptionsOnly:true}};}
function intent(m:Manifest,phase:'ack-intent'|'submit-intent'='submit-intent'){return{protocol:1,phase,manifestDigest:digest(m),
 operationId:m.operationId,actorId:m.actorId,jobId:m.job.id,jobNonce:m.job.nonce,maximumAmountCents:1500,maximumActions:1,
 ...(phase==='submit-intent'?{proofDigest:'a'.repeat(64)}:{}),paymentAccepted:false,retryAllowed:false};}
function fixture(change:(r:RetainedCheckoutAsset)=>void=()=>{},throwUpload=false,onUpload?:(bytes:Buffer,root:string,signal:AbortController)=>void){
 const root=mkdtempSync(join(tmpdir(),'g2g-checkout-durable-')),m=manifest(),i=intent(m),signal=new AbortController();
 let calls=0,uploaded:Buffer|undefined;
 const upload=async(phase:'submit-intent',bytes:Buffer)=>{calls++;uploaded=Buffer.from(bytes);if(throwUpload)throw Error('offline failure');
  const retained:RetainedCheckoutAsset={phase,assetId:99,name:assetName(m,phase),size:bytes.length,ciphertextDigest:hash(bytes),
   releaseId:m.releaseId,jobId:m.job.id,jobNonce:m.job.nonce,headSha:HEAD,operationId:m.operationId,
   anonymousDraft404:true,anonymousAsset404:true,observedAt:new Date(NOW).toISOString(),exactRetainedAssetVerified:true,
   readbackVerified:true,retryAllowed:false,paymentAccepted:false};change(retained);onUpload?.(bytes,root,signal);return retained;};
 const parent=new CheckoutDurableParent(root,m,HEAD,key,upload,()=>NOW);
 return{root,m,i,signal,parent,upload,calls:()=>calls,uploaded:()=>uploaded,directory:()=>join(root,readdirSync(root)[0]!)};
}
test('constructor/import are inert; no directory exists until explicit intent admission',()=>{
 const f=fixture();assert.deepEqual(readdirSync(f.root),[]);assert.equal(f.calls(),0);f.parent.close();
});
test('actual exclusive fsync/readback then encrypted original and preintent precede one injected retention',async()=>{
 const f=fixture(),durable=await f.parent.writeIntent(f.i,f.signal.signal);
 assert.deepEqual(durable,{name:assetName(f.m,'submit-intent')+'.intent.json',digest:digest(f.i),exclusive:true,fsynced:true});
 assert.equal(readFileSync(join(f.directory(),durable.name),'utf8'),JSON.stringify(f.i));
 const retained=await f.parent.retainSubmitIntent(f.i,durable,f.signal.signal);assert.equal(f.calls(),1);
 const opened=unseal(f.uploaded()!,key) as {intent:unknown};assert.deepEqual(opened.intent,f.i);
 assert.equal(retained.acknowledgment.originalIntentDigest,digest(f.i));assert.equal(retained.ciphertextDigest,hash(f.uploaded()!));
 assert.ok(readdirSync(f.directory()).includes('submit-upload.intent.json'));assert.ok(readdirSync(f.directory()).includes('submit-upload.result.json'));
 assert.equal(f.uploaded()!.includes(Buffer.from(JSON.stringify(f.i))),false);
 await assert.rejects(f.parent.writeIntent(f.i,f.signal.signal));await assert.rejects(f.parent.retainSubmitIntent(f.i,durable,f.signal.signal));
 assert.equal(f.calls(),1);f.parent.close();
});
test('another parent/restarted instance cannot reuse the durable namespace or overwrite original',async()=>{
 const f=fixture(),d=await f.parent.writeIntent(f.i,f.signal.signal),original=readFileSync(join(f.directory(),d.name));
 const restarted=new CheckoutDurableParent(f.root,f.m,HEAD,key,f.upload,()=>NOW);
 await assert.rejects(restarted.writeIntent(f.i,f.signal.signal));assert.ok(readFileSync(join(f.directory(),d.name)).equals(original));
 assert.equal(f.calls(),0);f.parent.close();restarted.close();
});
test('changed disk intent or caller digest never encrypts/uploads a replacement',async()=>{
 for(const disk of [false,true]){const f=fixture(),d=await f.parent.writeIntent(f.i,f.signal.signal);
  if(disk)writeFileSync(join(f.directory(),d.name),'{}');
  await assert.rejects(f.parent.retainSubmitIntent(f.i,disk?d:{...d,digest:'0'.repeat(64)},f.signal.signal));
  assert.equal(f.calls(),0);await assert.rejects(f.parent.retainSubmitIntent(f.i,d,f.signal.signal));f.parent.close();}
});
test('foreign intent, excess fields, ack proof and unflushed caller admission reject',async()=>{
 for(const patch of [{actorId:'foreign'},{maximumActions:2},{manifestDigest:'0'.repeat(64)},{retryAllowed:true},{extra:'unknown'}]){
  const f=fixture();await assert.rejects(f.parent.writeIntent({...f.i,...patch},f.signal.signal));assert.equal(f.calls(),0);f.parent.close();}
 const f=fixture();await assert.rejects(f.parent.writeIntent({...intent(f.m,'ack-intent'),proofDigest:'a'.repeat(64)},f.signal.signal));f.parent.close();
});
test('uncertain upload or bad/stale receipt retains originals and cannot send twice',async()=>{
 for(const mode of ['throw','digest','stale','privacy','readback']){
  const f=fixture(r=>{if(mode==='digest')r.ciphertextDigest='0'.repeat(64);if(mode==='stale')r.observedAt=new Date(NOW-30001).toISOString();
   if(mode==='privacy')r.anonymousAsset404=false as true;if(mode==='readback')r.readbackVerified=false as true;},mode==='throw');
  const d=await f.parent.writeIntent(f.i,f.signal.signal);await assert.rejects(f.parent.retainSubmitIntent(f.i,d,f.signal.signal));
  await assert.rejects(f.parent.retainSubmitIntent(f.i,d,f.signal.signal));assert.equal(f.calls(),1);
  assert.ok(readdirSync(f.directory()).includes('submit-upload.intent.json'));assert.ok(!readdirSync(f.directory()).includes('submit-upload.result.json'));f.parent.close();}
});
test('pre-abort has zero disk/network admission; closed key prevents later work',async()=>{
 const f=fixture();f.signal.abort();await assert.rejects(f.parent.writeIntent(f.i,f.signal.signal));assert.deepEqual(readdirSync(f.root),[]);
 f.parent.close();const g=fixture();g.parent.close();await assert.rejects(g.parent.writeIntent(g.i,g.signal.signal));assert.equal(g.calls(),0);
});
test('linked namespace/root ancestry cannot redirect original writes',async()=>{
 const f=fixture(),outside=mkdtempSync(join(tmpdir(),'g2g-checkout-outside-')),link=join(f.root,'redirect');
 symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
 const redirected=new CheckoutDurableParent(link,f.m,HEAD,key,f.upload,()=>NOW);
 await assert.rejects(redirected.writeIntent(f.i,f.signal.signal));assert.deepEqual(readdirSync(outside),[]);redirected.close();f.parent.close();
});
test('late abort or mutation of admitted disk/ciphertext during transport cannot produce an acknowledgment',async()=>{
 for(const kind of ['abort','disk','ciphertext']){
  const f=fixture(()=>{},false,(bytes,root,signal)=>{
   if(kind==='abort')signal.abort();
   if(kind==='ciphertext')bytes[bytes.length-1]^=1;
   if(kind==='disk')writeFileSync(join(root,readdirSync(root)[0]!,assetName(manifest(),'submit-intent')+'.intent.json'),'{}');
  });
  const d=await f.parent.writeIntent(f.i,f.signal.signal);await assert.rejects(f.parent.retainSubmitIntent(f.i,d,f.signal.signal));
  assert.equal(f.calls(),1);assert.ok(!readdirSync(f.directory()).includes('submit-upload.result.json'));
  await assert.rejects(f.parent.retainSubmitIntent(f.i,d,new AbortController().signal));assert.equal(f.calls(),1);f.parent.close();
 }
 assert.equal(key.equals(Buffer.alloc(32,7)),true);
});

test('real child IPC connects to actual parent fsync/encryption and one injected private retention',async()=>{
 const f=fixture(),proof={environment:'staging',livemode:false};
 const binding={manifestDigest:digest(f.m),connectionNonce:'d'.repeat(32)};
 const child=fork(fileURLToPath(new URL('./checkout-broker-ipc-fixture.mjs',import.meta.url)),[JSON.stringify({binding,intent:f.i})],{
  execArgv:['--experimental-strip-types'],env:{PATH:process.env.PATH!,SystemRoot:process.env.SystemRoot!,PROGRAMDATA:process.env.PROGRAMDATA!},
  stdio:['ignore','ignore','ignore','ipc']});
 const server=attachCheckoutBrokerParent(child as unknown as CheckoutIpcPeer,binding,{
  preSubmitProof:async()=>proof,
  writeIntent:(value,signal)=>f.parent.writeIntent(value,signal),
  retainSubmitIntent:(value,durable,signal)=>f.parent.retainSubmitIntent(value,durable,signal)});
 let complete=false,environmentAbsent=false;
 child.on('message',(raw:unknown)=>{const result=raw as {fixtureComplete?:boolean;credentialEnvironmentAbsent?:boolean};
  if(result.fixtureComplete){complete=true;environmentAbsent=result.credentialEnvironmentAbsent===true;}});
 try{
  const code=await new Promise<number|null>((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Offline durability child timed out.'));},10000);
   child.once('exit',value=>{clearTimeout(timer);resolve(value);});child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  assert.equal(code,0);assert.equal(complete,true);assert.equal(environmentAbsent,true);assert.equal(f.calls(),1);
  const opened=unseal(f.uploaded()!,key) as {intent:unknown};assert.deepEqual(opened.intent,{...f.i,proofDigest:digest(proof)});
  assert.ok(readdirSync(f.directory()).includes('submit-upload.result.json'));
 }finally{server.close();f.parent.close();if(child.exitCode===null)child.kill();}
});
