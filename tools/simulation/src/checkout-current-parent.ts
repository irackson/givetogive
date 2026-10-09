/** Current ordinary-member process owner. Import is inert. No provider/SQL,
 * credential loading, admission, transport dispatch or payment acceptance.
 * Native bootstrap/root must independently bind the live GitHub job and retain
 * final encrypted evidence. Runtime injection is never native evidence. */
import { fork,type ChildProcess } from 'node:child_process';
import { dirname,join,resolve,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { existsSync,lstatSync,realpathSync,readlinkSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { z } from 'zod';
import { validateCurrentCheckoutProfile,type CurrentCheckoutSource } from './checkout-current-profile.ts';
import { currentProfileDigest } from './checkout-current-phase.ts';
import { validateCurrentCheckoutInput } from './checkout-current-input.ts';
import { attachCurrentMemberParent } from './checkout-current-ipc.ts';
import type { CheckoutIpcPeer } from './checkout-broker-ipc.ts';
import type { CurrentMemberBroker } from './checkout-current-member.ts';
import { checkMemory,validateChildEnvironment } from './hosted-checkout-policy.ts';
import { checkoutParentSourceSnapshot } from './hosted-checkout-parent.ts';
import { CheckoutProcessObservation,readCheckoutProcessTable,type CheckoutProcessIdentity } from './checkout-process-observation.ts';

const fail=()=>new Error('Current Checkout parent stopped; no retry; private details withheld.');
function guard(value:unknown):asserts value{if(!value)throw fail();}
const readySchema=z.object({protocol:z.literal(1),purpose:z.literal('current-member-browser-ready'),connectionNonce:z.string().regex(/^[a-f0-9]{32}$/),
 profileDigest:z.string().regex(/^[a-f0-9]{64}$/),freeBytes:z.number().finite(),browserConnected:z.literal(true),memberSignIns:z.literal(0),
 paymentAccepted:z.literal(false),retryAllowed:z.literal(false),executionEvidence:z.enum(['native-playwright-adapter','injected-offline'])}).strict();
const workerSchema=z.object({protocol:z.literal(1),purpose:z.literal('current-member-receipt'),phase:z.enum(['input','sign-in','opening','fixture','submission','submitted-pending-independent-verification']),failed:z.boolean(),
 executionEvidence:z.enum(['native-playwright-adapter','injected-offline']),memberSignIns:z.number().int().min(0).max(1),
 noticeRequests:z.number().int().min(0).max(1),submitAttempts:z.number().int().min(0).max(1),apiDisposed:z.boolean(),driverClosed:z.boolean(),
 independentJobOsProviderLedgerVerificationRequired:z.literal(true),privateDetailsWithheld:z.literal(true),paymentAccepted:z.literal(false),retryAllowed:z.literal(false)}).strict();
export interface CurrentParentRuntime {
 now():number;freeBytes():number;parentPid:number;pause(milliseconds:number):Promise<unknown>;
 launch(environment:Record<string,string>):ChildProcess;
 processes():CheckoutProcessIdentity[];
 browserExecutable(row:CheckoutProcessIdentity):boolean;
 verifySources(head:string,source:CurrentCheckoutSource):void;
}
function nativeRuntime():CurrentParentRuntime{
 const full=chromium.executablePath(),folder=dirname(dirname(full)),cache=dirname(folder);
 const revision=basename(folder).match(/^chromium-([0-9]+)$/)?.[1];
 const candidates=[full,...(revision?[join(cache,`chromium_headless_shell-${revision}`,'chrome-headless-shell-linux64','chrome-headless-shell')]:[])];
 return {now:Date.now,freeBytes:freemem,parentPid:process.pid,pause:milliseconds=>sleep(milliseconds),processes:readCheckoutProcessTable,
  launch:environment=>fork(fileURLToPath(new URL('./checkout-current-member-entry.mjs',import.meta.url)),['--execute-current-member'],
   {cwd:fileURLToPath(new URL('../',import.meta.url)),execArgv:['--experimental-strip-types'],detached:true,env:environment,
    stdio:['ignore','pipe','pipe','ipc'],serialization:'json'}),
  browserExecutable:row=>{try{const actual=readlinkSync(`/proc/${row.pid}/exe`);return candidates.some(path=>existsSync(path)&&lstatSync(path).isFile()&&realpathSync(path)===actual);}catch{return false;}},
  verifySources:(head,source)=>{const actual=checkoutParentSourceSnapshot(head);guard(Object.keys(actual).every(key=>actual[key as keyof typeof actual]===source[key as keyof CurrentCheckoutSource]));},
 };
}
function contained(path:string){for(let cursor=path;;cursor=dirname(cursor)){if(existsSync(cursor))guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);if(dirname(cursor)===cursor)break;}}
function flushDirectory(directory:string){if(process.platform==='linux'){const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}}}
function retain(directory:string,name:string,value:unknown){contained(directory);guard(/^[a-z-]+\.json$/.test(name));const path=join(directory,name),bytes=Buffer.from(JSON.stringify(value));
 guard(bytes.length<=65536);const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}flushDirectory(directory);guard(readFileSync(path).equals(bytes));}
