/** Local-only explicit GET reader. Import/constructor are inert. No env,
 * key loading, SQL writes, Checkout creation, grant, or submission. This does not
 * attest the root's DB/source/budget checks; those remain separate prerequisites. */
import type Stripe from 'stripe';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {approved,digest,limits,validateManifest,validateProof,type Proof} from './hosted-checkout-policy.ts';

export interface CheckoutProviderReads{
 platform():Promise<unknown>;
 balance():Promise<unknown>;
 customer(id:string):Promise<unknown>;
 clock(id:string):Promise<unknown>;
 invoices(customerAccountId:string):Promise<unknown>;
 subscriptions(customerAccountId:string):Promise<unknown>;
 checkout(id:string):Promise<unknown>;
}
/** Use an existing locally configured client; never replace its retry policy or
 * share its key. These exact seven SDK methods are reads, not mutation fallbacks. */
export function stripeCheckoutReads(stripe:Stripe):CheckoutProviderReads{
 return{platform:()=>stripe.accounts.retrieve(null),balance:()=>stripe.balance.retrieve(),
  customer:id=>stripe.v2.core.accounts.retrieve(id,{include:['configuration.customer']}),
  clock:id=>stripe.testHelpers.testClocks.retrieve(id),
  invoices:id=>stripe.invoices.list({customer_account:id,limit:1}),
  subscriptions:id=>stripe.subscriptions.list({customer_account:id,status:'all',limit:1}),
  checkout:id=>stripe.checkout.sessions.retrieve(id)};
}
const targetSchema=z.object({customerAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),
 clockId:z.string().regex(/^clock_[A-Za-z0-9]+$/),frozenTime:z.number().int().positive(),
 sessionId:z.string().regex(/^cs_test_[A-Za-z0-9]+$/)}).strict();
const platformSchema=z.object({id:z.literal(approved.platformAccountId)});
const balanceSchema=z.object({livemode:z.literal(false)});
const customerSchema=z.object({id:z.string(),livemode:z.literal(false),configuration:z.object({customer:z.object({test_clock:z.string()})})});
const clockSchema=z.object({id:z.string(),name:z.string(),livemode:z.literal(false),status:z.literal('ready'),frozen_time:z.number().int().positive()});
const emptyListSchema=z.object({data:z.array(z.unknown()).length(0),has_more:z.literal(false)});
const sessionSchema=z.object({id:z.string(),customer_account:z.string(),client_reference_id:z.literal(approved.operationId),
 livemode:z.literal(false),currency:z.literal('usd'),amount_total:z.literal(1500),mode:z.literal('subscription'),
 status:z.literal('open'),payment_status:z.literal('unpaid'),expires_at:z.number().int().positive(),
 success_url:z.string(),cancel_url:z.string(),url:z.string(),invoice:z.null(),subscription:z.null(),payment_intent:z.null()});
const stopped=()=>new Error('Local Checkout provider proof rejected; private details withheld; no automatic retry.');
export class LocalCheckoutProofReader{
 private manifest;
 private target;
 private opening?:Proof;
 private consumed=new Set<'open'|'pre-submit'>();
 private closed=false;
 private reads:CheckoutProviderReads;
 private now:()=>number;
 constructor(rawManifest:unknown,head:string,rawTarget:unknown,reads:CheckoutProviderReads,now=Date.now){
  this.reads=reads;this.now=now;
  this.manifest=validateManifest(rawManifest,head,now());this.target=targetSchema.parse(rawTarget);
 }
 async read(phase:'open'|'pre-submit',signal:AbortSignal):Promise<Proof>{
  const start=this.now();
  const active=()=>{if(this.closed||signal.aborted||!Number.isFinite(this.now())||this.now()<start||this.now()-start>limits.proofAgeMs)throw stopped();};
  try{
   active();if(!['open','pre-submit'].includes(phase)||this.consumed.has(phase)||(phase==='pre-submit'&&!this.opening))throw stopped();
   this.consumed.add(phase);validateManifest(this.manifest,this.manifest.job.headSha,start);
   const platform=platformSchema.parse(await this.reads.platform());active();
   const balance=balanceSchema.parse(await this.reads.balance());active();
   const customer=customerSchema.parse(await this.reads.customer(this.target.customerAccountId));active();
   const clock=clockSchema.parse(await this.reads.clock(this.target.clockId));active();
   if(platform.id!==approved.platformAccountId||balance.livemode!==false||customer.id!==this.target.customerAccountId
    ||customer.configuration.customer.test_clock!==this.target.clockId||clock.id!==this.target.clockId
    ||clock.name!==`givetogive:${this.manifest.runId}`||clock.frozen_time!==this.target.frozenTime)throw stopped();
   // A null pointer on this Checkout alone does not prove the customer has no
   // existing orphan/provider-only subscription or invoice. Inspect both lists.
   emptyListSchema.parse(await this.reads.invoices(customer.id));active();
   emptyListSchema.parse(await this.reads.subscriptions(customer.id));active();
   const session=sessionSchema.parse(await this.reads.checkout(this.target.sessionId));active();
   if(session.id!==this.target.sessionId||session.customer_account!==customer.id)throw stopped();
   // Timestamp the START of this round, not its end; a slow read cannot freshen stale evidence.
   const proof=validateProof({protocol:1,kind:'local-operator-provider-read',phase,proofNonce:randomBytes(16).toString('hex'),
    manifestDigest:digest(this.manifest),jobId:this.manifest.job.id,jobNonce:this.manifest.job.nonce,headSha:this.manifest.job.headSha,
    runId:this.manifest.runId,actorId:this.manifest.actorId,operationId:this.manifest.operationId,verifiedAt:new Date(start).toISOString(),
    platformAccountId:platform.id,databaseIdentity:this.manifest.databaseIdentity,customerAccountId:customer.id,
    sessionId:session.id,url:session.url,livemode:false,currency:session.currency,amountTotal:session.amount_total,
    mode:session.mode,status:session.status,paymentStatus:session.payment_status,expiresAt:session.expires_at,
    successUrl:session.success_url,cancelUrl:session.cancel_url,providerIdentityVerified:true,canonicalCustomerClockVerified:true,
    providerInvoiceAbsent:true,providerSubscriptionAbsent:true},this.manifest,phase,this.now(),this.opening);
   if(phase==='open')this.opening=Object.freeze(proof);return structuredClone(proof);
  }catch{this.closed=true;throw stopped();}
 }
 close(){this.closed=true;}
}
