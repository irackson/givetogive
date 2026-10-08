import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { CDPSession } from 'playwright';
import { jsonlStreamProducer, jsonlStreamConsumer } from '@trpc/server/unstable-core-do-not-import';
import superjson from 'superjson';
import { ObserverNetwork, type QueryCapture } from '../src/hosted-community-observer-network.ts';
import { observerQueryResponses } from '../src/hosted-community-observer.ts';
import type { ObserverInput } from '../src/hosted-community-observer-evidence.ts';
import { approved } from '../src/hosted-community-policy.ts';
import { fixtureIds } from '../src/provisioning.ts';

// Only public synthetic data; no input validator/source/private files/runtime admission.
function fixture():ObserverInput {
 return {origin:approved.origin,runId:approved.runId,databaseIdentity:approved.databaseIdentity,
  admin:{userId:'synthetic-admin'},cohort:Array.from({length:253},(__unused,index)=>fixtureIds(approved.runId,index))} as unknown as ObserverInput;
}
const url=(input:ObserverInput,names='admin.activity',queries:unknown={json:{runId:input.runId}})=>
 `${input.origin}/api/trpc/${names}?${names.includes(',')?'batch=1&':''}input=${encodeURIComponent(JSON.stringify(queries))}`;
const activity=(input:ObserverInput,actorId=input.cohort[0]!.userId)=>({items:[{id:1,runId:input.runId,actorId,
 occurredAt:new Date('2026-10-04T01:00:00Z'),createdAt:new Date('2026-10-04T01:00:00.1Z')}],observedAt:new Date('2026-10-04T01:00:01Z')});