type Prepared=Readonly<{profile:ReturnType<typeof validateCurrentCheckoutProfile>;ready:Readonly<z.infer<typeof readySchema>>;
 parentEvidence:'native-linux-parent'|'injected-offline';browserExecutableObserved:true;paymentAccepted:false;retryAllowed:false}>;
type Cleanup={ownedGroupClosed:boolean;exitObserved:boolean;exitCode:number|null;publicOutputBytes:number;escapedDescendantObserved:boolean;paymentAccepted:false;retryAllowed:false};
type Resource={runtime:CurrentParentRuntime;source:CurrentCheckoutSource;head:string;directory:string;child:ChildProcess;root:CheckoutProcessIdentity;
 observation:CheckoutProcessObservation;profile:Prepared['profile'];ready?:Prepared['ready'];receipt?:z.infer<typeof workerSchema>;
 expectedInputDigest?:string;started:boolean;stopped:boolean;exited:boolean;exitCode:number|null;failed:boolean;outputBytes:number;
 controller:AbortController;signal:AbortSignal;interval?:ReturnType<typeof setInterval>;broker?:ReturnType<typeof attachCurrentMemberParent>;
 message:(raw:unknown)=>void;removeAbort():void;cleanup?:Promise<Cleanup>;injected:boolean};
const resources=new WeakMap<Prepared,Resource>();
const live=(row:CheckoutProcessIdentity)=>!['Z','X','x'].includes(row.state??'');
function sample(resource:Resource){const table=resource.runtime.processes();const closure=resource.observation.inspect(table);
 guard(!closure.escapedDescendantObserved);return {table,closure,rootLive:table.some(row=>row.pid===resource.root.pid&&row.startTicks===resource.root.startTicks&&live(row))};}
function active(resource:Resource){resource.signal.throwIfAborted();checkMemory(resource.runtime.freeBytes(),false);
 resource.runtime.verifySources(resource.head,resource.source);const state=sample(resource);guard(state.rootLive&&!resource.exited&&!resource.failed&&resource.outputBytes===0);return state;}
function browserObserved(resource:Resource){const {table}=active(resource);const descendants=new Set([resource.root.pid]);
 for(let depth=0;depth<64;depth++){let added=false;for(const row of table)if(descendants.has(row.parentPid)&&!descendants.has(row.pid)){descendants.add(row.pid);added=true;}if(!added)break;guard(depth<63);}
 const matches=table.filter(row=>row.pid!==resource.root.pid&&descendants.has(row.pid)&&row.processGroup===resource.root.processGroup&&row.session===resource.root.session&&live(row)&&resource.runtime.browserExecutable(row));
 guard(matches.length>0);const after=active(resource).table;
 guard(matches.some(before=>after.some(row=>row.pid===before.pid&&row.startTicks===before.startTicks&&live(row)&&resource.runtime.browserExecutable(row))));
}
function stop(resource:Resource){if(resource.stopped)return;resource.stopped=true;resource.controller.abort();resource.broker?.close();
 try{const current=resource.runtime.processes().find(row=>row.pid===resource.root.pid);if(current?.startTicks===resource.root.startTicks&&live(current))resource.child.kill('SIGTERM');else if(resource.child.connected)resource.child.disconnect();}catch{/* Never signal an unobserved/reused PID. */}}
