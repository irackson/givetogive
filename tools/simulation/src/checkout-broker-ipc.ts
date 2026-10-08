/** Explicit parent/member IPC adapter. Import is inert; no env, secrets,
 * provider SDK, browser launch, or payment execution. No failed request is retried. */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { digest } from './hosted-checkout-policy.ts';
import type { CheckoutMemberBroker } from './hosted-checkout-worker.ts';

export interface CheckoutIpcPeer {
 send(message: unknown, callback: (error: Error | null) => void): unknown;
 on(event: 'message' | 'disconnect' | 'error', listener: (...args: unknown[]) => void): unknown;
 removeListener(event: 'message' | 'disconnect' | 'error', listener: (...args: unknown[]) => void): unknown;
}
const bindingSchema=z.object({manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),
 connectionNonce:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export type CheckoutIpcBinding=z.infer<typeof bindingSchema>;
const requestSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-broker-request'),
 ...bindingSchema.shape,sequence:z.number().int().min(1).max(4),
 operation:z.enum(['writeIntent','retainSubmitIntent','preSubmitProof']),
 intent:z.record(z.string(),z.unknown()).optional(),durable:z.unknown().optional()}).strict();
const responseSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-broker-response'),
 ...bindingSchema.shape,sequence:z.number().int().min(1).max(4),ok:z.boolean(),result:z.unknown().optional()}).strict();
const cancelSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-broker-cancel'),
 ...bindingSchema.shape,sequence:z.number().int().min(1).max(4)}).strict();
const stopped=()=>new Error('Checkout broker IPC stopped; no retry; private details withheld.');
const bounded=(raw:unknown)=>{try{const bytes=Buffer.byteLength(JSON.stringify(raw));return bytes>0&&bytes<=65536;}catch{return false;}};
const bound=(raw:CheckoutIpcBinding,expected:CheckoutIpcBinding)=>raw.manifestDigest===expected.manifestDigest&&raw.connectionNonce===expected.connectionNonce;

/** The injected backend must independently verify provider proof and durable originals.
 * This server is only transport/admission, never evidence that Stripe settled. */
export function attachCheckoutBrokerParent(peer:CheckoutIpcPeer,rawBinding:unknown,backend:CheckoutMemberBroker){
 const binding=bindingSchema.parse(rawBinding),controller=new AbortController();
 let sequence=0,busy=false,closed=false,ackWritten=false;
 let phase:'initial'|'proof'|'intent'|'retained'='initial',proofDigest:string|undefined;
 let originalIntent:Readonly<Record<string,unknown>>|undefined,originalDurable:unknown;
 const close=()=>{if(closed)return;closed=true;controller.abort();
  peer.removeListener('message',message);peer.removeListener('disconnect',close);peer.removeListener('error',close);};
 const send=(value:unknown)=>{if(closed||!bounded(value)){close();return;}
  try{peer.send(value,error=>{if(error)close();});}catch{close();}};
 const message=(raw:unknown)=>{void dispatch(raw);};
 async function dispatch(raw:unknown){
  const cancellation=bounded(raw)?cancelSchema.safeParse(raw):undefined;
  if(cancellation?.success){close();return;}
  const parsed=bounded(raw)?requestSchema.safeParse(raw):undefined;
  if(closed||busy||!parsed?.success||!bound(parsed.data,binding)||parsed.data.sequence!==sequence+1){close();return;}
  const request=parsed.data;sequence=request.sequence;busy=true;
  try{
   let result:unknown;
   if(request.operation==='preSubmitProof'){
    if(phase!=='initial'||request.intent!==undefined||request.durable!==undefined)throw stopped();
    phase='proof';result=await backend.preSubmitProof(controller.signal);
    if(!result||typeof result!=='object'||!bounded(result))throw stopped();proofDigest=digest(result);
   }else if(request.operation==='writeIntent'){
    if(!request.intent||request.durable!==undefined||request.intent.manifestDigest!==binding.manifestDigest)throw stopped();
    if(request.intent.phase==='ack-intent'){
     if(phase!=='initial'||ackWritten)throw stopped();ackWritten=true;
    }else if(request.intent.phase==='submit-intent'){
     if(phase!=='proof'||request.intent.proofDigest!==proofDigest)throw stopped();phase='intent';
    }else throw stopped();
    const intent=Object.freeze(structuredClone(request.intent));result=await backend.writeIntent(intent,controller.signal);
    if(request.intent.phase==='submit-intent'){originalIntent=intent;originalDurable=structuredClone(result);}
   }else{
    if(phase!=='intent'||!isDeepStrictEqual(request.intent,originalIntent)||!isDeepStrictEqual(request.durable,originalDurable))throw stopped();
    phase='retained';result=await backend.retainSubmitIntent(originalIntent!,originalDurable,controller.signal);
   }
   if(controller.signal.aborted||closed)throw stopped();
   busy=false;send({protocol:1,kind:'checkout-broker-response',...binding,sequence:request.sequence,ok:true,result});
  }catch{
   busy=false;send({protocol:1,kind:'checkout-broker-response',...binding,sequence:request.sequence,ok:false});close();
  }
 }
 peer.on('message',message);peer.on('disconnect',close);peer.on('error',close);
 return{close,get closed(){return closed;},get phase(){return phase;}};
}