async function bytes(values:unknown[]) {
 const data=Object.fromEntries(values.map((value,index)=>[String(index),Promise.resolve({result:Promise.resolve({data:Promise.resolve(value)})})]));
 return Buffer.from(await new Response(jsonlStreamProducer({data,serialize:superjson.serialize})).arrayBuffer());
}
class FakeSession extends EventEmitter {
 buffers=new Map<string,string>(); calls:{method:string;id?:string}[]=[];
 handler?: (id:string)=>Promise<{bufferedData:string}>;
 completedHandler?: (id:string)=>Promise<{body:string;base64Encoded:boolean}>;
 async send(method:string,parameters?:{requestId?:string}) {
  const id=parameters?.requestId;this.calls.push({method,id});
  if(method==='Network.enable')return {};
  if(method==='Network.getResponseBody'){assert.ok(id);assert.ok(this.completedHandler);return this.completedHandler(id);}
  assert.equal(method,'Network.streamResourceContent');assert.ok(id);
  return this.handler?this.handler(id):{bufferedData:this.buffers.get(id)??''};
 }
 request(id:string,address:string,accept='application/jsonl',method='GET') {
  this.emit('Network.requestWillBeSent',{requestId:id,request:{url:address,method,headers:{'trpc-accept':accept}}});
 }
 response(id:string,status=200){this.emit('Network.responseReceived',{requestId:id,response:{status}});}
 data(id:string,body:Buffer){this.emit('Network.dataReceived',{requestId:id,data:body.toString('base64')});}
 finish(id:string){this.emit('Network.loadingFinished',{requestId:id});}
 abort(id:string){this.emit('Network.loadingFailed',{requestId:id,errorText:'net::ERR_ABORTED',canceled:true});}
}
async function setup(signal?:AbortSignal) {
 const input=fixture(),session=new FakeSession(),captures:QueryCapture[]=[],issues:string[]=[];
 const collector=new ObserverNetwork(session as unknown as Pick<CDPSession,'on'|'off'|'send'>,input,
  (address,status,accept,body,parent)=>observerQueryResponses(address,status,accept,body,input,parent),
  capture=>captures.push(capture),issue=>issues.push(issue),signal);
 await collector.start();collector.setPhase('freshness');return{input,session,captures,issues,collector};
}
test('actual installed JSONL producer/consumer resolves real nested query data and normally aborts its transport',async()=>{
 const value=activity(fixture()),body=await bytes([value]),transport=new AbortController();
 const [head]=await jsonlStreamConsumer<Record<string,Promise<{result:Promise<{data:Promise<unknown>}>}>>>({
  from:new ReadableStream({start(controller){controller.enqueue(body);controller.close();}}),
  deserialize:raw=>superjson.deserialize(raw as ReturnType<typeof superjson.serialize>),abortController:transport});
 assert.deepEqual(await (await (await head['0']!).result).data,value);
 await Promise.resolve();assert.equal(transport.signal.aborted,true);
});
test('HTTP200 exact request receives complete actual bytes and only its proved JSONL abort is qualified',async()=>{
 const x=await setup(),value=activity(x.input),body=await bytes([value]);
 x.session.buffers.set('one',body.toString('base64'));x.session.request('one',url(x.input));x.session.response('one');x.session.abort('one');
 await x.collector.settle();assert.equal(x.captures.length,1);assert.deepEqual(x.captures[0]!.values,[value]);
 assert.equal(x.captures[0]!.termination,'proved-query-abort');assert.deepEqual(x.issues,[]);
 assert.equal(x.collector.diagnostics.rawFailedRequests,1);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,1);
 assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,0);
 x.session.abort('different');assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);assert.deepEqual(x.issues,['request']);x.collector.close();
});
test('initial buffered bytes plus queued and later data are ordered by exact CDP request ID',async()=>{
 const x=await setup(),body=await bytes([activity(x.input)]);let resolveBuffer!:(value:{bufferedData:string})=>void;
 x.session.handler=()=>new Promise(resolve=>{resolveBuffer=resolve;});
 x.session.request('one',url(x.input));x.session.response('one');
 x.session.data('foreign',body);x.session.data('one',body.subarray(10,30));
 resolveBuffer({bufferedData:body.subarray(0,10).toString('base64')});await Promise.resolve();await Promise.resolve();
 x.session.data('one',body.subarray(30));x.session.finish('one');await x.collector.settle();
 assert.equal(x.captures[0]!.bytes,body.length);assert.deepEqual(x.issues,[]);assert.equal(x.captures[0]!.termination,'finished');x.collector.close();
});
test('normal finished plain JSON queries are captured but their aborts are never excused',async()=>{
 for(const aborted of [false,true]){
  const x=await setup(),value=activity(x.input),body=Buffer.from(JSON.stringify({result:{data:superjson.serialize(value)}}));
  x.session.buffers.set('one',body.toString('base64'));x.session.request('one',url(x.input),'application/json');x.session.response('one');
  if(aborted)x.session.abort('one');else x.session.finish('one');await x.collector.settle();
  assert.equal(x.captures.length,aborted?0:1);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,0);
  assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,aborted?1:0);x.collector.close();
 }
});
test('actual mixed simulation/activity batch validates every response and exact request actor index',async()=>{
 const x=await setup(),member=x.input.cohort[1]!,value=activity(x.input,member.userId);
 const simulation={run:{id:x.input.runId,environment:'staging',databaseIdentity:x.input.databaseIdentity}};
 const address=url(x.input,'admin.simulation,admin.activity',{'0':{json:{id:x.input.runId}},'1':{json:{runId:x.input.runId,actorId:member.userId}}});
 x.session.buffers.set('batch',(await bytes([simulation,value])).toString('base64'));
 x.session.request('batch',address);x.session.response('batch');x.session.abort('batch');await x.collector.settle();
 assert.deepEqual(x.captures[0]!.values,[simulation,value]);assert.deepEqual(x.issues,[]);x.collector.close();
});
test('duplicate activity procedures cannot borrow the other envelope actor filter',async()=>{
 const x=await setup(),members=x.input.cohort.slice(0,2),queries=Object.fromEntries(members.map((member,index)=>[index,{json:{runId:x.input.runId,actorId:member.userId}}]));
 x.session.buffers.set('batch',(await bytes([activity(x.input,members[0]!.userId),activity(x.input,members[0]!.userId)])).toString('base64'));
 x.session.request('batch',url(x.input,'admin.activity,admin.activity',queries));x.session.response('batch');x.session.abort('batch');await x.collector.settle();
 assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);assert.ok(x.issues.includes('body'));x.collector.close();
});
test('abort-before-completion, malformed/truncated/foreign/error/unknown-tail bytes remain genuine failures',async()=>{
 const complete=await bytes([activity(fixture())]);
 const malformed=Buffer.from('private-fixture-error\n');
 const foreign=await bytes([activity(fixture(),'foreign')]);
 const appError=Buffer.from(await new Response(jsonlStreamProducer({data:{'0':Promise.resolve({error:{message:'private-fixture-error'}})},serialize:superjson.serialize})).arrayBuffer());
 const extra=Buffer.concat([complete,Buffer.from(JSON.stringify(superjson.serialize({private:'fixture'}))+'\n')]);
 for(const body of [Buffer.alloc(0),complete.subarray(0,10),complete.subarray(0,-1),malformed,foreign,appError,extra]){
  const x=await setup();x.session.buffers.set('one',body.toString('base64'));x.session.request('one',url(x.input));x.session.response('one');x.session.abort('one');
  await x.collector.settle();assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,0);
  assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);assert.ok(x.issues.includes('body'));
  assert.ok(!JSON.stringify(x.collector.diagnostics).includes('private-fixture-error'));x.collector.close();
 }
});
test('non200, timeout, unsupported capture, body cap and unscoped requests never qualify',async()=>{
 for(const mode of ['status','timeout','unsupported','cap','foreign','post','three'] as const){
  const x=await setup(),body=await bytes([activity(x.input)]);x.session.buffers.set('one',body.toString('base64'));
  if(mode==='unsupported')x.session.handler=async()=>{throw new Error('private-CDP-error');};
  if(mode==='cap')x.session.buffers.set('one',Buffer.alloc(1_048_577).toString('base64'));
  const address=mode==='foreign'?'https://example.invalid/api/trpc/admin.activity':mode==='three'?url(x.input,'admin.activity,admin.activity,admin.activity'):url(x.input);
  x.session.request('one',address,'application/jsonl',mode==='post'?'POST':'GET');x.session.response('one',mode==='status'?403:200);
  if(mode==='timeout')x.session.emit('Network.loadingFailed',{requestId:'one',errorText:'net::ERR_TIMED_OUT',canceled:true});else x.session.abort('one');
  await x.collector.settle();assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,0);
  assert.ok(x.issues.length>0);assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);x.collector.close();
 }
});
test('aggregate data cap includes buffered and later pieces, duplicate terminal cannot reuse proof',async()=>{
 const x=await setup();x.session.request('one',url(x.input));x.session.response('one');await Promise.resolve();await Promise.resolve();
 x.session.data('one',Buffer.alloc(600_000));x.session.data('one',Buffer.alloc(600_000));x.session.abort('one');await x.collector.settle();
 assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.rawBodyFailures,1);x.collector.close();
 const y=await setup();y.session.buffers.set('one',(await bytes([activity(y.input)])).toString('base64'));
 y.session.request('one',url(y.input));y.session.response('one');y.session.abort('one');await y.collector.settle();y.session.abort('one');
 assert.equal(y.captures.length,1);assert.equal(y.collector.diagnostics.expectedSuccessfulQueryAborts,1);assert.equal(y.collector.diagnostics.unqualifiedFailedRequests,1);y.collector.close();
});
test('parent cancellation/closure detaches all owned handlers before late shutdown events',async()=>{
 const parent=new AbortController(),x=await setup(parent.signal);let finish!:(value:{bufferedData:string})=>void;
 x.session.handler=()=>new Promise(resolve=>{finish=resolve;});
 x.session.request('one',url(x.input));x.session.response('one');parent.abort('private-cancel');x.collector.close();x.collector.close();
 assert.equal(x.session.eventNames().length,0);
 finish({bufferedData:(await bytes([activity(x.input)])).toString('base64')});x.session.abort('one');await Promise.resolve();await Promise.resolve();
 assert.equal(x.captures.length,0);assert.deepEqual(x.issues,[]);assert.equal(x.collector.diagnostics.rawFailedRequests,0);
});
test('already-issued genuine failures survive closure, absent terminals fail bounded settling',async()=>{
 const x=await setup();x.session.abort('unknown');x.collector.close();assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);
 const y=await setup();y.session.request('one',url(y.input));y.session.response('one');
 await assert.rejects(()=>y.collector.settle(10),/Observer passive read deadline exceeded/);y.collector.close();
 await assert.rejects(()=>y.collector.settle(5001),/Observer guard rejected/);
});

