/** Explicit current local root phase controller. Import/constructor are inert.
 * No new ledger, env, SDK, login, Checkout creation or transport dispatch here.
 * Caller supplies the ORIGINAL ledger and independent native context/member
 * verifiers. Tests using doubles are not native/provider/payment acceptance. */
import { randomBytes } from 'node:crypto';
import { existsSync,lstatSync,realpathSync,mkdirSync,openSync,writeFileSync,readFileSync,fsyncSync,closeSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { z } from 'zod';
import { seal } from './hosted-community-bundle.ts';
import { validateCurrentCheckoutInput,type CurrentCheckoutInput,type CurrentCheckoutProof } from './checkout-current-input.ts';
import { validateCurrentCheckoutPhase,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
import type { CurrentMemberBroker,CurrentMemberIdentity } from './checkout-current-member.ts';
import type { SandboxLedger } from './sandbox-ledger.ts';
import type { CurrentCheckoutProofReader } from './checkout-current-provider.ts';
const fail=()=>new Error('Current root phase stopped; original holds retained; no retry; private details withheld.');
function guard(value:unknown):asserts value{if(!value)throw fail();}
const identitySchema=z.object({userId:z.string(),sessionVersion:z.number().int().min(0),observedAt:z.iso.datetime(),normalMemberOnly:z.literal(true),billingManagementVerified:z.literal(true)}).strict();
function next(previous:CurrentCheckoutPhase|undefined,phase:CurrentCheckoutPhase){return previous===undefined?phase==='opening':previous==='opening'?phase==='fixture':
 previous==='fixture'?phase==='notice'||phase==='submission':previous==='notice'?phase==='submission':false;}
type Options={root:string;key:Buffer;ledger:Pick<SandboxLedger,'get'|'reserve'|'acknowledgeAgentNotice'|'update'>;
 reader:Pick<CurrentCheckoutProofReader,'read'|'close'>;
 verifyCurrent:(phase:CurrentCheckoutPhase,signal:AbortSignal)=>Promise<void>;
 verifyOriginalBudget:(phase:CurrentCheckoutPhase,signal:AbortSignal,noticeAlreadyAdmitted:boolean)=>Promise<void>;
 readMember:(proof:CurrentCheckoutProof,signal:AbortSignal)=>Promise<CurrentMemberIdentity>;now?:()=>number};
export class CurrentCheckoutRootBroker implements CurrentMemberBroker {
 private readonly input:CurrentCheckoutInput;private proof:CurrentCheckoutProof;private readonly options:Options;private readonly now:()=>number;
 private readonly directory:string;private key:Buffer;private closed=false;private busy=false;private initialized=false;private previous?:CurrentCheckoutPhase;
 private controller=new AbortController();private nonces=new Set<string>();private sessionVersion?:number;private noticeAlreadyAdmitted=false;
 constructor(raw:unknown,options:Options){guard(raw&&typeof raw==='object'&&'profile' in raw);this.options=options;this.now=options.now??Date.now;
  this.input=validateCurrentCheckoutInput(raw,(raw as CurrentCheckoutInput).profile,this.now());this.proof=this.input.proof;
  guard(Buffer.isBuffer(options.key)&&options.key.length===32);this.key=Buffer.from(options.key);
  this.directory=join(resolve(options.root),`current-checkout-root-${this.input.profile.runId}-${this.input.profile.operationId}`);
 }
 private flush(path:string){if(process.platform==='linux'){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}}
 private contained(){for(let path=this.directory;;path=dirname(path)){if(existsSync(path))guard(!lstatSync(path).isSymbolicLink()&&realpathSync(path)===path);if(dirname(path)===path)break;}}
 private retain(name:string,bytes:Buffer){this.contained();guard(/^[a-z-]+\.(?:json|g2genc)$/.test(name)&&bytes.length<=65536);const path=join(this.directory,name),fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}this.flush(this.directory);guard(readFileSync(path).equals(bytes));}
 private active(signal:AbortSignal){guard(!this.closed&&this.key.length===32);signal.throwIfAborted();}
 private reserved(){const p=this.input.profile,attempt=this.options.ledger.get(p.operationId);
  guard(attempt?.actorId===this.input.member.userId&&attempt.amountCents===500&&attempt.scenario==='decline'&&attempt.state==='reserved');}
 async phase(phase:CurrentCheckoutPhase,rawIdentity:CurrentMemberIdentity,signal:AbortSignal){let proofBytes:Buffer|undefined;
  try{guard(!this.closed&&!this.busy&&next(this.previous,phase));this.busy=true;this.previous=phase;
   const bounded=AbortSignal.any([signal,this.controller.signal,AbortSignal.timeout(30000)]);this.active(bounded);
   const identity=identitySchema.parse(rawIdentity),age=this.now()-Date.parse(identity.observedAt);
   guard(identity.userId===this.input.member.userId&&age>=-5000&&age<=30000&&(this.sessionVersion===undefined||this.sessionVersion===identity.sessionVersion));this.sessionVersion=identity.sessionVersion;
   if(!this.initialized){this.contained();guard(lstatSync(dirname(this.directory)).isDirectory());mkdirSync(this.directory,{mode:0o700});this.flush(dirname(this.directory));this.initialized=true;
    this.retain('root-lease.json',Buffer.from(JSON.stringify({profileDigest:this.input.profileDigest,noHistoryReset:true,maximumSubmissions:1,paymentAccepted:false,retryAllowed:false})));}
   await this.options.verifyCurrent(phase,bounded);this.active(bounded);await this.options.verifyOriginalBudget(phase,bounded,this.noticeAlreadyAdmitted);this.active(bounded);
   this.retain(`${phase}-provider-intent.json`,Buffer.from(JSON.stringify({phase,maximumReads:1,paymentAccepted:false,retryAllowed:false})));
   const proof=await this.options.reader.read(phase,bounded);this.active(bounded);
   const member=identitySchema.parse(await this.options.readMember(proof,bounded));this.active(bounded);const memberAge=this.now()-Date.parse(member.observedAt);
   guard(member.userId===identity.userId&&member.sessionVersion===identity.sessionVersion&&memberAge>=-5000&&memberAge<=30000);
   const packet=validateCurrentCheckoutPhase({protocol:1,purpose:'current-member-phase-proof',profileDigest:this.input.profileDigest,phase,
    nonce:randomBytes(16).toString('hex'),admission:phase==='notice'?'notice':phase==='submission'?'submit':'none',proof,paymentAccepted:false,retryAllowed:false},
    phase,this.input.profile,this.proof,this.now(),this.nonces);
   proofBytes=seal(packet,this.key);this.retain(`${phase}-proof.g2genc`,proofBytes);
   await this.options.verifyCurrent(phase,bounded);this.active(bounded);
   this.retain(`${phase}-admission-intent.json`,Buffer.from(JSON.stringify({phase,operationId:this.input.profile.operationId,maximumAmountCents:500,maximumActions:1,paymentAccepted:false,retryAllowed:false})));
   const p=this.input.profile;
   if(phase==='opening'){guard(!this.options.ledger.get(p.operationId));this.options.ledger.reserve(p.operationId,this.input.member.userId,500,'decline');this.reserved();}
   else{this.reserved();if(phase==='notice'){this.options.ledger.acknowledgeAgentNotice(p.operationId,this.input.member.userId);this.noticeAlreadyAdmitted=true;}
    else if(phase==='submission'){this.options.ledger.update(p.operationId,'submitted');const submitted=this.options.ledger.get(p.operationId);
     guard(submitted?.state==='submitted'&&submitted.actorId===this.input.member.userId&&submitted.amountCents===500&&submitted.scenario==='decline');}}
   this.active(bounded);validateCurrentCheckoutPhase(packet,phase,this.input.profile,this.proof,this.now(),this.nonces);
   this.retain(`${phase}-admission-result.json`,Buffer.from(JSON.stringify({phase,state:phase==='submission'?'submitted':'reserved',financialStateStillRequiresReconciliation:true,paymentAccepted:false,retryAllowed:false})));
   this.proof=packet.proof;this.nonces.add(packet.nonce);this.busy=false;return packet;
  }catch{this.close();throw fail();}finally{proofBytes?.fill(0);}
 }
 close(){if(this.closed)return;this.closed=true;this.controller.abort();this.key.fill(0);this.key=Buffer.alloc(0);try{this.options.reader.close();}catch{/* No cleanup-success claim is made here; controller must independently verify closure. */}}
}
