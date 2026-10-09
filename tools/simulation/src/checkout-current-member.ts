/** Explicit current-cohort ordinary-member adapter. Import is inert. Root owns
 * Stripe/SQL/atomic budgets; member gets only normal credentials and scoped phase
 * responses. No Checkout-creation API, model, CAPTCHA/wallet bypass or settlement
 * assertion. Injection is offline evidence only; native launch needs owned IPC.
 */
import { freemem } from 'node:os';
import { randomBytes } from 'node:crypto';
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile,type CurrentCheckoutSource } from './checkout-current-profile.ts';
import { validateCurrentCheckoutInput,validateCurrentCheckoutProof,type CurrentCheckoutInput,type CurrentCheckoutProof } from './checkout-current-input.ts';
import { currentProfileDigest,validateCurrentCheckoutPhase,type CurrentCheckoutPhase } from './checkout-current-phase.ts';
import { validateChildEnvironment,checkMemory } from './hosted-checkout-policy.ts';
import { StripeCheckoutDriver } from './stripe-checkout-driver.ts';
import { UiSession,type UiAccount } from './ui-session.ts';

const fail=():never=>{throw Error('Current member stopped; private details withheld; no retry.');};
function guard(value:unknown):asserts value{if(!value)fail();}
function object(raw:unknown):Record<string,unknown>{guard(raw&&typeof raw==='object'&&!Array.isArray(raw));return raw as Record<string,unknown>;}
export type CurrentMemberIdentity={userId:string;sessionVersion:number;observedAt:string;normalMemberOnly:true;billingManagementVerified:true};
export interface CurrentMemberBroker {
 phase(phase:CurrentCheckoutPhase,identity:CurrentMemberIdentity,signal:AbortSignal):Promise<unknown>;
}
type Session={readSession():Promise<unknown>;query(procedure:string,input:unknown):Promise<unknown>;close():Promise<void>};
type Driver=Pick<StripeCheckoutDriver,'prepareBrowser'|'preparedBrowserObservation'|'bindPreparedStagingAccess'|'open'|'fillFixture'|'submit'|'closeConfirmed'>;
export type CurrentMemberRuntime={now():number;driver(notice:()=>Promise<void>):Driver;signIn(account:UiAccount,bypass:string):Promise<Session>};
const queries=new Set(['billing.availability','billing.myOverview','billing.mySubscriptions','billing.payment']);
function nativeRuntime():CurrentMemberRuntime {
 return {now:Date.now,driver:notice=>new StripeCheckoutDriver('',c.memberEmail,notice),signIn:async(account,bypass)=>{
  const session=await UiSession.signIn(c.origin,account,bypass);
  return {async readSession(){const response=await session.context.get(`${c.origin}/api/auth/session`,{maxRedirects:0,maxRetries:0});
   try{guard(response.ok()&&response.url()===`${c.origin}/api/auth/session`);return await response.json();}finally{await response.dispose();}},
   query:(procedure,input)=>{guard(queries.has(procedure));return session.query(procedure,input);},close:()=>session.close()};
 }};
}
function sessionVersion(raw:unknown,now:number){const s=object(raw),u=object(s.user);
 guard(s.access==='active'&&u.id===c.memberId&&u.email===c.memberEmail&&u.role==='member'&&
  Number.isSafeInteger(u.sessionVersion)&&Number(u.sessionVersion)>=0&&typeof s.expires==='string'&&Date.parse(s.expires)>now+15000&&
  Number.isFinite(u.authenticatedAt)&&Number(u.authenticatedAt)<=now+5000);return Number(u.sessionVersion);}
/** Pure checks of actual cookie-session/billing reads. The caller must obtain
 * these through the member's own API context, not provider/admin observations. */