test('completed responses recover exact existing CDP body when stream acquisition races completion',async()=>{
 for(const base64Encoded of [false,true]){
  const x=await setup(),body=await bytes([activity(x.input)]);
  x.session.handler=async()=>{throw Error('public completed-resource fixture');};
  x.session.completedHandler=async id=>{assert.equal(id,'finished');return{body:body.toString(base64Encoded?'base64':'utf8'),base64Encoded};};
  x.session.request('finished',url(x.input));x.session.response('finished');x.session.finish('finished');
  await x.collector.settle();assert.equal(x.captures.length,1);assert.equal(x.captures[0]!.termination,'finished');
  assert.equal(x.captures[0]!.bytes,body.length);assert.deepEqual(x.issues,[]);
  assert.deepEqual(x.session.calls.map(call=>call.method),['Network.enable','Network.streamResourceContent','Network.getResponseBody']);
  assert.equal(x.collector.diagnostics.rawBodyFailures,0);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,0);
  x.collector.close();
 }
});

test('unavailable streaming cannot borrow completed-body fallback for aborted responses',async()=>{
 const x=await setup();x.session.handler=async()=>{throw Error('public unavailable fixture');};
 x.session.completedHandler=async()=>{throw Error('must not be called');};
 x.session.request('aborted',url(x.input));x.session.response('aborted');x.session.abort('aborted');await x.collector.settle();
 assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);
 assert.equal(x.collector.diagnostics.captureUnavailable,1);assert.ok(x.issues.includes('body'));
 assert.equal(x.session.calls.some(call=>call.method==='Network.getResponseBody'),false);x.collector.close();
});