/** Member receives only scoped responses. All privileged backend work stays parent-side. */
export function createCheckoutBrokerClient(peer:CheckoutIpcPeer,rawBinding:unknown,timeoutMs=30000):CheckoutMemberBroker&{close():void}{
 const binding=bindingSchema.parse(rawBinding);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw stopped();
 let sequence=0,closed=false;
 let pending:{resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}|undefined;
 const close=()=>{if(closed)return;closed=true;const current=pending;pending=undefined;current?.cleanup();current?.reject(stopped());
  // Cancellation stops admitted parent work too. Never retry a timed-out request.
  if(sequence>0)try{peer.send({protocol:1,kind:'checkout-broker-cancel',...binding,sequence},()=>{});}catch{/* Channel already gone. */}
  peer.removeListener('message',message);peer.removeListener('disconnect',close);peer.removeListener('error',close);};
 const message=(raw:unknown)=>{
  const result=bounded(raw)?responseSchema.safeParse(raw):undefined;
  if(!pending||!result?.success||!bound(result.data,binding)||result.data.sequence!==sequence||!result.data.ok){close();return;}
  const current=pending;pending=undefined;current.cleanup();current.resolve(result.data.result);
 };
 const call=(operation:'writeIntent'|'retainSubmitIntent'|'preSubmitProof',signal:AbortSignal,intent?:Readonly<Record<string,unknown>>,durable?:unknown)=>{
  if(closed||pending||signal.aborted||sequence>=4){close();return Promise.reject(stopped());}
  const raw={protocol:1,kind:'checkout-broker-request',...binding,sequence:++sequence,operation,
   ...(intent===undefined?{}:{intent}),...(durable===undefined?{}:{durable})};
  if(!bounded(raw)||!requestSchema.safeParse(raw).success){close();return Promise.reject(stopped());}
  return new Promise<unknown>((resolve,reject)=>{
   const onAbort=()=>close(),timer=setTimeout(close,timeoutMs);
   pending={resolve,reject,cleanup:()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}};
   signal.addEventListener('abort',onAbort,{once:true});
   try{peer.send(raw,error=>{if(error)close();});}catch{close();}
  });
 };
 peer.on('message',message);peer.on('disconnect',close);peer.on('error',close);
 return{close,writeIntent:(intent,signal)=>call('writeIntent',signal,intent),
  retainSubmitIntent:async(intent,durable,signal)=>{
   const raw=await call('retainSubmitIntent',signal,intent,durable);
   const parsed=z.object({acknowledgment:z.unknown(),ciphertextDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(raw);
   if(!parsed.success){close();throw stopped();}return parsed.data;
  },preSubmitProof:signal=>call('preSubmitProof',signal)};
}
