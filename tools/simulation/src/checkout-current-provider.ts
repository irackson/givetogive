/** Explicit local GET reader for the current declined Checkout. Constructor and
 * import are inert. No SDK/key loading, preparation, clock advance or mutation.
 * Native controller must independently verify canonical DB ownership/live job.
 * Supplied read adapters may be offline; their results alone prove no payment. */
import { z } from 'zod';
import type { CheckoutProviderReads } from './checkout-provider-proof.ts';
import { validateCurrentCheckoutInput,validateCurrentCheckoutProof,assertCurrentCheckoutSessionUnchanged,type CurrentCheckoutInput } from './checkout-current-input.ts';
import { currentPhaseNames,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
const targetSchema=z.object({customerAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),clockId:z.string().regex(/^clock_[A-Za-z0-9]+$/),
 frozenTime:z.number().int().positive(),sessionId:z.string().regex(/^cs_test_[A-Za-z0-9]+$/)}).strict();
const customerSchema=z.object({id:z.string(),livemode:z.literal(false),configuration:z.object({customer:z.object({test_clock:z.string()})})});
const clockSchema=z.object({id:z.string(),name:z.string(),livemode:z.literal(false),status:z.literal('ready'),frozen_time:z.number().int().positive()});
const emptyList=z.object({data:z.array(z.unknown()).length(0),has_more:z.literal(false)});
const sessionSchema=z.object({id:z.string(),customer_account:z.string(),client_reference_id:z.string(),livemode:z.literal(false),currency:z.literal('usd'),
 amount_total:z.literal(500),mode:z.literal('subscription'),status:z.literal('open'),payment_status:z.literal('unpaid'),expires_at:z.number().int().positive(),
 success_url:z.string(),cancel_url:z.string(),url:z.string(),invoice:z.null(),subscription:z.null(),payment_intent:z.null()});
const fail=()=>new Error('Current provider proof rejected; private details withheld; no retry.');
function guard(value:unknown):asserts value{if(!value)throw fail();}
function next(previous:CurrentCheckoutPhase|undefined,phase:CurrentCheckoutPhase){return previous===undefined?phase==='opening':previous==='opening'?phase==='fixture':
 previous==='fixture'?phase==='notice'||phase==='submission':previous==='notice'?phase==='submission':false;}
export class CurrentCheckoutProofReader {
 private readonly input:CurrentCheckoutInput;private readonly target:z.infer<typeof targetSchema>;private readonly reads:CheckoutProviderReads;private readonly now:()=>number;
 private previous?:CurrentCheckoutPhase;private closed=false;private busy=false;
 constructor(raw:unknown,target:unknown,reads:CheckoutProviderReads,now=Date.now){guard(raw&&typeof raw==='object'&&'profile' in raw);
  this.input=validateCurrentCheckoutInput(raw,(raw as CurrentCheckoutInput).profile,now());this.target=targetSchema.parse(target);this.reads=reads;this.now=now;
  guard(this.target.customerAccountId===this.input.proof.customerAccountId&&this.target.sessionId===this.input.proof.checkout.sessionId);
 }
 async read(phase:CurrentCheckoutPhase,signal:AbortSignal){const start=this.now();
  const active=()=>{guard(!this.closed&&!signal.aborted&&Number.isFinite(this.now())&&this.now()>=start&&this.now()-start<=30000);};
  try{active();guard(currentPhaseNames.includes(phase)&&!this.busy&&next(this.previous,phase));this.busy=true;this.previous=phase;
   const platform=z.object({id:z.string()}).parse(await this.reads.platform());active();guard(platform.id===this.input.proof.platformAccountId);
   z.object({livemode:z.literal(false)}).parse(await this.reads.balance());active();
   const customer=customerSchema.parse(await this.reads.customer(this.target.customerAccountId));active();
   const clock=clockSchema.parse(await this.reads.clock(this.target.clockId));active();
   guard(customer.id===this.target.customerAccountId&&customer.configuration.customer.test_clock===this.target.clockId&&clock.id===this.target.clockId&&
    clock.name===`givetogive:${this.input.profile.runId}`&&clock.frozen_time===this.target.frozenTime);
   emptyList.parse(await this.reads.invoices(customer.id));active();emptyList.parse(await this.reads.subscriptions(customer.id));active();
   const session=sessionSchema.parse(await this.reads.checkout(this.target.sessionId));active();
   const p=this.input.profile;
   guard(session.id===this.target.sessionId&&session.customer_account===customer.id&&session.client_reference_id===p.operationId&&
    session.success_url===`${p.origin}/giving/${p.operationId}?checkout=returned`&&session.cancel_url===`${p.origin}/giving/${p.operationId}?checkout=canceled`);
   const proof=validateCurrentCheckoutProof({platformAccountId:platform.id,customerAccountId:customer.id,canonicalCustomerClockVerified:true,providerIdentityVerified:true,
    providerInvoiceAbsent:true,providerSubscriptionAbsent:true,checkout:{...this.input.proof.checkout,url:session.url,expiresAt:session.expires_at,verifiedAt:new Date(start).toISOString()}},p,this.now());
   assertCurrentCheckoutSessionUnchanged(this.input.proof.checkout,proof.checkout);this.busy=false;return proof;
  }catch{this.close();throw fail();}
 }
 close(){this.closed=true;}
}