test('completed fallback rejects absent, oversized, invalid or foreign actual bodies without a second request',async()=>{
 const body=await bytes([activity(fixture())]);
 for(const mode of ['absent','empty','oversized','bad-base64','truncated','foreign'] as const){
  const x=await setup();x.session.handler=async()=>{throw Error('public stream unavailable fixture');};
  x.session.completedHandler=async()=>{
   if(mode==='absent')throw Error('public body unavailable fixture');
   if(mode==='empty')return{body:'',base64Encoded:false};
   if(mode==='oversized')return{body:'x'.repeat(1_048_577),base64Encoded:false};
   if(mode==='bad-base64')return{body:'!invalid!',base64Encoded:true};
   if(mode==='foreign')return{body:(await bytes([activity(x.input,'foreign')])).toString('utf8'),base64Encoded:false};
   return{body:body.subarray(0,10).toString('utf8'),base64Encoded:false};
  };
  x.session.request('finished',url(x.input));x.session.response('finished');x.session.finish('finished');await x.collector.settle();
  assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.rawBodyFailures,1);assert.ok(x.issues.includes('body'));
  assert.equal(x.session.calls.filter(call=>call.method==='Network.getResponseBody').length,1);x.collector.close();
 }
});

test('cancellation during completed-body acquisition discards late data and does not create acceptance',async()=>{
 const parent=new AbortController(),x=await setup(parent.signal);let finish!:(value:{body:string;base64Encoded:boolean})=>void;
 let acquired!:()=>void;const acquisition=new Promise<void>(resolve=>{acquired=resolve;});
 x.session.handler=async()=>{throw Error('public stream unavailable fixture');};
 x.session.completedHandler=()=>new Promise(resolve=>{finish=resolve;acquired();});
 x.session.request('finished',url(x.input));x.session.response('finished');x.session.finish('finished');
 await acquisition;parent.abort();x.collector.close();
 finish({body:(await bytes([activity(x.input)])).toString('utf8'),base64Encoded:false});await Promise.resolve();await Promise.resolve();
 assert.equal(x.captures.length,0);assert.deepEqual(x.issues,[]);
});

