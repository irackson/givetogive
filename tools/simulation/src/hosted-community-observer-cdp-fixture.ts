// Credential-free transport fixture only. Inert import; never opens project/private files.
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { freemem } from 'node:os';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { jsonlStreamProducer } from '@trpc/server/unstable-core-do-not-import';
import superjson from 'superjson';
import { ObserverNetwork, type QueryCapture } from './hosted-community-observer-network.ts';
import { ObserverCancellation, boundedObserverCleanup, observerQueryResponses } from './hosted-community-observer.ts';
import { allowedObserverRequest, type ObserverInput } from './hosted-community-observer-evidence.ts';
import { validObserverNetworkDiagnostics } from './hosted-community-observer-parent.ts';

const guard=(condition:unknown)=>{if(!condition)throw Error('Credential-free CDP fixture failed; details withheld.');};
/** Deliberately NOT an admissible full observer input: loopback, public identities, no auth. */
export function loopbackObserverFixtureInput(origin:string):ObserverInput {
 const address=new URL(origin);
 guard(address.protocol==='http:'&&address.hostname==='127.0.0.1'&&Number(address.port)>0
  &&address.origin===origin&&!address.username&&!address.password&&!address.search&&!address.hash);
 return {origin,runId:'11111111-1111-4111-8111-111111111111',databaseIdentity:'public-loopback-fixture',
  admin:{userId:'public-fixture-admin'},cohort:[{id:'public-fixture-member',userId:'public-fixture-member'}]} as unknown as ObserverInput;
}
export function allowedFixtureRequest(address:string,method:string,input:ObserverInput):boolean {
 try{const value=new URL(address);return method==='GET'&&value.origin===input.origin&&!value.username&&!value.password&&!value.hash
  &&((value.pathname==='/'&&!value.search)||value.pathname==='/api/trpc/admin.activity'&&allowedObserverRequest(address,method,input));}
 catch{return false;}
}
export async function publicFixtureBody(input:ObserverInput) {
 const value={items:[{id:1,runId:input.runId,actorId:input.cohort[0]!.userId,
  occurredAt:new Date('2026-10-04T01:00:00Z'),createdAt:new Date('2026-10-04T01:00:00.100Z')}],observedAt:new Date('2026-10-04T01:00:00.200Z')};
 return Buffer.from(await new Response(jsonlStreamProducer({data:{'0':Promise.resolve({result:Promise.resolve({data:Promise.resolve(value)})})},serialize:superjson.serialize})).arrayBuffer());
}
export function assertFixtureTransportProof(captures:QueryCapture[],issues:string[],network:ObserverNetwork['diagnostics']) {
 guard(captures.length===1&&captures[0]!.termination==='proved-query-abort'&&captures[0]!.bytes>0
  &&network.rawFailedRequests===2&&network.expectedSuccessfulQueryAborts===1&&network.unqualifiedFailedRequests===1
  &&network.rawBodyFailures===1&&network.decodedQueries===1&&network.captureUnavailable===0&&network.capacityFailures===0
  &&network.nonSuccessResponses===0&&network.failures.aborted===2&&network.failures.timeout===0&&network.failures.other===0
  &&network.captureStages.decode===1&&issues.length===2&&issues.filter(value=>value==='request').length===1&&issues.filter(value=>value==='body').length===1);
}
/** Single bounded child JSON proof only; rejects arbitrary fields/logs and keeps actual raw totals. */
export function parseFixtureChildProof(stdout:Uint8Array,stderrBytes:number,exitCode:number|null):Record<string,unknown> {
 guard(stdout.byteLength>0&&stdout.byteLength<=65536&&stderrBytes===0&&exitCode===0);
 const raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stdout));
 guard(raw&&typeof raw==='object'&&!Array.isArray(raw));const value=raw as Record<string,unknown>;
 const keys=['protocolVersion','purpose','actualCdpCapture','completedQueryAbortProved','genuinePartialFailureRetained','externalRequests',
  'memberSignIns','dashboardAcceptance','localQueries','networkDiagnostics','consoleErrors','pageErrors','blockedRequests','minimumFreeGiB',
  'cleanupComplete','contextClosed','localServerClosed','callerOwnsBrowser','browserClosed'];
 guard(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&value.protocolVersion===1
  &&value.purpose==='credential-free-cdp-fixture'&&value.dashboardAcceptance===false&&value.externalRequests===0&&value.memberSignIns===0
  &&value.localQueries===2&&value.consoleErrors===0&&value.pageErrors===0&&value.blockedRequests===0
  &&typeof value.minimumFreeGiB==='number'&&Number.isFinite(value.minimumFreeGiB)&&value.minimumFreeGiB>=1.5
  &&['actualCdpCapture','completedQueryAbortProved','genuinePartialFailureRetained','cleanupComplete','contextClosed','localServerClosed','callerOwnsBrowser','browserClosed'].every(key=>value[key]===true));
 guard(validObserverNetworkDiagnostics(value.networkDiagnostics));
 const network=value.networkDiagnostics as ObserverNetwork['diagnostics'];
 assertFixtureTransportProof([{termination:'proved-query-abort',bytes:1}] as QueryCapture[],['request','body'],network);
 guard(network.phases.navigation===0&&network.phases.freshness===1&&network.phases.history===1&&network.phases.cleanup===0
  &&network.bodyFailurePhases.history===1&&network.bodyFailurePhases.navigation===0&&network.bodyFailurePhases.freshness===0&&network.bodyFailurePhases.cleanup===0
  &&Object.entries(network.captureStages).every(([key,count])=>count===(key==='decode'?1:0)));
 return value;
}

