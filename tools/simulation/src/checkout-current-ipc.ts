/** Current member/parent channel only. No keys, provider reads, admission,
 * launch or paid acceptance. Privileged root phase work belongs to the backend.
 * Exactly four requests maximum; no concurrent, repeated or failed-call retry. */
import { z } from 'zod';
import type { CheckoutIpcPeer } from './checkout-broker-ipc.ts';
import type { CurrentMemberBroker,CurrentMemberIdentity } from './checkout-current-member.ts';
import { currentPhaseNames,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
import { currentCheckoutCandidate as c } from './checkout-current-profile.ts';
const bindingSchema=z.object({profileDigest:z.string().regex(/^[a-f0-9]{64}$/),connectionNonce:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
type Binding=z.infer<typeof bindingSchema>;
const identitySchema=z.object({userId:z.literal(c.memberId),sessionVersion:z.number().int().min(0),observedAt:z.iso.datetime(),
 normalMemberOnly:z.literal(true),billingManagementVerified:z.literal(true)}).strict();
const requestSchema=z.object({protocol:z.literal(1),kind:z.literal('current-member-phase-request'),...bindingSchema.shape,
 sequence:z.number().int().min(1).max(4),phase:z.enum(currentPhaseNames),identity:identitySchema}).strict();
const responseSchema=z.object({protocol:z.literal(1),kind:z.literal('current-member-phase-response'),...bindingSchema.shape,
 sequence:z.number().int().min(1).max(4),ok:z.boolean(),result:z.unknown().optional()}).strict();
const cancelSchema=z.object({protocol:z.literal(1),kind:z.literal('current-member-cancel'),...bindingSchema.shape,
 sequence:z.number().int().min(1).max(4)}).strict();
const bounded=(raw:unknown)=>{try{return Buffer.byteLength(JSON.stringify(raw))<=65536;}catch{return false;}};
const same=(a:Binding,b:Binding)=>a.profileDigest===b.profileDigest&&a.connectionNonce===b.connectionNonce;
const fail=()=>new Error('Current member IPC stopped; no retry; private details withheld.');
function next(previous:CurrentCheckoutPhase|undefined,phase:CurrentCheckoutPhase){return previous===undefined?phase==='opening':
 previous==='opening'?phase==='fixture':previous==='fixture'?phase==='notice'||phase==='submission':previous==='notice'?phase==='submission':false;}

export function attachCurrentMemberParent(peer:CheckoutIpcPeer,rawBinding:unknown,backend:CurrentMemberBroker,now=Date.now){
 const binding=bindingSchema.parse(rawBinding),controller=new AbortController();let sequence=0,busy=false,closed=false;
 let previous:CurrentCheckoutPhase|undefined;
 const close=()=>{if(closed)return;closed=true;controller.abort();peer.removeListener('message',message);peer.removeListener('disconnect',close);peer.removeListener('error',close);};
 const send=(value:unknown)=>{if(closed||!bounded(value)){close();return;}try{peer.send(value,error=>{if(error)close();});}catch{close();}};
 const message=(raw:unknown)=>{void dispatch(raw);};
 async function dispatch(raw:unknown){
  if(!bounded(raw)){close();return;}
  const cancellation=cancelSchema.safeParse(raw);if(cancellation.success){close();return;}
  const parsed=requestSchema.safeParse(raw);
  if(closed||busy||!parsed.success||!same(parsed.data,binding)||parsed.data.sequence!==sequence+1||!next(previous,parsed.data.phase)){close();return;}
  const req=parsed.data,age=now()-Date.parse(req.identity.observedAt);
  if(!Number.isFinite(age)||age< -5000||age>30000){close();return;}
  sequence=req.sequence;previous=req.phase;busy=true;
  try{const result=await backend.phase(req.phase,Object.freeze(req.identity),controller.signal);
   controller.signal.throwIfAborted();busy=false;send({protocol:1,kind:'current-member-phase-response',...binding,sequence:req.sequence,ok:true,result});
  }catch{busy=false;send({protocol:1,kind:'current-member-phase-response',...binding,sequence:req.sequence,ok:false});close();}
 }
 peer.on('message',message);peer.on('disconnect',close);peer.on('error',close);
 return {close,get closed(){return closed;},get lastPhase(){return previous;}};
}
export function createCurrentMemberClient(peer:CheckoutIpcPeer,rawBinding:unknown,timeoutMs=60000):CurrentMemberBroker&{close():void}{
 const binding=bindingSchema.parse(rawBinding);if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fail();
 let sequence=0,closed=false,previous:CurrentCheckoutPhase|undefined;
 let pending:{resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}|undefined;
 const close=()=>{if(closed)return;closed=true;const active=pending;pending=undefined;active?.cleanup();active?.reject(fail());
  if(sequence)try{peer.send({protocol:1,kind:'current-member-cancel',...binding,sequence},()=>{});}catch{/* disconnected */}
  peer.removeListener('message',message);peer.removeListener('disconnect',close);peer.removeListener('error',close);};
 const message=(raw:unknown)=>{const r=bounded(raw)?responseSchema.safeParse(raw):undefined;
  if(!pending||!r?.success||!same(r.data,binding)||r.data.sequence!==sequence||!r.data.ok){close();return;}
  const active=pending;pending=undefined;active.cleanup();active.resolve(r.data.result);};
 peer.on('message',message);peer.on('disconnect',close);peer.on('error',close);
 return {close,phase:(phase:CurrentCheckoutPhase,identity:CurrentMemberIdentity,signal:AbortSignal)=>{
  if(closed||pending||signal.aborted||sequence>=4||!next(previous,phase)){close();return Promise.reject(fail());}
  const raw={protocol:1,kind:'current-member-phase-request',...binding,sequence:++sequence,phase,identity};
  if(!bounded(raw)||!requestSchema.safeParse(raw).success){close();return Promise.reject(fail());}previous=phase;
  return new Promise<unknown>((resolve,reject)=>{const abort=()=>close(),timer=setTimeout(close,timeoutMs);
   pending={resolve,reject,cleanup:()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);}};
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted){close();return;}
   try{peer.send(raw,error=>{if(error)close();});}catch{close();}
  });
 }};
}