export function deriveCurrentMemberIdentity(before:unknown,after:unknown,availability:unknown,overview:unknown,
 subscriptions:unknown,payment:unknown,proof:CurrentCheckoutProof,now:number):CurrentMemberIdentity {
 guard(Number.isFinite(now));const first=sessionVersion(before,now),last=sessionVersion(after,now);
 const gates=object(availability),account=object(overview),owned=object(payment);
 guard(first===last&&gates.environment==='staging'&&gates.livemode===false&&gates.subscriptions===true&&
  gates.askPayments===false&&gates.funds===false&&account.tier==='neighbor'&&Array.isArray(account.subscriptions)&&
  account.subscriptions.length===0&&Array.isArray(subscriptions)&&subscriptions.length===0&&
  owned.id===c.operationId&&owned.kind==='supporter'&&owned.status==='checkout_open'&&owned.grossAmount===500&&
  owned.currency==='usd'&&owned.tier==='supporter'&&owned.recurring===true&&owned.livemode===false&&owned.paidAt===null&&
  owned.refundedAmount===0&&owned.disputedAmount===0&&(typeof owned.expiresAt==='string'||owned.expiresAt instanceof Date)&&
  Math.floor(new Date(owned.expiresAt as string|Date).getTime()/1000)===proof.checkout.expiresAt);
 return Object.freeze({userId:c.memberId,sessionVersion:last,observedAt:new Date(now).toISOString(),normalMemberOnly:true,billingManagementVerified:true});
}
type Prepared=Readonly<{profile:ReturnType<typeof validateCurrentCheckoutProfile>;ready:Readonly<{protocol:1;purpose:'current-member-browser-ready';
 connectionNonce:string;profileDigest:string;freeBytes:number;browserConnected:true;memberSignIns:0;paymentAccepted:false;retryAllowed:false;
 executionEvidence:'native-playwright-adapter'|'injected-offline'}>}>;
type Resource={runtime:CurrentMemberRuntime;driver:Driver;started:boolean;closed:boolean;injected:boolean;
 controller:AbortController;
 notice?:()=>Promise<void>;dispose?:Promise<Awaited<ReturnType<Driver['closeConfirmed']>>>;removeAbort():void};
const preparedResources=new WeakMap<Prepared,Resource>();
function dispose(resource:Resource){resource.closed=true;resource.controller.abort();resource.removeAbort();
 resource.dispose??=resource.driver.closeConfirmed();return resource.dispose;}

/** Acquire actual Chromium before any private input or financial UI preparation.
 * Parent must independently observe its child/process group and live GitHub job.
 */
export async function prepareCurrentCheckoutMember(raw:unknown,head:string,source:CurrentCheckoutSource,
 options:{signal:AbortSignal;runtime?:CurrentMemberRuntime}):Promise<Prepared> {
 const injected=options.runtime!==undefined,runtime=options.runtime??nativeRuntime();let resource:Resource|undefined;
 try{
  if(!injected){guard(process.platform==='linux'&&process.versions.node.split('.')[0]==='24'&&process.connected&&process.send);
   validateChildEnvironment(process.env);checkMemory(freemem(),true);}
  const profile=validateCurrentCheckoutProfile(raw,head,source,runtime.now());options.signal.throwIfAborted();
  let notice:(()=>Promise<void>)|undefined;
  const driver=runtime.driver(async()=>{guard(notice);await notice();});
  resource={runtime,driver,started:false,closed:false,injected,controller:new AbortController(),removeAbort:()=>{}};
  Object.defineProperty(resource,'notice',{get:()=>notice,set:value=>{notice=value;},configurable:false});
  await driver.prepareBrowser();options.signal.throwIfAborted();
  const observation=driver.preparedBrowserObservation();checkMemory(observation.freeBytes,false);
  guard(observation.browserConnected&&observation.contextAbsent&&observation.checkoutAbsent);
  const ready=Object.freeze({protocol:1 as const,purpose:'current-member-browser-ready' as const,connectionNonce:randomBytes(16).toString('hex'),
   profileDigest:currentProfileDigest(profile),freeBytes:observation.freeBytes,browserConnected:true as const,memberSignIns:0 as const,
   paymentAccepted:false as const,retryAllowed:false as const,executionEvidence:injected?'injected-offline' as const:'native-playwright-adapter' as const});
  const prepared=Object.freeze({profile,ready});preparedResources.set(prepared,resource);
  const owned=resource,abort=()=>{void dispose(owned).catch(()=>undefined);};options.signal.addEventListener('abort',abort,{once:true});
  resource.removeAbort=()=>options.signal.removeEventListener('abort',abort);
  if(options.signal.aborted){await dispose(resource);fail();}return prepared;
 }catch{if(resource)await dispose(resource).catch(()=>undefined);return fail();}
}
export async function closePreparedCurrentCheckoutMember(prepared:Prepared){const r=preparedResources.get(prepared);guard(r);return await dispose(r);}

