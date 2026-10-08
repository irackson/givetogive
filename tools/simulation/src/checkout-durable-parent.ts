/** Parent-only durable adapter. No automatic execution or financial acceptance.
 * Import/constructor are inert. No env/provider/worker execution. Upload is explicit.
 * Local fsync/readback is real; remote retention still requires the reviewed transport.
 * Never grants paid acceptance or makes an uncertain operation retryable. */
import { existsSync, lstatSync, realpathSync, mkdirSync, openSync, writeFileSync,
 fsyncSync, closeSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { approved, digest, assetName, validateManifest, type Manifest } from './hosted-checkout-policy.ts';
import { encryptCheckpoint } from './hosted-checkout-protocol.ts';
import { unseal } from './hosted-community-bundle.ts';
import type { RetainedCheckoutAsset } from './hosted-checkout-github.ts';
import {createProofRequest,decodeProofResponse} from './checkout-proof-exchange.ts';
import type {Proof} from './hosted-checkout-policy.ts';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=():never=>{throw Error('Checkout durable parent rejected; original intent retained; no automatic retry.');};
const guard=(value:unknown)=>{if(!value)fail();};
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema=z.object({protocol:z.literal(1),phase:z.enum(['ack-intent','submit-intent']),
 manifestDigest:sha,operationId:z.literal(approved.operationId),actorId:z.literal(approved.actorId),
 jobId:z.string().regex(/^[1-9][0-9]{0,19}$/),jobNonce:z.string().regex(/^[a-f0-9]{32}$/),
 maximumAmountCents:z.literal(1500),maximumActions:z.literal(1),proofDigest:sha.optional(),
 paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
type Intent=z.infer<typeof intentSchema>;
type Upload=(phase:'submit-intent',bytes:Buffer,signal:AbortSignal)=>Promise<RetainedCheckoutAsset>;
export class CheckoutDurableParent {
 readonly manifest:Manifest;
 private directory:string;
 private initialized=false;
 private phases=new Set<string>();
 private retentionConsumed=false;
 private proofRequestConsumed=false;
 private key:Buffer;
 private upload:Upload;
 private now:()=>number;
 constructor(root:string,raw:unknown,head:string,key:Buffer,upload:Upload,now=Date.now){
  this.upload=upload;this.now=now;
  this.manifest=validateManifest(raw,head,now());
  const freeze=(value:object)=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);Object.freeze(value);};
  freeze(this.manifest);
  guard(typeof root==='string'&&root.length>0&&Buffer.isBuffer(key)&&key.length===32);
  this.directory=join(resolve(root),`checkout-${this.manifest.operationId}-${this.manifest.job.id}-${this.manifest.job.nonce}`);
  this.key=Buffer.from(key);
 }
 private active(signal:AbortSignal){guard(!signal.aborted&&this.key.length===32);}
 private contained(){
  let cursor=this.directory;
  for(;;){if(existsSync(cursor))guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);
   const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
 }
 private flushDirectory(){
  // Linux hosted durability includes the namespace entry. Windows rehearsal only
  // verifies file flush/readback and is not Linux crash-durability evidence.
  if(process.platform!=='linux')return;
  const fd=openSync(this.directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 }
 private original(name:string,bytes:Buffer){
  guard(/^[a-zA-Z0-9._-]+$/.test(name));this.contained();
  const path=join(this.directory,name),fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  this.flushDirectory();this.contained();
  const read=readFileSync(path);try{guard(read.equals(bytes));}finally{read.fill(0);}
  return path;
 }
 private unchanged(name:string,expected:Buffer){
  this.contained();const path=join(this.directory,name);guard(lstatSync(path).isFile()&&lstatSync(path).size===expected.length);
  const bytes=readFileSync(path);try{guard(bytes.equals(expected));}finally{bytes.fill(0);}
 }
 private initialize(signal:AbortSignal){
  this.active(signal);if(this.initialized){this.contained();return;}
  this.contained();guard(lstatSync(dirname(this.directory)).isDirectory());
  // Exclusive persistent lease, never recursively reuse/repair another process's namespace.
  mkdirSync(this.directory,{mode:0o700});this.initialized=true;
  const bytes=Buffer.from(JSON.stringify({manifestDigest:digest(this.manifest),headSha:this.manifest.job.headSha,retryAllowed:false}));
  try{this.original('lease.json',bytes);}finally{bytes.fill(0);}
  if(process.platform==='linux'){const fd=openSync(dirname(this.directory),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 }
 private validate(raw:unknown):Intent{
  const result=intentSchema.safeParse(raw);guard(result.success);if(!result.success)return fail();
  const i=result.data,m=this.manifest;
  guard(i.manifestDigest===digest(m)&&i.jobId===m.job.id&&i.jobNonce===m.job.nonce
   &&(i.phase==='submit-intent'?!!i.proofDigest:i.proofDigest===undefined));return i;
 }
 async writeIntent(raw:Readonly<Record<string,unknown>>,signal:AbortSignal){
  try{this.active(signal);const intent=this.validate(raw);guard(!this.phases.has(intent.phase));
   this.phases.add(intent.phase);this.initialize(signal);
   const name=`${assetName(this.manifest,intent.phase)}.intent.json`,bytes=Buffer.from(JSON.stringify(intent));
   try{this.original(name,bytes);this.active(signal);return{name,digest:digest(intent),exclusive:true as const,fsynced:true as const};}
   finally{bytes.fill(0);}
  }catch{this.close();return fail();}
 }
 async retainSubmitIntent(raw:Readonly<Record<string,unknown>>,durable:unknown,signal:AbortSignal){
  let original:Buffer|undefined,encrypted:Buffer|undefined;
  try{this.active(signal);const intent=this.validate(raw),name=`${assetName(this.manifest,'submit-intent')}.intent.json`;
   guard(intent.phase==='submit-intent'&&this.phases.has('submit-intent')&&!this.retentionConsumed);
   this.retentionConsumed=true;this.contained();
   guard(isDeepStrictEqual(durable,{name,digest:digest(intent),exclusive:true,fsynced:true}));
   const path=join(this.directory,name);guard(lstatSync(path).isFile()&&lstatSync(path).size<=4096);
   original=readFileSync(path);guard(original.equals(Buffer.from(JSON.stringify(intent))));
   encrypted=encryptCheckpoint(this.manifest,intent,this.key);
   const opened=unseal(encrypted,this.key) as {intent?:unknown};guard(isDeepStrictEqual(opened.intent,JSON.parse(original.toString())));
   const ciphertextDigest=hash(encrypted),asset=assetName(this.manifest,'submit-intent');
   this.original(asset,encrypted);
   const preintent=Buffer.from(JSON.stringify({manifestDigest:digest(this.manifest),originalIntentDigest:hash(original),
    ciphertextDigest,bytes:encrypted.length,name:asset,maximumUploads:1,retryAllowed:false}));
   try{this.original('submit-upload.intent.json',preintent);}finally{preintent.fill(0);}
   this.active(signal);const retained=await this.upload('submit-intent',encrypted,signal);this.active(signal);
   guard(hash(encrypted)===ciphertextDigest);
   this.contained();guard(lstatSync(path).isFile());
   const after=readFileSync(path);try{guard(after.equals(original));}finally{after.fill(0);}
   guard(retained.phase==='submit-intent'&&retained.name===asset&&retained.ciphertextDigest===ciphertextDigest
    &&retained.size===encrypted.length&&retained.releaseId===this.manifest.releaseId&&retained.jobId===this.manifest.job.id
    &&retained.jobNonce===this.manifest.job.nonce&&retained.headSha===this.manifest.job.headSha
    &&retained.operationId===this.manifest.operationId&&retained.anonymousDraft404===true&&retained.anonymousAsset404===true
    &&retained.exactRetainedAssetVerified===true&&retained.readbackVerified===true&&retained.retryAllowed===false
    &&Number.isSafeInteger(retained.assetId)&&retained.assetId>0
    &&Number.isFinite(Date.parse(retained.observedAt))&&this.now()-Date.parse(retained.observedAt)>=-5000
    &&this.now()-Date.parse(retained.observedAt)<=30000);
   const result=Buffer.from(JSON.stringify(retained));try{this.original('submit-upload.result.json',result);}finally{result.fill(0);}
   this.active(signal);
   return{ciphertextDigest,acknowledgment:{name:asset,assetId:retained.assetId,size:retained.size,ciphertextDigest,
    originalIntentDigest:digest(intent),releaseId:retained.releaseId,jobId:retained.jobId,jobNonce:retained.jobNonce,
    headSha:retained.headSha,operationId:retained.operationId,observedAt:retained.observedAt,
    draftStillPrivate:true,anonymousDraft404:true,anonymousAsset404:true,exclusiveUpload:true,
    exactRetainedAssetVerified:true,encryptedOriginalBytes:true}};
  }catch{this.close();return fail();}finally{original?.fill(0);encrypted?.fill(0);}
 }
 /** Runtime transport must be the reviewed private draft adapter. No provider
  * credentials enter this parent or the member through this exchange. */
 async requestPreSubmitProof(opening:Proof,transport:{
  upload(phase:'open-proof',bytes:Buffer,signal:AbortSignal):Promise<RetainedCheckoutAsset>;
  download(phase:'submit-proof',signal:AbortSignal):Promise<Buffer>;
 },signal:AbortSignal):Promise<Proof>{
  let ciphertext:Buffer|undefined,response:Buffer|undefined;
  try{
   this.active(signal);guard(!this.proofRequestConsumed&&!this.phases.has('submit-intent')&&!this.retentionConsumed);
   this.proofRequestConsumed=true;this.initialize(signal);
   const original=createProofRequest(this.manifest,opening,this.key,this.now());ciphertext=original.ciphertext;
   const bytes=Buffer.from(JSON.stringify(original.request));
   try{this.original('proof-request.original.json',bytes);}finally{bytes.fill(0);}
   const name=assetName(this.manifest,'open-proof'),ciphertextDigest=hash(ciphertext);
   this.original(name,ciphertext);
   const preintent=Buffer.from(JSON.stringify({phase:'open-proof',name,ciphertextDigest,bytes:ciphertext.length,
    manifestDigest:digest(this.manifest),originalRequestDigest:digest(original.request),maximumUploads:1,retryAllowed:false}));
   try{this.original('proof-request-upload.intent.json',preintent);}finally{preintent.fill(0);}
   // The local root must answer promptly; a stale proof never becomes permission
   // to repeat this request or create/submit another Checkout.
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
   const retained=await transport.upload('open-proof',ciphertext,bounded);this.active(bounded);
   this.unchanged(name,ciphertext);
   guard(hash(ciphertext)===ciphertextDigest&&retained.phase==='open-proof'&&retained.name===name
    &&retained.ciphertextDigest===ciphertextDigest&&retained.size===ciphertext.length
    &&retained.releaseId===this.manifest.releaseId&&retained.jobId===this.manifest.job.id
    &&retained.jobNonce===this.manifest.job.nonce&&retained.headSha===this.manifest.job.headSha
    &&retained.operationId===this.manifest.operationId&&retained.anonymousDraft404===true&&retained.anonymousAsset404===true
    &&retained.exactRetainedAssetVerified===true&&retained.readbackVerified===true&&retained.retryAllowed===false
    &&Number.isSafeInteger(retained.assetId)&&retained.assetId>0
    &&Number.isFinite(Date.parse(retained.observedAt))&&this.now()-Date.parse(retained.observedAt)>=-5000
    &&this.now()-Date.parse(retained.observedAt)<=30000);
   const result=Buffer.from(JSON.stringify(retained));
   try{this.original('proof-request-upload.result.json',result);}finally{result.fill(0);}
   response=await transport.download('submit-proof',bounded);this.active(bounded);
   guard(response.length>36&&response.length<=16384);
   this.original(assetName(this.manifest,'submit-proof'),response);
   const requestReadback=Buffer.from(JSON.stringify(original.request));
   try{this.unchanged('proof-request.original.json',requestReadback);}finally{requestReadback.fill(0);}
   this.unchanged(name,ciphertext);
   const proof=decodeProofResponse(response,this.key,original.request,this.manifest,opening,this.now());
   this.active(bounded);return proof;
  }catch{this.close();return fail();}finally{ciphertext?.fill(0);response?.fill(0);}
 }
 close(){this.key.fill(0);this.key=Buffer.alloc(0);}
}
