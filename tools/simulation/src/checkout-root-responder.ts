/** Local-only one-shot responder. No env or SDK loading, member login, mutation,
 * preparation or grant. Actual current release/DB/budget/live-job observations
 * remain the operator's separate mandatory verifier. Injected tests cannot prove
 * provider or remote acceptance. Original proof times are never rewritten. */
import { mkdirSync,openSync,fsyncSync,closeSync,lstatSync,realpathSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { digest,assetName,validateManifest,validateProof,type Proof } from './hosted-checkout-policy.ts';
import { decodeProofRequest,createProofResponse,decodeProofResponse } from './checkout-proof-exchange.ts';
import { seal } from './hosted-community-bundle.ts';
import { writeBootstrapOriginal,readBootstrapOriginal } from './checkout-bootstrap-retention.ts';
import { validateRetainedCheckoutAsset,type CheckoutPrivateDraft } from './hosted-checkout-github.ts';
import type { LocalCheckoutProofReader } from './checkout-provider-proof.ts';
const fail=():never=>{throw Error('Local Checkout proof response unconfirmed; originals retained; no automatic retry.');};
function guard(value:unknown):asserts value{if(!value)fail();}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function bounded<T>(action:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let remove=()=>{};
 const interrupted=new Promise<never>((__resolve,reject)=>{const stop=()=>reject(Error('cancelled'));
  signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
 try{return await Promise.race([action(),interrupted]);}finally{remove();}
}
export async function respondCheckoutProofRequest(rawManifest:unknown,head:string,opening:Proof,options:{
 root:string;key:Buffer;draft:Pick<CheckoutPrivateDraft,'download'|'upload'>;
 reader:Pick<LocalCheckoutProofReader,'read'|'close'>;verifyCurrent:()=>Promise<void>;signal:AbortSignal;now?:()=>number;
}){
 const now=options.now??Date.now;let key:Buffer|undefined,requestBytes:Buffer|undefined,responseBytes:Buffer|undefined;
 const signal=AbortSignal.any([options.signal,AbortSignal.timeout(180000)]);
 try{
  const manifest=validateManifest(rawManifest,head,now());
  validateProof(opening,manifest,'open',Date.parse(opening.verifiedAt));
  guard(Number.isFinite(now())&&Date.parse(opening.verifiedAt)<=now()+5000&&Buffer.isBuffer(options.key)&&options.key.length===32);signal.throwIfAborted();
  key=Buffer.from(options.key);
  const root=resolve(options.root),directory=join(root,`checkout-root-proof-${manifest.operationId}-${manifest.job.id}-${manifest.job.nonce}`);
  for(let cursor=root;;cursor=dirname(cursor)){guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);if(dirname(cursor)===cursor)break;}
  guard(lstatSync(root).isDirectory());
  mkdirSync(directory,{mode:0o700});
  if(process.platform==='linux'){const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  const original=(name:string,value:unknown)=>{
   const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
   try{writeBootstrapOriginal(directory,name,bytes);}finally{if(!Buffer.isBuffer(value))bytes.fill(0);}
  };
  original('root-responder-lease.json',{protocol:1,manifestDigest:digest(manifest),maximumProviderRounds:1,maximumUploads:1,paymentAccepted:false,retryAllowed:false});
  await bounded(options.verifyCurrent,signal);
  requestBytes=await bounded(()=>options.draft.download('open-proof',signal),signal);
  original('request.original.g2genc',requestBytes);
  const requestDigest=hash(requestBytes),request=decodeProofRequest(requestBytes,key,manifest,opening,now());
  await bounded(options.verifyCurrent,signal);
  original('provider-read.intent.json',{protocol:1,manifestDigest:digest(manifest),requestDigest:digest(request),maximumRounds:1,paymentAccepted:false,retryAllowed:false});
  const fresh=await bounded(()=>options.reader.read('pre-submit',signal),signal);
  validateProof(fresh,manifest,'pre-submit',now(),opening);
  const proofBytes=seal({protocol:1,kind:'original-local-provider-proof',requestDigest:digest(request),proof:fresh,paymentAccepted:false,retryAllowed:false},key);
  try{original('provider-proof.original.g2genc',proofBytes);}finally{proofBytes.fill(0);}
  responseBytes=createProofResponse(request,manifest,opening,fresh,key,now());
  guard(digest(decodeProofResponse(responseBytes,key,request,manifest,opening,now()))===digest(fresh));
  const name=assetName(manifest,'submit-proof'),responseDigest=hash(responseBytes);
  original(name,responseBytes);
  const unchanged=()=>{
   const prior=readBootstrapOriginal(join(directory,'request.original.g2genc')),response=readBootstrapOriginal(join(directory,name));
   try{guard(hash(prior)===requestDigest&&hash(response)===responseDigest&&hash(requestBytes!)===requestDigest&&hash(responseBytes!)===responseDigest);}finally{prior.fill(0);response.fill(0);}
  };
  unchanged();await bounded(options.verifyCurrent,signal);
  // Upload permission is flushed before the only response transfer.
  original('response-upload.intent.json',{protocol:1,manifestDigest:digest(manifest),requestDigest:digest(request),ciphertextDigest:responseDigest,
   maximumUploads:1,paymentAccepted:false,retryAllowed:false});
  const retained=validateRetainedCheckoutAsset(await bounded(()=>options.draft.upload('submit-proof',responseBytes!,signal),signal));
  unchanged();validateProof(fresh,manifest,'pre-submit',now(),opening);
  guard(retained.phase==='submit-proof'&&retained.name===name&&retained.ciphertextDigest===responseDigest&&retained.size===responseBytes.length&&
   retained.releaseId===manifest.releaseId&&retained.jobId===manifest.job.id&&retained.jobNonce===manifest.job.nonce&&retained.headSha===head&&
   retained.operationId===manifest.operationId&&retained.readbackVerified===true&&retained.exactRetainedAssetVerified===true&&
   retained.anonymousDraft404===true&&retained.anonymousAsset404===true&&retained.paymentAccepted===false&&retained.retryAllowed===false);
  guard(now()-Date.parse(retained.observedAt)>=-5000&&now()-Date.parse(retained.observedAt)<=30000);
  original('response-upload.result.json',retained);
  return {purpose:'local-checkout-proof-response',requestDigest:digest(request),manifestDigest:digest(manifest),privateResponseRetained:true,
   operatorBindingsIndependentlyRequired:true,paymentAccepted:false,retryAllowed:false};
 }catch{return fail();}finally{key?.fill(0);requestBytes?.fill(0);responseBytes?.fill(0);try{options.reader.close();}catch{fail();}}
}