export async function runCurrentCheckoutMember(prepared:Prepared,raw:unknown,broker:CurrentMemberBroker,requestedSignal:AbortSignal) {
 const resource=preparedResources.get(prepared);guard(resource&&!resource.started&&!resource.closed);resource.started=true;
 const signal=AbortSignal.any([requestedSignal,resource.controller.signal]);
 const runtime=resource.runtime,driver=resource.driver;let session:Session|undefined;
 let phase='input',failed=false,apiDisposed=true,driverClosed=false,memberSignIns=0,noticeRequests=0,submitAttempts=0;
 let observedSessionVersion:number|undefined;const nonces=new Set<string>();
 try{
  signal.throwIfAborted();const input:CurrentCheckoutInput=validateCurrentCheckoutInput(raw,prepared.profile,runtime.now());
  let lastProof=input.proof;
  phase='sign-in';memberSignIns++;session=await runtime.signIn(input.member,input.stagingBypass);apiDisposed=false;
  const identity=async(proof:CurrentCheckoutProof)=>{
   signal.throwIfAborted();const before=await session!.readSession(),availability=await session!.query('billing.availability',undefined),
    overview=await session!.query('billing.myOverview',undefined),subscriptions=await session!.query('billing.mySubscriptions',undefined),
    payment=await session!.query('billing.payment',{id:c.operationId}),after=await session!.readSession();signal.throwIfAborted();
   const value=deriveCurrentMemberIdentity(before,after,availability,overview,subscriptions,payment,proof,runtime.now());
   guard(observedSessionVersion===undefined||observedSessionVersion===value.sessionVersion);observedSessionVersion=value.sessionVersion;return value;
  };
  const fresh=async(stage:CurrentCheckoutPhase)=>{
   const member=await identity(lastProof),rawProof=await broker.phase(stage,member,signal);signal.throwIfAborted();
   const packet=validateCurrentCheckoutPhase(rawProof,stage,input.profile,lastProof,runtime.now(),nonces);
   nonces.add(packet.nonce);await identity(packet.proof);signal.throwIfAborted();
   lastProof=validateCurrentCheckoutProof(packet.proof,input.profile,runtime.now());return lastProof;
  };
  phase='opening';const opening=await fresh('opening');driver.bindPreparedStagingAccess(input.stagingBypass);
  await driver.open(opening.checkout);signal.throwIfAborted();
  phase='fixture';await fresh('fixture');resource.notice=async()=>{guard(noticeRequests===0);noticeRequests++;
   await fresh('notice');signal.throwIfAborted();};
  await driver.fillFixture('decline');signal.throwIfAborted();
  phase='submission';await fresh('submission');signal.throwIfAborted();submitAttempts++;
  await driver.submit();signal.throwIfAborted();phase='submitted-pending-independent-verification';
 }catch{failed=true;}
 finally{
  resource.notice=undefined;
  try{if(session){await session.close();apiDisposed=true;}}catch{failed=true;}
  try{const closure=await dispose(resource);driverClosed=closure.contextClosed&&closure.browserClosed;if(!driverClosed)failed=true;}catch{failed=true;}
 }
 return Object.freeze({protocol:1,purpose:'current-member-receipt',phase,failed,memberSignIns,noticeRequests,submitAttempts,apiDisposed,driverClosed,
  executionEvidence:resource.injected?'injected-offline':'native-playwright-adapter',paymentAccepted:false,retryAllowed:false,
  independentJobOsProviderLedgerVerificationRequired:true,privateDetailsWithheld:true});
}