/** Reuses the caller-owned browser; owns/closes only this fixture's context, CDP and local server. */
export async function runObserverCdpFixture(browser:Browser,signal?:AbortSignal) {
 if(signal?.aborted)throw Error('Credential-free CDP fixture cancelled; details withheld.');
 guard(freemem()/2**30>=2.5);
 const cancellation=new ObserverCancellation(signal),deadline=Date.now()+60000;
 let context:BrowserContext|undefined,cdp:CDPSession|undefined,page:Page|undefined,collector:ObserverNetwork|undefined;
 let server:Server|undefined,serverClosing:Promise<void>|undefined,contextClosing:Promise<void>|undefined,body:Buffer|undefined;
 let blockedRequests=0,consoleErrors=0,pageErrors=0,minimumFreeGiB=freemem()/2**30,queryCount=0;
 const sockets=new Set<Socket>(),responseTimers=new Set<ReturnType<typeof setTimeout>>();
 const captures:QueryCapture[]=[],issues:string[]=[];
 const closeServer=()=>{
  for(const timer of responseTimers)clearTimeout(timer);responseTimers.clear();
  for(const socket of sockets)socket.destroy();
  if(!server?.listening)return Promise.resolve();
  return serverClosing??=new Promise<void>((resolve,reject)=>{server!.close(error=>error?reject(Error('Fixture closure failed; details withheld.')):resolve());});
 };
 const closeContext=()=>contextClosing??=context?context.close():Promise.resolve();
 const consoleListener=(message:{type:()=>string})=>{if(message.type()==='error')consoleErrors++;};
 const errorListener=()=>{pageErrors++;};
 const detach=()=>{collector?.close();page?.off('console',consoleListener);page?.off('pageerror',errorListener);};
 const cancel=()=>{detach();void closeContext().catch(()=>undefined);void closeServer().catch(()=>undefined);};
 cancellation.signal.addEventListener('abort',cancel,{once:true});
 const monitor=setInterval(()=>{
  const free=freemem()/2**30;minimumFreeGiB=Math.min(minimumFreeGiB,free);
  if(free<1.5||Date.now()>deadline)cancellation.cancel();
 },250);
 let proof:Record<string,unknown>|undefined,cleanupComplete=false;
 try{
  // One exact loopback origin, two public query requests, no auth/cookies/provider calls.
  const binding:{input?:ObserverInput}={};
  server=createServer((request,response)=>{
   const input=binding.input;
   if(!input||request.headers.authorization||request.headers.cookie||!allowedFixtureRequest(`${input.origin}${request.url??''}`,request.method??'',input)){
    blockedRequests++;response.writeHead(403);response.end();return;
   }
   if(request.url==='/'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Public loopback transport fixture</title><link rel="icon" href="data:,">');return;}
   queryCount++;if(queryCount>2){blockedRequests++;response.writeHead(403);response.end();return;}
   const complete=queryCount===1;
   response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.flushHeaders();
   // Leave EOF open until the browser deliberately aborts. CDP can observe all
   // completed promise frames independently of normal response.body availability.
   const send=setTimeout(()=>{responseTimers.delete(send);if(!response.destroyed)response.write(complete?body!:body!.subarray(0,-1));},100);
   responseTimers.add(send);
   const stop=setTimeout(()=>{responseTimers.delete(stop);response.destroy();},10000);responseTimers.add(stop);
   response.once('close',()=>{clearTimeout(send);clearTimeout(stop);responseTimers.delete(send);responseTimers.delete(stop);});
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await cancellation.run(()=>new Promise<Server>((resolve,reject)=>{
   server!.once('error',()=>reject(Error('Fixture bind failed; details withheld.')));
   server!.listen(0,'127.0.0.1',()=>resolve(server!));
  }),()=>closeServer());
  const address=server.address();guard(address&&typeof address==='object');
  const input=loopbackObserverFixtureInput(`http://127.0.0.1:${(address as {port:number}).port}`);binding.input=input;
  body=await cancellation.run(()=>publicFixtureBody(input!),async value=>{value.fill(0);});guard(body.length>1&&body.length<=1_048_576);
  context=await cancellation.run(()=>browser.newContext({storageState:{cookies:[],origins:[]},serviceWorkers:'block',acceptDownloads:false}),value=>value.close());
  await cancellation.run(()=>context!.route('**/*',route=>{
   if(cancellation.signal.aborted||!allowedFixtureRequest(route.request().url(),route.request().method(),input!)){
    blockedRequests++;return route.abort();
   }
   return route.continue();
  }));
  page=await cancellation.run(()=>context!.newPage(),value=>value.close());page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
  page.on('console',consoleListener);page.on('pageerror',errorListener);
  cdp=await cancellation.run(()=>context!.newCDPSession(page!),value=>value.detach());
  collector=new ObserverNetwork(cdp,input,(url,status,accept,bytes,parent)=>observerQueryResponses(url,status,accept,bytes,input!,parent),
   capture=>captures.push(capture),issue=>issues.push(issue),cancellation.signal);
  await cancellation.run(()=>collector!.start());guard((await cancellation.run(()=>page!.goto(input!.origin)))?.status()===200);
  const endpoint=`${input.origin}/api/trpc/admin.activity?input=${encodeURIComponent(JSON.stringify({json:{runId:input.runId}}))}`;
  const receive=async(expectedBytes:number)=>{
   const received=await cancellation.run(()=>page!.evaluate(async({endpoint,expectedBytes})=>{
    const controller=new AbortController(),response=await fetch(endpoint,{headers:{'trpc-accept':'application/jsonl'},signal:controller.signal});
    if(response.status!==200||!response.body)throw Error('Public fixture transport failed.');
    const reader=response.body.getReader();let size=0;
    while(size<expectedBytes){const part=await reader.read();if(part.done)throw Error('Public fixture ended early.');size+=part.value.byteLength;}
    if(size!==expectedBytes)throw Error('Public fixture size mismatch.');
    controller.abort();try{await reader.cancel();}catch{/* This deliberate fetch abort is verified by independent complete-byte proof. */}
    return {size,aborted:controller.signal.aborted};
   },{endpoint,expectedBytes}));
   guard(received.size===expectedBytes&&received.aborted);await cancellation.run(()=>collector!.settle());
  };
  collector.setPhase('freshness');await receive(body.length);
  guard(captures.length===1&&issues.length===0&&collector.diagnostics.expectedSuccessfulQueryAborts===1);
  collector.setPhase('history');await receive(body.length-1);
  assertFixtureTransportProof(captures,issues,collector.diagnostics);
  guard(queryCount===2&&blockedRequests===0&&consoleErrors===0&&pageErrors===0&&!cancellation.signal.aborted);
  proof={protocolVersion:1,purpose:'credential-free-cdp-fixture',actualCdpCapture:true,completedQueryAbortProved:true,
   genuinePartialFailureRetained:true,externalRequests:0,memberSignIns:0,dashboardAcceptance:false,
   localQueries:queryCount,networkDiagnostics:collector.diagnostics,consoleErrors,pageErrors,blockedRequests,minimumFreeGiB};
 }finally{
  clearInterval(monitor);detach();cancellation.signal.removeEventListener('abort',cancel);cancellation.cancel();cancellation.detach();
  const detachThenClose=async()=>{const detached=await boundedObserverCleanup([cdp?cdp.detach():Promise.resolve()],5000);await closeContext();guard(detached);};
  cleanupComplete=await boundedObserverCleanup([detachThenClose(),closeServer(),...cancellation.pending]);
  cleanupComplete&&=!cancellation.cleanupFailed;body?.fill(0);
 }
 guard(proof&&cleanupComplete&&minimumFreeGiB>=1.5&&!signal?.aborted);
 return {...proof,cleanupComplete:true,contextClosed:true,localServerClosed:true,callerOwnsBrowser:true};
}