function close(resource:Resource){resource.cleanup??=(async()=>{resource.removeAbort();if(resource.interval)clearInterval(resource.interval);stop(resource);const until=resource.runtime.now()+35000;
 let closure:ReturnType<CheckoutProcessObservation['inspect']>|undefined;
 do{try{closure=sample(resource).closure;if(closure.ownedGroupClosed)break;}catch{resource.failed=true;break;}await resource.runtime.pause(25);}while(resource.runtime.now()<until);
 resource.removeAbort();resource.child.removeListener('message',resource.message);
 return {ownedGroupClosed:closure?.ownedGroupClosed===true,exitObserved:resource.exited,exitCode:resource.exitCode,publicOutputBytes:resource.outputBytes,
    escapedDescendantObserved:closure?.escapedDescendantObserved??true,paymentAccepted:false as const,retryAllowed:false as const};})();return resource.cleanup;}
async function send(resource:Resource,value:unknown){active(resource);guard(Buffer.byteLength(JSON.stringify(value))<=65536);
 await new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>reject(fail()),5000);try{(resource.child as unknown as CheckoutIpcPeer).send(value,error=>{clearTimeout(timer);if(error)reject(fail());else accept();});}catch{clearTimeout(timer);reject(fail());}});if(!resource.exited)active(resource);else guard(resource.receipt&&!resource.failed);}

/** One durable operation-wide launch, public profile first. No private input or
 * root financial preparation occurs inside this function. */
export async function prepareCurrentCheckoutParent(raw:unknown,head:string,source:CurrentCheckoutSource,options:{root:string;memberEnvironment:unknown;signal:AbortSignal;runtime?:CurrentParentRuntime}):Promise<Prepared>{
 const injected=options.runtime!==undefined,runtime=options.runtime??nativeRuntime();let resource:Resource|undefined,child:ChildProcess|undefined;
 try{
  if(!injected)guard(process.platform==='linux'&&process.versions.node.split('.')[0]==='24');
  const profile=validateCurrentCheckoutProfile(raw,head,source,runtime.now()),environment=validateChildEnvironment(options.memberEnvironment);
  runtime.verifySources(head,source);checkMemory(runtime.freeBytes(),true);options.signal.throwIfAborted();
  const directory=join(resolve(options.root),`current-checkout-${profile.runId}-${profile.operationId}`);contained(directory);guard(lstatSync(dirname(directory)).isDirectory());
  mkdirSync(directory,{mode:0o700});flushDirectory(dirname(directory));retain(directory,'launch-lease.json',{profileDigest:currentProfileDigest(profile),head,source,maximumMemberLaunches:1,paymentAccepted:false,retryAllowed:false});
  child=runtime.launch(environment);guard(child.pid);let root:CheckoutProcessIdentity|undefined;const start=runtime.now();
  while(!root&&runtime.now()-start<5000){root=runtime.processes().find(row=>row.pid===child!.pid);if(!root)await runtime.pause(25);}guard(root);
  const controller=new AbortController(),signal=AbortSignal.any([options.signal,controller.signal,AbortSignal.timeout(900000)]);
  resource={runtime,source,head,directory,child,root,observation:new CheckoutProcessObservation(root,runtime.parentPid),profile,
   started:false,stopped:false,exited:false,exitCode:null,failed:false,outputBytes:0,controller,signal,message:()=>{},removeAbort:()=>{},injected};
  const owned=resource;
  child.on('exit',code=>{owned.exitCode=code;owned.exited=true;});child.on('error',()=>{owned.failed=true;stop(owned);});
  const unexpected=(bytes:Buffer)=>{owned.outputBytes+=bytes.length;owned.failed=true;stop(owned);};child.stdout?.on('data',unexpected);child.stderr?.on('data',unexpected);
  owned.message=raw=>{try{guard(Buffer.byteLength(JSON.stringify(raw))<=65536);const envelope=z.object({protocol:z.literal(1),kind:z.string()}).passthrough().parse(raw);
   if(envelope.kind==='current-member-ready'){guard(!owned.ready&&!owned.started);const value=z.object({protocol:z.literal(1),kind:z.literal('current-member-ready'),ready:readySchema}).strict().parse(raw).ready;
    guard(value.profileDigest===currentProfileDigest(profile)&&value.executionEvidence===(injected?'injected-offline':'native-playwright-adapter'));checkMemory(value.freeBytes,false);browserObserved(owned);owned.ready=Object.freeze(value);}
   else if(envelope.kind==='current-member-receipt'){guard(owned.started&&!owned.receipt&&owned.ready);const value=z.object({protocol:z.literal(1),kind:z.literal('current-member-receipt'),
    connectionNonce:z.literal(owned.ready.connectionNonce),profileDigest:z.literal(owned.expectedInputDigest!),receipt:workerSchema}).strict().parse(raw);
    guard(value.receipt.executionEvidence===(injected?'injected-offline':'native-playwright-adapter'));retain(directory,'worker-receipt.json',value.receipt);owned.receipt=value.receipt;}
   else guard(owned.started&&['current-member-phase-request','current-member-cancel'].includes(envelope.kind));
  }catch{owned.failed=true;stop(owned);}};
  child.on('message',owned.message);const aborted=()=>{stop(owned);void close(owned).catch(()=>{owned.failed=true;});};signal.addEventListener('abort',aborted,{once:true});owned.removeAbort=()=>signal.removeEventListener('abort',aborted);
  owned.interval=setInterval(()=>{if(owned.exited)return;try{active(owned);}catch{owned.failed=true;stop(owned);}},100);
  await send(owned,{protocol:1,kind:'current-member-prepare',headSha:head,source,profile});
  const until=runtime.now()+45000;while(!owned.ready&&runtime.now()<until){active(owned);await runtime.pause(25);}guard(owned.ready);browserObserved(owned);
  retain(directory,'browser-readiness.json',{ready:owned.ready,parentEvidence:injected?'injected-offline':'native-linux-parent',browserExecutableObserved:true,liveGitHubRootReviewStillRequired:true,paymentAccepted:false});
  const prepared=Object.freeze({profile,ready:owned.ready,parentEvidence:injected?'injected-offline' as const:'native-linux-parent' as const,browserExecutableObserved:true as const,paymentAccepted:false as const,retryAllowed:false as const});
  resources.set(prepared,owned);return prepared;
 }catch{if(resource)await close(resource);else if(child?.connected)child.disconnect();throw fail();}
}
export async function closePreparedCurrentCheckoutParent(prepared:Prepared){const resource=resources.get(prepared);guard(resource);return close(resource);}
/** Only the root's separately reviewed fresh private input is transferred. The
 * backend must make its own durable provider/admission decisions at every phase. */
