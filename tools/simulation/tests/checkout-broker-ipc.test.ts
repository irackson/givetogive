// Real Node IPC process boundary plus adversarial memory transports. No network/payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/hosted-checkout-policy.ts';
import { createCheckoutBrokerClient,attachCheckoutBrokerParent,type CheckoutIpcPeer } from '../src/checkout-broker-ipc.ts';
const binding={manifestDigest:'a'.repeat(64),connectionNonce:'b'.repeat(32)};
const proof={environment:'staging',livemode:false};
const intent={phase:'submit-intent',manifestDigest:binding.manifestDigest,proofDigest:digest(proof)};
const retained={acknowledgment:{encryptedOriginalBytes:true},ciphertextDigest:'c'.repeat(64)};
class Peer extends EventEmitter implements CheckoutIpcPeer{
 other!:Peer;sent:unknown[]=[];
 send(value:unknown,callback:(error:Error|null)=>void){this.sent.push(structuredClone(value));queueMicrotask(()=>{this.other.emit('message',structuredClone(value));callback(null);});return true;}
}
function fixture(overrides:Record<string,unknown>={}){
 const parent=new Peer(),member=new Peer();parent.other=member;member.other=parent;
 const calls:string[]=[],signals:AbortSignal[]=[];
 const backend={preSubmitProof:async(signal:AbortSignal)=>{calls.push('proof');signals.push(signal);return proof;},
  writeIntent:async()=>{calls.push('write');return{exclusive:true,fsynced:true};},
  retainSubmitIntent:async()=>{calls.push('retain');return retained;},...overrides};
 const server=attachCheckoutBrokerParent(parent,binding,backend),client=createCheckoutBrokerClient(member,binding,50);
 return{parent,member,calls,signals,server,client,signal:new AbortController()};
}
test('inert creation, optional acknowledgment, ordered sole proof/write/retention',async()=>{
 const f=fixture();assert.deepEqual(f.calls,[]);
 await f.client.writeIntent({phase:'ack-intent',manifestDigest:binding.manifestDigest},f.signal.signal);
 assert.deepEqual(await f.client.preSubmitProof(f.signal.signal),proof);
 const durable=await f.client.writeIntent(intent,f.signal.signal);
 assert.deepEqual(await f.client.retainSubmitIntent(intent,durable,f.signal.signal),retained);
 assert.deepEqual(f.calls,['write','proof','write','retain']);assert.equal(f.server.phase,'retained');
 await assert.rejects(f.client.preSubmitProof(f.signal.signal));f.client.close();f.server.close();
});
test('changed intent, premature write, repeated proof and altered durable receipt never reach retention',async()=>{
 for(const mode of ['changed','premature','repeat','durable']){
  const f=fixture();
  if(mode==='premature')await assert.rejects(f.client.writeIntent(intent,f.signal.signal));
  else{
   await f.client.preSubmitProof(f.signal.signal);
   if(mode==='repeat')await assert.rejects(f.client.preSubmitProof(f.signal.signal));
   else{const d=await f.client.writeIntent(intent,f.signal.signal);
    await assert.rejects(f.client.retainSubmitIntent(mode==='changed'?{...intent,extra:true}:intent,mode==='durable'?{}:d,f.signal.signal));}
  }
  assert.equal(f.calls.includes('retain'),false);assert.equal(f.server.closed,true);f.client.close();f.server.close();
 }
});
test('wrong binding, oversized, unknown operation or duplicate sequence closes before backend',async()=>{
 for(const patch of [{connectionNonce:'d'.repeat(32)},{extra:'unknown'},{operation:'providerWrite'},{sequence:2},{padding:'x'.repeat(65537)}]){
  const f=fixture();f.parent.emit('message',{protocol:1,kind:'checkout-broker-request',...binding,sequence:1,operation:'preSubmitProof',...patch});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.server.closed,true);assert.deepEqual(f.calls,[]);f.client.close();
 }
});
test('abort, disconnect, timeout and concurrent calls stop without automatic retry',async()=>{
 for(const mode of ['abort','disconnect','timeout','concurrent']){
  let release:(value:unknown)=>void=()=>{};
  const f=fixture({preSubmitProof:(signal:AbortSignal)=>{f.calls.push('proof');f.signals.push(signal);return new Promise(resolve=>{release=resolve;});}});
  const pending=f.client.preSubmitProof(f.signal.signal);const rejection=assert.rejects(pending);
  await new Promise(resolve=>setImmediate(resolve));
  if(mode==='abort')f.signal.abort();
  if(mode==='disconnect')f.member.emit('disconnect');
  if(mode==='concurrent')await assert.rejects(f.client.preSubmitProof(f.signal.signal));
  await rejection;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.server.closed,true);assert.equal(f.signals[0]?.aborted,true);release(proof);
  await assert.rejects(f.client.preSubmitProof(new AbortController().signal));assert.deepEqual(f.calls,['proof']);
 }
});
test('late or unsolicited response cannot create a new admission',async()=>{
 const f=fixture();f.member.emit('message',{protocol:1,kind:'checkout-broker-response',...binding,sequence:1,ok:true,result:proof});
 await assert.rejects(f.client.preSubmitProof(f.signal.signal));assert.deepEqual(f.calls,[]);f.server.close();
});
test('real separate Node member process completes IPC with only explicit non-secret env',async()=>{
 const child=fork(fileURLToPath(new URL('./checkout-broker-ipc-fixture.mjs',import.meta.url)),[],{
  execArgv:['--experimental-strip-types'],env:{PATH:process.env.PATH!,SystemRoot:process.env.SystemRoot!,PROGRAMDATA:process.env.PROGRAMDATA!},
  stdio:['ignore','ignore','ignore','ipc']});
 const calls:string[]=[];
 const server=attachCheckoutBrokerParent(child as unknown as CheckoutIpcPeer,binding,{
  preSubmitProof:async()=>{calls.push('proof');return proof;},
  writeIntent:async()=>{calls.push('write');return{exclusive:true,fsynced:true};},
  retainSubmitIntent:async()=>{calls.push('retain');return retained;}});
 let completed=false;child.on('message',(message:unknown)=>{if((message as {fixtureComplete?:boolean}).fixtureComplete)completed=true;});
 try{
  const result=await new Promise<number|null>((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Offline child timed out.'));},10000);
   child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  assert.equal(result,0);assert.equal(completed,true);assert.deepEqual(calls,['proof','write','retain']);
 }finally{server.close();if(child.exitCode===null)child.kill();}
});
