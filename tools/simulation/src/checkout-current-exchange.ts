/** Current parent/root encrypted phase exchange. Import/constructor are inert.
 * Crypto binds packets, not provider truth or admission. Native root must make
 * original atomic budget decisions; verifyContext must independently re-observe
 * job/source/process ownership. Failed/uncertain requests are never retried. */
import { createHash,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { resolve,join,dirname } from 'node:path';
import { existsSync,lstatSync,realpathSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync } from 'node:fs';
import { seal,unseal } from './hosted-community-bundle.ts';
import { validateCurrentCheckoutInput,validateCurrentCheckoutProof,assertCurrentCheckoutSessionUnchanged,type CurrentCheckoutInput,type CurrentCheckoutProof } from './checkout-current-input.ts';
import { validateCurrentCheckoutPhase,currentPhaseNames,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
import type { CurrentMemberBroker,CurrentMemberIdentity } from './checkout-current-member.ts';
import type { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
import { currentCheckoutCandidate as c } from './checkout-current-profile.ts';
import { assetName,type CheckoutAssetBinding } from './hosted-checkout-policy.ts';

const sha=z.string().regex(/^[a-f0-9]{64}$/),nonce=z.string().regex(/^[a-f0-9]{32}$/);
const identitySchema=z.object({userId:z.literal(c.memberId),sessionVersion:z.number().int().min(0),observedAt:z.iso.datetime(),
 normalMemberOnly:z.literal(true),billingManagementVerified:z.literal(true)}).strict();
const requestSchema=z.object({protocol:z.literal(1),purpose:z.literal('current-checkout-phase-request'),profileDigest:sha,connectionNonce:nonce,
 requestNonce:nonce,phase:z.enum(currentPhaseNames),previousProofDigest:sha,identity:identitySchema,requestedAt:z.iso.datetime(),
 maximumResponses:z.literal(1),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
const responseSchema=z.object({protocol:z.literal(1),purpose:z.literal('current-checkout-phase-response'),profileDigest:sha,connectionNonce:nonce,
 requestNonce:nonce,requestDigest:sha,phase:z.enum(currentPhaseNames),packet:z.unknown(),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
export type CurrentPhaseRequest=z.infer<typeof requestSchema>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=():never=>{throw Error('Current encrypted phase exchange stopped; originals retained; no retry; private details withheld.');};
function guard(value:unknown):asserts value{if(!value)fail();}
function historicalInput(input:CurrentCheckoutInput,now:number){
 const original=Date.parse(input.proof.checkout.verifiedAt);guard(Number.isFinite(now)&&original<=now+5000&&input.proof.checkout.expiresAt*1000>now+15000);
 // Revalidate immutable input at its retained observation. Actual live job and
 // provider freshness belong to each native backend/context check, not this codec.
 return validateCurrentCheckoutInput(input,input.profile,original);
}
function previousProof(input:CurrentCheckoutInput,proof:CurrentCheckoutProof,now:number){const observed=Date.parse(proof.checkout.verifiedAt);
 guard(Number.isFinite(observed)&&observed<=now+5000&&observed>=Date.parse(input.proof.checkout.verifiedAt)&&proof.customerAccountId===input.proof.customerAccountId);
 assertCurrentCheckoutSessionUnchanged(input.proof.checkout,proof.checkout);return validateCurrentCheckoutProof(proof,input.profile,observed);}
function validRequest(raw:unknown,input:CurrentCheckoutInput,previous:CurrentCheckoutProof,connectionNonce:string,now:number){
 historicalInput(input,now);previousProof(input,previous,now);nonce.parse(connectionNonce);const value=requestSchema.parse(raw);
 const age=now-Date.parse(value.requestedAt),identityAge=now-Date.parse(value.identity.observedAt);
 guard(value.profileDigest===input.profileDigest&&value.connectionNonce===connectionNonce&&value.previousProofDigest===digest(previous)&&
  age>=-5000&&age<=30000&&identityAge>=-5000&&identityAge<=30000);Object.freeze(value.identity);return Object.freeze(value);
}
function encrypt(value:unknown,key:Buffer){guard(Buffer.isBuffer(key)&&key.length===32&&Buffer.byteLength(JSON.stringify(value))<=32768);
 const bytes=seal(value,key);if(bytes.length>65536){bytes.fill(0);fail();}return bytes;}
function decrypt(bytes:Buffer,key:Buffer){guard(Buffer.isBuffer(key)&&key.length===32&&Buffer.isBuffer(bytes)&&bytes.length>36&&bytes.length<=65536);return unseal(bytes,key,32768);}
export function createCurrentPhaseRequest(phase:CurrentCheckoutPhase,identity:CurrentMemberIdentity,input:CurrentCheckoutInput,
 previous:CurrentCheckoutProof,connectionNonce:string,key:Buffer,now:number){try{
 const request=validRequest({protocol:1,purpose:'current-checkout-phase-request',profileDigest:input.profileDigest,connectionNonce,
  requestNonce:randomBytes(16).toString('hex'),phase,previousProofDigest:digest(previous),identity,requestedAt:new Date(now).toISOString(),
  maximumResponses:1,paymentAccepted:false,retryAllowed:false},input,previous,connectionNonce,now);
 return {request,ciphertext:encrypt(request,key)};
}catch{return fail();}}
export function decodeCurrentPhaseRequest(bytes:Buffer,key:Buffer,input:CurrentCheckoutInput,previous:CurrentCheckoutProof,connectionNonce:string,now:number){
 try{return validRequest(decrypt(bytes,key),input,previous,connectionNonce,now);}catch{return fail();}}
export function createCurrentPhaseResponse(raw:unknown,packet:unknown,input:CurrentCheckoutInput,previous:CurrentCheckoutProof,
 connectionNonce:string,key:Buffer,now:number,usedNonces:ReadonlySet<string>){try{
 const request=validRequest(raw,input,previous,connectionNonce,now),proof=validateCurrentCheckoutPhase(packet,request.phase,input.profile,previous,now,usedNonces);
 guard(Date.parse(proof.proof.checkout.verifiedAt)>=Date.parse(request.requestedAt));
 return encrypt({protocol:1,purpose:'current-checkout-phase-response',profileDigest:input.profileDigest,connectionNonce,
  requestNonce:request.requestNonce,requestDigest:digest(request),phase:request.phase,packet:proof,paymentAccepted:false,retryAllowed:false},key);
}catch{return fail();}}
export function decodeCurrentPhaseResponse(bytes:Buffer,key:Buffer,raw:unknown,input:CurrentCheckoutInput,previous:CurrentCheckoutProof,
 connectionNonce:string,now:number,usedNonces:ReadonlySet<string>){try{
 const request=validRequest(raw,input,previous,connectionNonce,now),response=responseSchema.parse(decrypt(bytes,key));
 guard(response.profileDigest===input.profileDigest&&response.connectionNonce===connectionNonce&&response.requestNonce===request.requestNonce&&
  response.requestDigest===digest(request)&&response.phase===request.phase);
 const packet=validateCurrentCheckoutPhase(response.packet,request.phase,input.profile,previous,now,usedNonces);
 guard(Date.parse(packet.proof.checkout.verifiedAt)>=Date.parse(request.requestedAt));return packet;
}catch{return fail();}}

const retainedSchema=z.object({phase:z.string(),assetId:z.number().int().positive(),name:z.string(),size:z.number().int().min(37).max(65536),ciphertextDigest:sha,
 releaseId:z.number().int().positive(),jobId:z.string(),jobNonce:nonce,headSha:z.string(),operationId:z.literal(c.operationId),anonymousDraft404:z.literal(true),
 anonymousAsset404:z.literal(true),observedAt:z.iso.datetime(),exactRetainedAssetVerified:z.literal(true),readbackVerified:z.literal(true),retryAllowed:z.literal(false),paymentAccepted:z.literal(false)}).strict();
export function validateRetainedCurrentPhaseAsset(raw:unknown,binding:CheckoutAssetBinding,phase:Parameters<typeof assetName>[1],bytes:Buffer,now:number){
 try{const retained=retainedSchema.parse(raw),age=now-Date.parse(retained.observedAt);
  guard(Number.isFinite(now)&&retained.phase===phase&&retained.name===assetName(binding,phase)&&retained.size===bytes.length&&
   retained.ciphertextDigest===hash(bytes)&&retained.releaseId===binding.releaseId&&retained.jobId===binding.job.id&&
   retained.jobNonce===binding.job.nonce&&retained.headSha===binding.job.headSha&&retained.operationId===binding.operationId&&age>=-5000&&age<=30000);
  return retained;
 }catch{return fail();}
}
function next(previous:CurrentCheckoutPhase|undefined,phase:CurrentCheckoutPhase){return previous===undefined?phase==='opening':
 previous==='opening'?phase==='fixture':previous==='fixture'?phase==='notice'||phase==='submission':previous==='notice'?phase==='submission':false;}
export class CurrentCheckoutPhaseExchange implements CurrentMemberBroker {
 private readonly input:CurrentCheckoutInput;private proof:CurrentCheckoutProof;private key:Buffer;private readonly directory:string;
 private initialized=false;private previous?:CurrentCheckoutPhase;private busy=false;private closed=false;private controller=new AbortController();private nonces=new Set<string>();private sessionVersion?:number;
 private readonly binding:CheckoutAssetBinding;
 private readonly connectionNonce:string;private readonly releaseId:number;private readonly transport:Pick<CurrentCheckoutPrivateDraft,'upload'|'download'>;
 private readonly verifyContext:(signal:AbortSignal)=>Promise<void>;private readonly now:()=>number;
 constructor(root:string,raw:unknown,connectionNonce:string,key:Buffer,releaseId:number,
  transport:Pick<CurrentCheckoutPrivateDraft,'upload'|'download'>,
  verifyContext:(signal:AbortSignal)=>Promise<void>,now=Date.now){
  this.connectionNonce=connectionNonce;this.releaseId=releaseId;this.transport=transport;this.verifyContext=verifyContext;this.now=now;
  guard(raw&&typeof raw==='object'&&'profile' in raw);const candidate=raw as CurrentCheckoutInput;this.input=validateCurrentCheckoutInput(raw,candidate.profile,now());this.proof=this.input.proof;
  guard(Buffer.isBuffer(key)&&key.length===32&&Number.isSafeInteger(releaseId)&&releaseId>0&&typeof root==='string'&&root.length>0);nonce.parse(connectionNonce);this.key=Buffer.from(key);
  const p=this.input.profile;this.binding={releaseId,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
  this.directory=join(resolve(root),`current-checkout-exchange-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}`);
 }
 private contained(){for(let path=this.directory;;path=dirname(path)){if(existsSync(path))guard(!lstatSync(path).isSymbolicLink()&&realpathSync(path)===path);if(dirname(path)===path)break;}}
 private flush(path:string){if(process.platform==='linux'){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}}
 private retain(name:string,bytes:Buffer){this.contained();guard(/^[a-z-]+\.(?:json|g2genc)$/.test(name)&&bytes.length<=65536);const path=join(this.directory,name),fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}this.flush(this.directory);guard(readFileSync(path).equals(bytes));}
 private unchanged(name:string,bytes:Buffer){this.contained();const path=join(this.directory,name);guard(lstatSync(path).isFile()&&lstatSync(path).size===bytes.length&&readFileSync(path).equals(bytes));}
 private active(signal:AbortSignal){guard(!this.closed&&this.key.length===32);signal.throwIfAborted();}
 async phase(phase:CurrentCheckoutPhase,identity:CurrentMemberIdentity,signal:AbortSignal){let ciphertext:Buffer|undefined,response:Buffer|undefined;
  try{guard(!this.closed&&!this.busy&&next(this.previous,phase));this.busy=true;this.previous=phase;
   const member=identitySchema.parse(identity);guard(this.sessionVersion===undefined||this.sessionVersion===member.sessionVersion);this.sessionVersion=member.sessionVersion;
   const bounded=AbortSignal.any([signal,this.controller.signal,AbortSignal.timeout(30000)]);this.active(bounded);await this.verifyContext(bounded);this.active(bounded);
   if(!this.initialized){this.contained();guard(lstatSync(dirname(this.directory)).isDirectory());mkdirSync(this.directory,{mode:0o700});this.flush(dirname(this.directory));this.initialized=true;
    this.retain('exchange-lease.json',Buffer.from(JSON.stringify({profileDigest:this.input.profileDigest,connectionNonce:this.connectionNonce,paymentAccepted:false,retryAllowed:false})));}
   const original=createCurrentPhaseRequest(phase,identity,this.input,this.proof,this.connectionNonce,this.key,this.now());ciphertext=original.ciphertext;
   const requestPhase=`${phase}-request` as const,responsePhase=`${phase}-response` as const;
   this.retain(`${phase}-request.g2genc`,ciphertext);
   const intent={phase:requestPhase,requestDigest:digest(original.request),ciphertextDigest:hash(ciphertext),size:ciphertext.length,maximumUploads:1,retryAllowed:false,paymentAccepted:false};
   this.retain(`${phase}-upload-intent.json`,Buffer.from(JSON.stringify(intent)));
   const raw=await this.transport.upload(requestPhase,ciphertext,bounded);this.active(bounded);this.unchanged(`${phase}-request.g2genc`,ciphertext);
   const retained=validateRetainedCurrentPhaseAsset(raw,this.binding,requestPhase,ciphertext,this.now());
   this.retain(`${phase}-upload-result.json`,Buffer.from(JSON.stringify(retained)));
   response=await this.transport.download(responsePhase,bounded);this.active(bounded);guard(Buffer.isBuffer(response)&&response.length>36&&response.length<=65536);
   this.retain(`${phase}-response.g2genc`,response);this.unchanged(`${phase}-request.g2genc`,ciphertext);
   const packet=decodeCurrentPhaseResponse(response,this.key,original.request,this.input,this.proof,this.connectionNonce,this.now(),this.nonces);
   await this.verifyContext(bounded);this.active(bounded);this.unchanged(`${phase}-response.g2genc`,response);
   this.proof=packet.proof;this.nonces.add(packet.nonce);this.busy=false;
   this.retain(`${phase}-accepted.json`,Buffer.from(JSON.stringify({requestDigest:intent.requestDigest,responseDigest:hash(response),phase,financialAuthorityStillRequiresRootAdmission:true,paymentAccepted:false,retryAllowed:false})));
   return packet;
  }catch{this.close();return fail();}finally{ciphertext?.fill(0);response?.fill(0);}
 }
 close(){if(this.closed)return;this.closed=true;this.controller.abort();this.key.fill(0);this.key=Buffer.alloc(0);}
}
