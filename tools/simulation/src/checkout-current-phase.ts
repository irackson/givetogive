/** Pure phase binding; packets never prove that their root assertions were read
 * from a live job/provider or durably admitted. The native broker must do both. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateCurrentCheckoutProof,assertCurrentCheckoutSessionUnchanged,type CurrentCheckoutProof } from './checkout-current-input.ts';
import type { CurrentCheckoutProfile } from './checkout-current-profile.ts';
export const currentPhaseNames=['opening','fixture','notice','submission'] as const;
export type CurrentCheckoutPhase=typeof currentPhaseNames[number];
export const currentProfileDigest=(value:Readonly<CurrentCheckoutProfile>)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schema=z.object({protocol:z.literal(1),purpose:z.literal('current-member-phase-proof'),
 profileDigest:z.string().regex(/^[a-f0-9]{64}$/),phase:z.enum(currentPhaseNames),
 nonce:z.string().regex(/^[a-f0-9]{32}$/),admission:z.enum(['none','notice','submit']),
 proof:z.unknown(),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
const fail=():never=>{throw Error('Current member phase rejected; no retry or paid acceptance.');};
export function validateCurrentCheckoutPhase(raw:unknown,phase:CurrentCheckoutPhase,profile:Readonly<CurrentCheckoutProfile>,
 original:CurrentCheckoutProof,now:number,usedNonces:ReadonlySet<string>) {
 try {
  const packet=schema.parse(raw);
  if(packet.phase!==phase||packet.profileDigest!==currentProfileDigest(profile)||usedNonces.has(packet.nonce)||
   packet.admission!==(phase==='notice'?'notice':phase==='submission'?'submit':'none'))fail();
  const proof=validateCurrentCheckoutProof(packet.proof,profile,now);
  if(proof.customerAccountId!==original.customerAccountId)fail();
  assertCurrentCheckoutSessionUnchanged(original.checkout,proof.checkout);
  if(Date.parse(proof.checkout.verifiedAt)<Date.parse(original.checkout.verifiedAt))fail();
  return Object.freeze({...packet,proof});
 }catch{return fail();}
}
