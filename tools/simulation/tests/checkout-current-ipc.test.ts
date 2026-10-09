import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachCurrentMemberParent,createCurrentMemberClient } from '../src/checkout-current-ipc.ts';
import type { CheckoutIpcPeer } from '../src/checkout-broker-ipc.ts';
import type { CurrentMemberIdentity } from '../src/checkout-current-member.ts';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
import { now } from './fixtures/current-checkout.ts';
const binding={profileDigest:'a'.repeat(64),connectionNonce:'b'.repeat(32)},identity:CurrentMemberIdentity={userId:c.memberId,
 sessionVersion:0,observedAt:new Date(now).toISOString(),normalMemberOnly:true,billingManagementVerified:true};
class Peer extends EventEmitter implements CheckoutIpcPeer {
 other?:Peer;sent:unknown[]=[];
 send(raw:unknown,callback:(error:Error|null)=>void){this.sent.push(structuredClone(raw));queueMicrotask(()=>{this.other?.emit('message',structuredClone(raw));callback(null);});}
}
function pair(){const member=new Peer(),parent=new Peer();member.other=parent;parent.other=member;return {member,parent};}
test('four current phases use exact bounded identity/channel and return only backend results',async()=>{
 const p=pair(),calls:string[]=[],server=attachCurrentMemberParent(p.parent,binding,{phase:async(stage,id)=>{
  assert.equal(id.userId,c.memberId);assert.ok(Object.isFrozen(id));calls.push(stage);return {publicFixtureOnly:stage};}},()=>now);
 const client=createCurrentMemberClient(p.member,binding),signal=new AbortController().signal;
 for(const stage of ['opening','fixture','notice','submission'] as const)assert.deepEqual(await client.phase(stage,identity,signal),{publicFixtureOnly:stage});
 assert.deepEqual(calls,['opening','fixture','notice','submission']);assert.equal(server.lastPhase,'submission');
 await assert.rejects(client.phase('submission',identity,signal));server.close();
});
test('notice may be absent but no phase can be skipped, replayed or invoked after submission',async()=>{
 for(const invalid of ['fixture','notice','submission'] as const){const p=pair();let calls=0;
  const server=attachCurrentMemberParent(p.parent,binding,{phase:async()=>{calls++;return {}; }},()=>now),client=createCurrentMemberClient(p.member,binding);
  await assert.rejects(client.phase(invalid,identity,new AbortController().signal));assert.equal(calls,0);server.close();}
 const p=pair(),calls:string[]=[],server=attachCurrentMemberParent(p.parent,binding,{phase:async stage=>{calls.push(stage);return {};}},()=>now),
  client=createCurrentMemberClient(p.member,binding),signal=new AbortController().signal;
 for(const stage of ['opening','fixture','submission'] as const)await client.phase(stage,identity,signal);
 assert.deepEqual(calls,['opening','fixture','submission']);client.close();server.close();
});
test('foreign channel, actor, unknown fields and stale identity never invoke backend',async()=>{
 const raw={protocol:1,kind:'current-member-phase-request',...binding,sequence:1,phase:'opening',identity};
 for(const change of [{profileDigest:'c'.repeat(64)},{connectionNonce:'d'.repeat(32)},{sequence:2},
  {identity:{...identity,userId:'owner'}},{identity:{...identity,adminToken:'private'}},
  {identity:{...identity,observedAt:new Date(now-30001).toISOString()}},{providerKey:'private'}]){
  const p=pair();let calls=0;const server=attachCurrentMemberParent(p.parent,binding,{phase:async()=>{calls++;return {};}},()=>now);
  p.parent.emit('message',{...raw,...change});await new Promise<void>(resolve=>queueMicrotask(resolve));
  assert.equal(server.closed,true);assert.equal(calls,0);
 }
});
test('backend failure is private, closes the channel and cannot be retried',async()=>{
 const p=pair();let calls=0;const server=attachCurrentMemberParent(p.parent,binding,{phase:async()=>{calls++;throw Error('PRIVATE-ROOT-FAILURE');}},()=>now),
  client=createCurrentMemberClient(p.member,binding),signal=new AbortController().signal;
 await assert.rejects(client.phase('opening',identity,signal),/private details withheld/);
 await assert.rejects(client.phase('opening',identity,signal));assert.equal(calls,1);
 assert.equal(JSON.stringify(p.parent.sent).includes('PRIVATE'),false);assert.equal(server.closed,true);
});
test('cancel, timeout and concurrent requests abort in-flight backend without granting a later response',async()=>{
 for(const kind of ['cancel','timeout','concurrent']){const p=pair(),controller=new AbortController();let backendSignal:AbortSignal|undefined;
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  const server=attachCurrentMemberParent(p.parent,binding,{phase:async(__stage,__identity,signal)=>{backendSignal=signal;await gate;return {}; }},()=>now),
   client=createCurrentMemberClient(p.member,binding,kind==='timeout'?10:1000),pending=client.phase('opening',identity,controller.signal);
  const rejected=assert.rejects(pending);await new Promise<void>(resolve=>queueMicrotask(resolve));
  if(kind==='cancel')controller.abort();if(kind==='concurrent')await assert.rejects(client.phase('fixture',identity,controller.signal));
  await rejected;await new Promise<void>(resolve=>queueMicrotask(resolve));assert.equal(backendSignal?.aborted,true);
  release();await new Promise<void>(resolve=>queueMicrotask(resolve));assert.equal(server.closed,true);
  assert.equal(p.parent.sent.length,0);server.close();
 }
});
test('wrong response binding and oversized response fail without exposing its private payload',async()=>{
 for(const kind of ['binding','oversized']){const p=pair(),client=createCurrentMemberClient(p.member,binding,1000),signal=new AbortController().signal;
  const pending=client.phase('opening',identity,signal);const rejected=assert.rejects(pending);
  p.member.emit('message',{protocol:1,kind:'current-member-phase-response',...binding,sequence:1,ok:true,
   ...(kind==='binding'?{connectionNonce:'d'.repeat(32)}:{}),result:kind==='oversized'?'x'.repeat(65537):{private:true}});
  await rejected;await assert.rejects(client.phase('opening',identity,signal));
 }
});