export async function runCurrentCheckoutParent(prepared:Prepared,raw:unknown,backend:CurrentMemberBroker){const resource=resources.get(prepared);guard(resource&&!resource.started&&!resource.stopped);resource.started=true;
 let failed=false;
 try{browserObserved(resource);const input=validateCurrentCheckoutInput(raw,prepared.profile,resource.runtime.now());resource.expectedInputDigest=input.profileDigest;
  retain(resource.directory,'input-transfer-intent.json',{profileDigest:input.profileDigest,connectionNonce:prepared.ready.connectionNonce,privateInputRetained:false,paymentAccepted:false,retryAllowed:false});
  resource.broker=attachCurrentMemberParent(resource.child as unknown as CheckoutIpcPeer,{profileDigest:input.profileDigest,connectionNonce:prepared.ready.connectionNonce},
   {phase:async(phase,identity,signal)=>{active(resource);const result=await backend.phase(phase,identity,AbortSignal.any([signal,resource.signal]));active(resource);return result;}},resource.runtime.now);
  await send(resource,{protocol:1,kind:'current-member-input',connectionNonce:prepared.ready.connectionNonce,input});
  while(!resource.exited){if(resource.receipt)resource.signal.throwIfAborted();else active(resource);await resource.runtime.pause(25);}
  guard(resource.exitCode===0&&resource.receipt&&!resource.receipt.failed&&resource.receipt.phase==='submitted-pending-independent-verification'&&resource.receipt.apiDisposed&&resource.receipt.driverClosed&&
   resource.receipt.memberSignIns===1&&resource.receipt.submitAttempts===1&&resource.broker.lastPhase==='submission'&&!resource.failed&&resource.outputBytes===0);
 }catch{failed=true;stop(resource);}
 const cleanup=await close(resource);
 const result={protocol:1,purpose:'current-checkout-parent',failed:failed||!cleanup.ownedGroupClosed||!cleanup.exitObserved,
  executionEvidence:prepared.parentEvidence,worker:resource.receipt??null,cleanup,independentRootProviderLedgerReviewRequired:true,
  privateFinalRetentionStillRequired:true,paymentAccepted:false,retryAllowed:false};retain(resource.directory,'parent-receipt.json',result);return result;
}
