/** Authenticated private handoff for the current ordinary-member worker.
 * Import is inert. No credential loading, file/transport IO, login, Checkout
 * preparation or payment. This codec validates bindings, not provider/job truth.
 * Only root's independent reads and durable admissions can establish authority.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { seal,unseal } from './hosted-community-bundle.ts';
import { approved } from './hosted-checkout-policy.ts';
import { checkoutContextSchema,type VerifiedCheckout } from './sandbox-policy.ts';
import { currentCheckoutCandidate as c,recheckCurrentCheckoutProfile,
 type CurrentCheckoutProfile } from './checkout-current-profile.ts';

const maximumClearBytes=32768,maximumCipherBytes=65536;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const proofSchema=z.object({platformAccountId:z.literal(approved.platformAccountId),customerAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),
 canonicalCustomerClockVerified:z.literal(true),providerIdentityVerified:z.literal(true),
 providerInvoiceAbsent:z.literal(true),providerSubscriptionAbsent:z.literal(true),
 checkout:checkoutContextSchema.strict()}).strict();
const envelope=z.object({protocol:z.literal(1),purpose:z.literal('current-cohort-private-member-input'),
 profile:z.unknown(),profileDigest:z.string().regex(/^[a-f0-9]{64}$/),
 member:z.object({id:z.literal(c.agentId),userId:z.literal(c.memberId),email:z.literal(c.memberEmail),
  password:z.string().min(12).max(512)}).strict(),
 stagingBypass:z.string().min(16).max(2048),
 proof:proofSchema,
 retryAllowed:z.literal(false),paymentAccepted:z.literal(false),
}).strict();
const fail=():never=>{throw Error('Current private Checkout input rejected; no admission or retry.');};
function guard(value:unknown):asserts value {if(!value)fail();}
function freeze(value:object){for(const v of Object.values(value))if(v&&typeof v==='object')freeze(v);Object.freeze(value);}
export function validateCurrentCheckoutProof(raw:unknown,profile:Readonly<CurrentCheckoutProfile>,now:number) {
 try {
  guard(Number.isFinite(now));const proof=proofSchema.parse(raw),checkout=proof.checkout;
  guard(checkout.environment==='staging'&&checkout.databaseIdentity===profile.databaseIdentity&&checkout.runId===profile.runId&&
   checkout.operationId===profile.operationId&&checkout.actorId===c.memberId&&checkout.returnOrigin===profile.origin&&
   checkout.livemode===false&&checkout.currency==='usd'&&checkout.amountTotal===500&&checkout.mode==='subscription'&&
   checkout.status==='open'&&checkout.paymentStatus==='unpaid'&&checkout.expiresAt*1000>now+15000);
  const age=now-Date.parse(checkout.verifiedAt);guard(age>=-5000&&age<=30000);
  const url=new URL(checkout.url);
  guard(url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password&&!url.search&&
   url.pathname===`/c/pay/${checkout.sessionId}`);
  freeze(proof);return proof;
 }catch{return fail();}
}
export type CurrentCheckoutProof=ReturnType<typeof validateCurrentCheckoutProof>;

export function validateCurrentCheckoutInput(raw:unknown,expected:Readonly<CurrentCheckoutProfile>,now:number) {
 try {
  const value=envelope.parse(raw);
  // The native waiting parent must already own the browser before root prepares
  // a Checkout. Initial profile admission checks startup; handoff retains the
  // runtime floor. This codec alone cannot prove that a browser was acquired.
  const profile=recheckCurrentCheckoutProfile(value.profile,expected,now);
  guard(value.profileDigest===hash(profile));
  const proof=validateCurrentCheckoutProof(value.proof,profile,now);
  const output={...value,profile,proof};freeze(output);return output;
 }catch{return fail();}
}
export type CurrentCheckoutInput=ReturnType<typeof validateCurrentCheckoutInput>;

export function encryptCurrentCheckoutInput(raw:unknown,key:Buffer,expected:Readonly<CurrentCheckoutProfile>,now:number) {
 let clear:Buffer|undefined;
 try {
  guard(Buffer.isBuffer(key)&&key.length===32);
  const value=validateCurrentCheckoutInput(raw,expected,now);clear=Buffer.from(JSON.stringify(value));
  guard(clear.length<=maximumClearBytes);const ciphertext=seal(value,key);
  if(ciphertext.length>maximumCipherBytes){ciphertext.fill(0);fail();}return ciphertext;
 }catch{return fail();}finally{clear?.fill(0);}
}
export function decryptCurrentCheckoutInput(bytes:Buffer,key:Buffer,expected:Readonly<CurrentCheckoutProfile>,now:number) {
 try {
  guard(Buffer.isBuffer(bytes)&&bytes.length>36&&bytes.length<=maximumCipherBytes&&Buffer.isBuffer(key)&&key.length===32);
  return validateCurrentCheckoutInput(unseal(bytes,key,maximumClearBytes),expected,now);
 }catch{return fail();}
}

/** Bind refreshed proofs to the same full session, including its opaque fragment.
 * A recent-looking timestamp cannot authorize a changed provider operation.
 */
export function assertCurrentCheckoutSessionUnchanged(original:VerifiedCheckout,current:VerifiedCheckout) {
 const {verifiedAt:_before,...before}=original,{verifiedAt:_after,...after}=current;
 guard(Object.keys(before).length===Object.keys(after).length&&
  Object.keys(before).every(key=>before[key as keyof typeof before]===after[key as keyof typeof after]));
}
