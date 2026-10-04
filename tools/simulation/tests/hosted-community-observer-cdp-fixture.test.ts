// Pure fixture/decoder tests only. No server, browser, credential or operational action.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { loopbackObserverFixtureInput,allowedFixtureRequest,publicFixtureBody,assertFixtureTransportProof,parseFixtureChildProof,runObserverCdpFixture } from '../src/hosted-community-observer-cdp-fixture.ts';
import { observerQueryResponses } from '../src/hosted-community-observer.ts';
import { validateObserverInput } from '../src/hosted-community-observer-evidence.ts';
import type { ObserverNetwork, QueryCapture } from '../src/hosted-community-observer-network.ts';
test('loopback fixture cannot be confused with any staging/production/authenticated observer admission',()=>{
 const input=loopbackObserverFixtureInput('http://127.0.0.1:12345');assert.throws(()=>validateObserverInput(input));
 for(const origin of ['https://example.com','http://localhost:12345','http://0.0.0.0:12345','http://127.0.0.1','http://127.0.0.1:12345/',
  'http://user@127.0.0.1:12345','http://127.0.0.1:12345?secret=x','http://127.0.0.1:12345#fragment'])assert.throws(()=>loopbackObserverFixtureInput(origin));
 const query=`${input.origin}/api/trpc/admin.activity?input=${encodeURIComponent(JSON.stringify({json:{runId:input.runId}}))}`;
 assert.equal(allowedFixtureRequest(input.origin,'GET',input),true);assert.equal(allowedFixtureRequest(query,'GET',input),true);
 for(const address of [`${input.origin}/api/auth/session`,`${input.origin}/admin`,`${input.origin}/?_rsc=x`,
  query.replace(input.runId,'foreign'),query.replace('127.0.0.1','example.com'),`${input.origin}/api/trpc/admin.simulation`])
  assert.equal(allowedFixtureRequest(address,'GET',input),false);
 for(const method of ['POST','HEAD','PUT','DELETE','OPTIONS'])assert.equal(allowedFixtureRequest(query,method,input),false);
});
test('installed producer/decoder fixture is complete, while the deliberate one-byte partial stream is genuine failure',async()=>{
 const input=loopbackObserverFixtureInput('http://127.0.0.1:12345'),body=await publicFixtureBody(input);
 const query=`${input.origin}/api/trpc/admin.activity?input=${encodeURIComponent(JSON.stringify({json:{runId:input.runId}}))}`;
 const decoded=await observerQueryResponses(query,200,'application/jsonl',body,input);
 assert.equal(decoded.length,1);assert.equal((decoded[0] as {items:unknown[]}).items.length,1);
 await assert.rejects(()=>observerQueryResponses(query,200,'application/jsonl',body.subarray(0,-1),input),/Observer activity body unavailable/);
 body.fill(0);
});
test('fixture proof requires both real complete capture and retained genuine partial failure, never a blanket abort waiver',()=>{
 const network={rawFailedRequests:2,expectedSuccessfulQueryAborts:1,unqualifiedFailedRequests:1,rawBodyFailures:1,decodedQueries:1,
  captureUnavailable:0,capacityFailures:0,nonSuccessResponses:0,failures:{aborted:2,timeout:0,other:0},captureStages:{decode:1}} as ObserverNetwork['diagnostics'];
 const captures=[{termination:'proved-query-abort',bytes:200}] as QueryCapture[];
 assert.doesNotThrow(()=>assertFixtureTransportProof(captures,['request','body'],network));
 for(const patch of [{unqualifiedFailedRequests:0},{rawBodyFailures:0},{rawFailedRequests:1},{expectedSuccessfulQueryAborts:2},{captureUnavailable:1},
  {nonSuccessResponses:1},{failures:{aborted:1,timeout:1,other:0}},{captureStages:{decode:0}}])
  assert.throws(()=>assertFixtureTransportProof(captures,['request','body'],{...network,...patch} as ObserverNetwork['diagnostics']));
 assert.throws(()=>assertFixtureTransportProof([],['request','body'],network));assert.throws(()=>assertFixtureTransportProof(captures,[],network));
});
test('pre-cancelled fixture performs no memory/resource/browser/server admission',async()=>{
 const parent=new AbortController();parent.abort('private-value');let calls=0;
 const browser={newContext:async()=>{calls++;throw Error('Forbidden browser');}} as unknown as Browser;
 await assert.rejects(()=>runObserverCdpFixture(browser,parent.signal),/Credential-free CDP fixture cancelled; details withheld/);assert.equal(calls,0);
});
test('bounded child proof preserves both raw aborts, confirmed browser closure and transport-only purpose',()=>{
 const proof={protocolVersion:1,purpose:'credential-free-cdp-fixture',actualCdpCapture:true,completedQueryAbortProved:true,
  genuinePartialFailureRetained:true,externalRequests:0,memberSignIns:0,dashboardAcceptance:false,localQueries:2,
  consoleErrors:0,pageErrors:0,blockedRequests:0,minimumFreeGiB:3,cleanupComplete:true,contextClosed:true,localServerClosed:true,callerOwnsBrowser:true,browserClosed:true,
  networkDiagnostics:{rawFailedRequests:2,expectedSuccessfulQueryAborts:1,unqualifiedFailedRequests:1,rawBodyFailures:1,decodedQueries:1,
   captureUnavailable:0,capacityFailures:0,nonSuccessResponses:0,phases:{navigation:0,freshness:1,history:1,cleanup:0},failures:{aborted:2,timeout:0,other:0},
   bodyFailurePhases:{navigation:0,freshness:0,history:1,cleanup:0},statusPhases:{navigation:0,freshness:0,history:0,cleanup:0},
   captureStages:{unavailable:0,deadline:0,bytes:0,decode:1,scope:0,delivery:0}}};
 const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value)+'\n');
 assert.deepEqual(parseFixtureChildProof(bytes(proof),0,0),proof);
 for(const patch of [{browserClosed:false},{dashboardAcceptance:true},{memberSignIns:1},{cleanupComplete:false},{externalRequests:1},
  {unknown:'private'}, {minimumFreeGiB:1.4},{networkDiagnostics:{...proof.networkDiagnostics,rawFailedRequests:0}}])
  assert.throws(()=>parseFixtureChildProof(bytes({...proof,...patch}),0,0));
 assert.throws(()=>parseFixtureChildProof(bytes(proof),1,0));assert.throws(()=>parseFixtureChildProof(bytes(proof),0,1));
 assert.throws(()=>parseFixtureChildProof(Buffer.alloc(65537),0,0));assert.throws(()=>parseFixtureChildProof(Buffer.from([0xff]),0,0));
 assert.throws(()=>parseFixtureChildProof(Buffer.concat([bytes(proof),bytes(proof)]),0,0));
});
