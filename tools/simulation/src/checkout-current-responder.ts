/** Root half of the CURRENT encrypted phase channel. Explicit construction is
 * inert; respond performs one ordered exchange against the supplied root broker.
 * No env/SDK discovery, login, Checkout creation, journal reset or retry. Native
 * bootstrap must supply independent source/job checks and the ORIGINAL ledger. */
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,realpathSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { validateCurrentCheckoutInput,type CurrentCheckoutInput,type CurrentCheckoutProof } from './checkout-current-input.ts';
import { currentPhaseNames,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
import { decodeCurrentPhaseRequest,createCurrentPhaseResponse,decodeCurrentPhaseResponse,validateRetainedCurrentPhaseAsset } from './checkout-current-exchange.ts';
import type { CurrentCheckoutPrivateDraft } from './checkout-current-draft.ts';
import type { CurrentCheckoutRootBroker } from './checkout-current-root.ts';
import type { CheckoutAssetBinding } from './hosted-checkout-policy.ts';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const digest=(value:unknown)=>hash(Buffer.from(JSON.stringify(value)));
const fail=():never=>{throw Error('Current root response stopped; originals and holds retained; no retry; private details withheld.');};
function guard(value:unknown):asserts value{if(!value)fail();}
function next(previous:CurrentCheckoutPhase|undefined,phase:CurrentCheckoutPhase){return previous===undefined?phase==='opening':
 previous==='opening'?phase==='fixture':previous==='fixture'?phase==='notice'||phase==='submission':previous==='notice'?phase==='submission':false;}
async function bounded<T>(action:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let remove=()=>{};
 const interrupted=new Promise<never>((__resolve,reject)=>{const stop=()=>reject(Error('Current response canceled.'));
  signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
 try{return await Promise.race([action(),interrupted]);}finally{remove();}
}
type Options={root:string;key:Buffer;connectionNonce:string;releaseId:number;broker:Pick<CurrentCheckoutRootBroker,'phase'|'close'>;
 transport:Pick<CurrentCheckoutPrivateDraft,'download'|'upload'>;verifyContext:(signal:AbortSignal)=>Promise<void>;now?:()=>number};
export class CurrentCheckoutRootResponder {
 private readonly input:CurrentCheckoutInput;private proof:CurrentCheckoutProof;private readonly options:Options;private readonly now:()=>number;
 private readonly directory:string;private readonly binding:CheckoutAssetBinding;private key:Buffer;
 private initialized=false;private busy=false;private closed=false;private previous?:CurrentCheckoutPhase;private nonces=new Set<string>();
 private controller=new AbortController();
 constructor(raw:unknown,options:Options){
  this.options=options;this.now=options.now??Date.now;guard(raw&&typeof raw==='object'&&'profile' in raw);
  this.input=validateCurrentCheckoutInput(raw,(raw as CurrentCheckoutInput).profile,this.now());this.proof=this.input.proof;
  guard(Buffer.isBuffer(options.key)&&options.key.length===32&&/^[a-f0-9]{32}$/.test(options.connectionNonce)&&
   Number.isSafeInteger(options.releaseId)&&options.releaseId>0&&typeof options.root==='string'&&options.root.length>0);
  this.key=Buffer.from(options.key);const p=this.input.profile;
  this.binding={releaseId:options.releaseId,operationId:p.operationId,job:{id:p.job.jobId,nonce:p.job.jobNonce,headSha:p.job.headSha}};
  this.directory=join(resolve(options.root),`current-checkout-responder-${p.operationId}-${p.job.jobId}-${p.job.jobNonce}`);
 }
 private contained(){for(let path=this.directory;;path=dirname(path)){if(existsSync(path))guard(!lstatSync(path).isSymbolicLink()&&realpathSync(path)===path);if(dirname(path)===path)break;}}
 private flush(path:string){if(process.platform==='linux'){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}}
 private retain(name:string,bytes:Buffer){this.contained();guard(/^[a-z-]+\.(?:json|g2genc)$/.test(name)&&bytes.length>0&&bytes.length<=65536);
  const path=join(this.directory,name),fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  this.flush(this.directory);this.unchanged(name,bytes);
 }
 private unchanged(name:string,bytes:Buffer){this.contained();const path=join(this.directory,name),stat=lstatSync(path);
  guard(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size===bytes.length);const original=readFileSync(path);
  try{guard(original.equals(bytes));}finally{original.fill(0);}
 }
 private record(name:string,value:unknown){const bytes=Buffer.from(JSON.stringify(value));try{this.retain(name,bytes);}finally{bytes.fill(0);}}
 private active(signal:AbortSignal){guard(!this.closed&&this.key.length===32);signal.throwIfAborted();}
 async respond(phase:CurrentCheckoutPhase,signal:AbortSignal){let requestBytes:Buffer|undefined,responseBytes:Buffer|undefined;
  try{
   guard(!this.closed&&!this.busy&&currentPhaseNames.includes(phase)&&next(this.previous,phase));this.busy=true;this.previous=phase;
   const scoped=AbortSignal.any([signal,this.controller.signal,AbortSignal.timeout(30000)]);this.active(scoped);
   if(!this.initialized){this.contained();guard(lstatSync(dirname(this.directory)).isDirectory());mkdirSync(this.directory,{mode:0o700});this.flush(dirname(this.directory));this.initialized=true;
    this.record('responder-lease.json',{profileDigest:this.input.profileDigest,connectionNonce:this.options.connectionNonce,maximumResponsesPerPhase:1,paymentAccepted:false,retryAllowed:false});}
   await bounded(()=>this.options.verifyContext(scoped),scoped);this.active(scoped);
   const requestPhase=`${phase}-request` as const,responsePhase=`${phase}-response` as const;
   this.record(`${phase}-download-intent.json`,{phase:requestPhase,maximumDownloads:1,paymentAccepted:false,retryAllowed:false});
   requestBytes=await bounded(()=>this.options.transport.download(requestPhase,scoped),scoped);this.active(scoped);
   guard(Buffer.isBuffer(requestBytes)&&requestBytes.length>36&&requestBytes.length<=65536);this.retain(`${phase}-request.g2genc`,requestBytes);
   const request=decodeCurrentPhaseRequest(requestBytes,this.key,this.input,this.proof,this.options.connectionNonce,this.now());guard(request.phase===phase);
   await bounded(()=>this.options.verifyContext(scoped),scoped);this.active(scoped);this.unchanged(`${phase}-request.g2genc`,requestBytes);
   this.record(`${phase}-broker-intent.json`,{phase,requestDigest:digest(request),maximumCalls:1,paymentAccepted:false,retryAllowed:false});
   const packet=await bounded(()=>this.options.broker.phase(phase,request.identity,scoped),scoped);this.active(scoped);
   responseBytes=createCurrentPhaseResponse(request,packet,this.input,this.proof,this.options.connectionNonce,this.key,this.now(),this.nonces);
   const decoded=decodeCurrentPhaseResponse(responseBytes,this.key,request,this.input,this.proof,this.options.connectionNonce,this.now(),this.nonces);
   this.retain(`${phase}-response.g2genc`,responseBytes);
   await bounded(()=>this.options.verifyContext(scoped),scoped);this.active(scoped);
   this.unchanged(`${phase}-request.g2genc`,requestBytes);this.unchanged(`${phase}-response.g2genc`,responseBytes);
   this.record(`${phase}-upload-intent.json`,{phase:responsePhase,requestDigest:digest(request),ciphertextDigest:hash(responseBytes),size:responseBytes.length,
    maximumUploads:1,originalAdmissionRequiresReconciliation:true,paymentAccepted:false,retryAllowed:false});
   const retained=validateRetainedCurrentPhaseAsset(await bounded(()=>this.options.transport.upload(responsePhase,responseBytes!,scoped),scoped),this.binding,responsePhase,responseBytes,this.now());
   this.active(scoped);this.unchanged(`${phase}-response.g2genc`,responseBytes);
   decodeCurrentPhaseResponse(responseBytes,this.key,request,this.input,this.proof,this.options.connectionNonce,this.now(),this.nonces);
   await bounded(()=>this.options.verifyContext(scoped),scoped);this.active(scoped);
   this.unchanged(`${phase}-request.g2genc`,requestBytes);this.unchanged(`${phase}-response.g2genc`,responseBytes);
   this.record(`${phase}-upload-result.json`,retained);this.proof=decoded.proof;this.nonces.add(decoded.nonce);this.busy=false;
   return Object.freeze({phase,privateResponseRetained:true,originalAdmissionRequiresReconciliation:true,paymentAccepted:false,retryAllowed:false});
  }catch{this.close();return fail();}finally{requestBytes?.fill(0);responseBytes?.fill(0);}
 }
 close(){if(this.closed)return;this.closed=true;this.controller.abort();this.key.fill(0);this.key=Buffer.alloc(0);try{this.options.broker.close();}catch{fail();}}
}
