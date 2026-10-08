/** Encrypted private proof exchange contract. No IO/env/provider/worker action.
 * The runtime must durably retain originals and verify private readback before
 * using these bytes. Crypto/contract tests are not remote retention evidence. */
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {seal,unseal} from './hosted-community-bundle.ts';
import {digest,validateManifest,validateProof,type Manifest,type Proof} from './hosted-checkout-policy.ts';
const requestSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-pre-submit-proof-request'),
 manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),requestNonce:z.string().regex(/^[a-f0-9]{32}$/),
 openingProofDigest:z.string().regex(/^[a-f0-9]{64}$/),requestedAt:z.iso.datetime(),
 maximumResponses:z.literal(1),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
export type CheckoutProofRequest=z.infer<typeof requestSchema>;
const responseSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-pre-submit-proof-response'),
 manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),requestNonce:z.string().regex(/^[a-f0-9]{32}$/),
 requestDigest:z.string().regex(/^[a-f0-9]{64}$/),proof:z.unknown(),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
const fail=():never=>{throw Error('Checkout encrypted proof exchange rejected; private details withheld.');};
const guard=(value:unknown)=>{if(!value)fail();};
function context(manifest:Manifest,now:number){validateManifest(manifest,manifest.job.headSha,now);}
function validOpening(opening:Proof,manifest:Manifest,now:number){
 // Recheck the ORIGINAL proof's schema/binding at its own retained observation
 // time. It need not remain fresh after card entry; the response must be fresh.
 const observed=Date.parse(opening.verifiedAt);guard(Number.isFinite(observed)&&observed<=now+5000);
 validateProof(opening,manifest,'open',observed);
}
function validRequest(raw:unknown,manifest:Manifest,opening:Proof,now:number){
 context(manifest,now);validOpening(opening,manifest,now);const value=requestSchema.parse(raw),age=now-Date.parse(value.requestedAt);
 guard(value.manifestDigest===digest(manifest)&&value.openingProofDigest===digest(opening)&&age>=-5000&&age<=30000);
 return value;
}
function open(bytes:Buffer,key:Buffer):unknown{
 guard(Buffer.isBuffer(key)&&key.length===32&&Buffer.isBuffer(bytes)&&bytes.length>36&&bytes.length<=16384);
 try{return unseal(bytes,key);}catch{return fail();}
}
function encrypted(raw:unknown,key:Buffer){
 guard(Buffer.isBuffer(key)&&key.length===32);const bytes=seal(raw,key);
 guard(bytes.length<=16384);return bytes;
}
export function createProofRequest(manifest:Manifest,opening:Proof,key:Buffer,now:number){
 try{context(manifest,now);validOpening(opening,manifest,now);
  const request=requestSchema.parse({protocol:1,kind:'checkout-pre-submit-proof-request',manifestDigest:digest(manifest),
   requestNonce:randomBytes(16).toString('hex'),openingProofDigest:digest(opening),requestedAt:new Date(now).toISOString(),
   maximumResponses:1,paymentAccepted:false,retryAllowed:false});
  return{request,ciphertext:encrypted(request,key)};
 }catch{return fail();}
}
export function decodeProofRequest(bytes:Buffer,key:Buffer,manifest:Manifest,opening:Proof,now:number):CheckoutProofRequest{
 try{return validRequest(open(bytes,key),manifest,opening,now);}catch{return fail();}
}
export function createProofResponse(rawRequest:unknown,manifest:Manifest,opening:Proof,rawProof:unknown,key:Buffer,now:number){
 try{const request=validRequest(rawRequest,manifest,opening,now),proof=validateProof(rawProof,manifest,'pre-submit',now,opening);
  guard(Date.parse(proof.verifiedAt)>=Date.parse(request.requestedAt));
  return encrypted({protocol:1,kind:'checkout-pre-submit-proof-response',manifestDigest:digest(manifest),
   requestNonce:request.requestNonce,requestDigest:digest(request),proof,paymentAccepted:false,retryAllowed:false},key);
 }catch{return fail();}
}
export function decodeProofResponse(bytes:Buffer,key:Buffer,rawRequest:unknown,manifest:Manifest,opening:Proof,now:number):Proof{
 try{const request=validRequest(rawRequest,manifest,opening,now),response=responseSchema.parse(open(bytes,key));
  guard(response.manifestDigest===digest(manifest)&&response.requestNonce===request.requestNonce&&response.requestDigest===digest(request));
  const proof=validateProof(response.proof,manifest,'pre-submit',now,opening);
  guard(Date.parse(proof.verifiedAt)>=Date.parse(request.requestedAt));return proof;
 }catch{return fail();}
}