test('owned prefetch suppression needs exact scope, explicit route intent, actual 204 and canceled abort',async()=>{
 const headers={'next-router-prefetch':'1',rsc:'1'},address=fixture().origin+'/admin/users?_rsc=public-fixture';
 for(const mode of ['proved','intent-first','no-intent','wrong-status','timeout','wrong-url'] as const){
  const x=await setup();
  const request=()=>x.session.emit('Network.requestWillBeSent',{requestId:'suppressed',request:{url:address,method:'GET',headers}});
  const note=()=>x.collector.noteSuppressedPrefetch(mode==='wrong-url'?x.input.origin+'/admin/funds?_rsc=public-fixture':address,'GET',headers);
  if(mode==='intent-first'){note();request();}else{request();if(mode!=='no-intent')note();}
  x.session.response('suppressed',mode==='wrong-status'?200:204);
  if(mode==='timeout')x.session.emit('Network.loadingFailed',{requestId:'suppressed',errorText:'net::ERR_TIMED_OUT',canceled:true});else x.session.abort('suppressed');
  await x.collector.settle();const proved=mode==='proved'||mode==='intent-first';
  assert.equal(x.collector.diagnostics.rawFailedRequests,1);
  assert.equal(x.collector.diagnostics.operatorSuppressedPrefetchAborts,proved?1:0);
  assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,proved?0:1);
  assert.equal(x.captures.length,0);assert.equal(x.collector.diagnostics.expectedSuccessfulQueryAborts,0);
  assert.equal(x.issues.length===0,proved);x.collector.close();
 }
 const x=await setup();
 for(const [addressValue,method,h] of [[url(x.input),'GET',headers],[address,'POST',headers],[address,'GET',{...headers,'sec-fetch-dest':'document'}]] as const)
  assert.throws(()=>x.collector.noteSuppressedPrefetch(addressValue,method,h),/Observer guard rejected/);
 x.collector.close();
});

test('one route suppression cannot qualify two simultaneous identical prefetch requests or a duplicate terminal',async()=>{
 const x=await setup(),headers={'next-router-prefetch':'1',rsc:'1'},address=x.input.origin+'/admin/users?_rsc=public-fixture';
 for(const id of ['one','two'])x.session.emit('Network.requestWillBeSent',{requestId:id,request:{url:address,method:'GET',headers}});
 x.collector.noteSuppressedPrefetch(address,'GET',headers);
 for(const id of ['one','two']){x.session.response(id,204);x.session.abort(id);}
 x.session.abort('one');await x.collector.settle();
 assert.equal(x.collector.diagnostics.rawFailedRequests,3);assert.equal(x.collector.diagnostics.operatorSuppressedPrefetchAborts,1);
 assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,2);assert.equal(x.captures.length,0);x.collector.close();
});

test('suppression intent cannot be retroactively attached after a real response was received',async()=>{
 const x=await setup(),headers={'next-router-prefetch':'1',rsc:'1'},address=x.input.origin+'/admin/users?_rsc=public-fixture';
 x.session.emit('Network.requestWillBeSent',{requestId:'late',request:{url:address,method:'GET',headers}});
 x.session.response('late',204);
 assert.throws(()=>x.collector.noteSuppressedPrefetch(address,'GET',headers),/Observer guard rejected/);
 x.session.abort('late');await x.collector.settle();assert.equal(x.collector.diagnostics.operatorSuppressedPrefetchAborts,0);
 assert.equal(x.collector.diagnostics.unqualifiedFailedRequests,1);x.collector.close();
});
