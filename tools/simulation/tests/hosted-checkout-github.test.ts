import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CheckoutPrivateDraft, type CheckoutAssetPhase } from '../src/hosted-checkout-github.ts';
import { approved, assetName, limits, type Manifest } from '../src/hosted-checkout-policy.ts';

// All data, tokens and ciphertext are PUBLIC OFFLINE fixtures. No actual network or secret input.
const NOW=Date.parse('2026-10-04T04:00:00Z'),HEAD='4'.repeat(40),TOKEN='OFFLINE-BROKER-SECRET-MARKER-ONLY';
const safeFailure=/^Error: Checkout private transport rejected; private details withheld\. Never automatically retry\.$/;
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function manifest():Manifest{return{protocol:1,purpose:'one-member-test-checkout-policy',
 job:{repository:approved.repository,actor:approved.actor,triggeringActor:approved.actor,event:'workflow_dispatch',ref:'refs/heads/main',attempt:1,
 id:'123456789',headSha:HEAD,nonce:'c'.repeat(32),publicRepository:true,runner:'ubuntu-24.04',platform:'linux',nodeMajor:24},
 releaseId:123,createdAt:new Date(NOW).toISOString(),runId:approved.runId,actorId:approved.actorId,operationId:approved.operationId,
 origin:approved.origin,databaseIdentity:approved.databaseIdentity,sourceDigest:approved.sourceDigest,canonicalSourceDigest:approved.canonicalSourceDigest,
 rootLockDigest:approved.rootLockDigest,runnerDigest:approved.runnerDigest,currency:'usd',maximumAmountCents:1500,expectedTier:'sustainer',scenario:'success',
 budget:{runBudgetCents:2500,actorBudgetCents:1500,priorExpiredReservedCents:1000,candidateReservedCents:1500,originalAdmissionDigest:'1'.repeat(64),
 expiredHistoryDigests:['2'.repeat(64),'3'.repeat(64)],noReset:true},rootProof:{observedAt:new Date(NOW).toISOString(),localIsolationVerified:true,
 normalMemberOnly:true,noMemberTokens:true,noCheckoutSubmitAdmission:true,canonicalCustomerClockVerified:true,releaseVerified:true,supportsTestSubscriptionsOnly:true}};}
function ciphertext(){return Buffer.from('G2GHOST1'+'PUBLIC-OFFLINE-ENCRYPTED-FIXTURE'.repeat(3));}
type Row={id:number;name:string;size:number;digest:string;state:string};
type Call={url:string;method:string;headers:Headers;body?:BodyInit|null};
function fake(){
 const m=manifest(),rows:Row[]=[],bytes=new Map<number,Buffer>(),calls:Call[]=[];
 let now=NOW,nextId=1,pauses=0;
 const association={protocol:1,purpose:m.purpose,repository:approved.repository,runId:m.runId,operationId:m.operationId,headSha:HEAD};
 const release:Record<string,unknown>={id:m.releaseId,draft:true,prerelease:false,published_at:null,target_commitish:HEAD,
 tag_name:`checkout-acceptance-${m.operationId}`,body:JSON.stringify(association),assets:rows};
 const state:{hook?:(call:Call)=>Response|undefined|Promise<Response|undefined>;pauseHook?:()=>void}={};
 const add=(phase:CheckoutAssetPhase,value=ciphertext())=>{const row={id:nextId++,name:assetName(m,phase),size:value.length,digest:`sha256:${hash(value)}`,state:'uploaded'};
  rows.push(row);bytes.set(row.id,Buffer.from(value));return row;};
 const request=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const call={url:String(input),method:init?.method??'GET',headers:new Headers(init?.headers),body:init?.body};calls.push(call);
  const injected=await state.hook?.(call);if(injected)return injected;
  const url=new URL(call.url),authenticated=call.headers.get('authorization')===`Bearer ${TOKEN}`;
  if(url.hostname==='api.github.com'&&call.method==='GET'){
   if(!authenticated)return new Response(null,{status:404});
   if(url.pathname.endsWith(`/releases/${m.releaseId}`))return Response.json(release);
   const id=Number(url.pathname.split('/').at(-1));assert(bytes.has(id));
   return new Response(null,{status:302,headers:{location:`https://release-assets.githubusercontent.com/offline/${id}?opaque=OFFLINE-ONLY`}});
  }
  if(url.hostname==='release-assets.githubusercontent.com'){
   assert.equal(call.headers.has('authorization'),false);assert.equal(call.method,'GET');
   return new Response(new Uint8Array(bytes.get(Number(url.pathname.split('/').at(-1)))!));
  }
  if(url.hostname==='uploads.github.com'&&call.method==='POST'){
   assert(authenticated);assert(call.body instanceof Uint8Array);
   assert.equal(call.headers.get('content-length'),String(call.body.byteLength));
   const value=Buffer.from(call.body),row={id:nextId++,name:url.searchParams.get('name')!,size:value.length,digest:`sha256:${hash(value)}`,state:'uploaded'};
   rows.push(row);bytes.set(row.id,value);return Response.json(row,{status:201});
  }
  throw Error('OFFLINE-PRIVATE-URL-ERROR '+TOKEN);
 }) as typeof fetch;
 const transport=new CheckoutPrivateDraft(m,HEAD,TOKEN,{request,now:()=>now,pause:async(ms,signal)=>{signal.throwIfAborted();pauses++;now+=ms;state.pauseHook?.();}});
 return{m,rows,bytes,calls,release,state,transport,add,request,get pauses(){return pauses;}};
}

test('constructor/import are inert and exact manifest/head are required before fake network',()=>{
 const f=fake();assert.equal(f.calls.length,0);
 assert.throws(()=>new CheckoutPrivateDraft(manifest(),'f'.repeat(40),TOKEN,{request:f.request,now:()=>NOW}));
 assert.throws(()=>new CheckoutPrivateDraft({...manifest(),maximumAmountCents:500},HEAD,TOKEN,{request:f.request,now:()=>NOW}));
 assert.throws(()=>new CheckoutPrivateDraft(manifest(),HEAD,'short',{request:f.request,now:()=>NOW}),safeFailure);
 assert.equal(f.calls.length,0);assert(Object.isFrozen(f.transport.manifest.job));
});

test('exact private draft/body and six-name inventory; no release/tag writes',async()=>{
 const f=fake();const result=await f.transport.inspect();assert.equal(result.privateDraftVerified,true);assert.equal(result.assets.length,0);
 assert(f.calls.every(call=>call.method==='GET'&&new URL(call.url).hostname==='api.github.com'));
 for(const patch of [{draft:false},{prerelease:true},{published_at:'2026-10-04T00:00:00Z'},{target_commitish:'f'.repeat(40)},
  {tag_name:'community-acceptance-foreign'},{body:JSON.stringify({protocol:1,purpose:f.m.purpose,repository:approved.repository,runId:f.m.runId,operationId:f.m.operationId,headSha:HEAD,extra:true})}]){
  const g=fake();Object.assign(g.release,patch);await assert.rejects(()=>g.transport.inspect(),safeFailure);
 }
 for(const mutate of [(g:ReturnType<typeof fake>)=>{g.rows.push({...g.add('input'),name:'foreign.g2genc'});},
  (g:ReturnType<typeof fake>)=>{const row=g.add('input');g.rows.push({...row});},
  (g:ReturnType<typeof fake>)=>{g.add('input').size=limits.checkpointBytes+1;},
  (g:ReturnType<typeof fake>)=>{g.add('input').digest='not-sha';}]){
  const g=fake();mutate(g);await assert.rejects(()=>g.transport.inspect(),safeFailure);
 }
});

test('download retains original ciphertext with anonymous404 before/after and never forwards token to CDN',async()=>{
 const f=fake(),row=f.add('input'),result=await f.transport.download('input');
 assert.deepEqual(result,f.bytes.get(row.id));assert.equal(f.calls.filter(call=>new URL(call.url).hostname==='release-assets.githubusercontent.com').length,1);
 const count=f.calls.length;await assert.rejects(()=>f.transport.download('input'),safeFailure);assert.equal(f.calls.length,count);
 assert(f.calls.filter(call=>!call.headers.has('authorization')).every(call=>!call.headers.has('x-stripe-account')));
 result.fill(0);assert.notEqual(f.bytes.get(row.id)!.at(0),0);
});

test('only missing asset may poll; absent deadline expires and permission never resets',async()=>{
 const f=fake();f.state.pauseHook=()=>{if(f.pauses===2)f.add('open-proof');};
 const result=await f.transport.download('open-proof');assert.equal(f.pauses,2);result.fill(0);
 const missing=fake();await assert.rejects(()=>missing.transport.download('input'),safeFailure);assert.equal(missing.pauses,120);
 const count=missing.calls.length;await assert.rejects(()=>missing.transport.download('input'),safeFailure);assert.equal(missing.calls.length,count);
});

test('selected asset mutation/corruption/foreign redirects are terminal and cannot redownload',async()=>{
 for(const mode of ['changed','corrupt','foreign','credentialed','insecure'] as const){
  const f=fake(),row=f.add('input');let selected=false;
  f.state.hook=call=>{
   if(new URL(call.url).hostname==='release-assets.githubusercontent.com'){
    if(mode==='changed'){row.digest='sha256:'+'f'.repeat(64);return undefined;}
    if(mode==='corrupt')return new Response(new Uint8Array(Buffer.alloc(row.size,1)));
   }
   if(call.headers.get('accept')==='application/octet-stream'){
    selected=true;
    if(['foreign','credentialed','insecure'].includes(mode))return new Response(null,{status:302,headers:{location:
     mode==='foreign'?'https://evil.example/private':mode==='credentialed'?'https://user:secret@release-assets.githubusercontent.com/private':'http://release-assets.githubusercontent.com/private'}});
   }
   return undefined;
  };
  await assert.rejects(()=>f.transport.download('input'),safeFailure);assert(selected);
  assert(f.calls.every(call=>!new URL(call.url).hostname.includes('evil')));
  const count=f.calls.length;await assert.rejects(()=>f.transport.download('input'),safeFailure);assert.equal(f.calls.length,count);
 }
});

test('upload posts one immutable private copy, verifies201 retained identity and exact download readback before ACK',async()=>{
 const f=fake(),original=ciphertext(),before=Buffer.from(original);
 const ack=await f.transport.upload('submit-intent',original);assert.equal(ack.readbackVerified,true);assert.equal(ack.ciphertextDigest,hash(original));
 assert.equal(ack.paymentAccepted,false);assert.equal(ack.retryAllowed,false);assert.deepEqual(original,before);
 const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);
 assert(posts[0]!.body instanceof Uint8Array);assert((posts[0]!.body as Uint8Array).every(byte=>byte===0));
 const count=f.calls.length;await assert.rejects(()=>f.transport.upload('submit-intent',original),safeFailure);assert.equal(f.calls.length,count);
 await assert.rejects(()=>f.transport.download('submit-intent'),safeFailure);assert.equal(f.calls.length,count);
 assert(f.calls.every(call=>['api.github.com','uploads.github.com','release-assets.githubusercontent.com'].includes(new URL(call.url).hostname)));
});

test('caller mutation during metadata awaits cannot alter captured upload bytes/digest',async()=>{
 const f=fake(),original=ciphertext(),captured=Buffer.from(original);let changed=false;
 f.state.hook=call=>{if(!changed&&call.headers.has('authorization')&&call.method==='GET'){original.fill(9);changed=true;}return undefined;};
 const ack=await f.transport.upload('input',original);assert.equal(ack.ciphertextDigest,hash(captured));
 assert.deepEqual(f.bytes.get(ack.assetId),captured);assert(original.every(byte=>byte===9));
});

test('upload rejects existing phase, preserves final slot, accepts exactly sixth final asset only',async()=>{
 const f=fake();f.add('input');await assert.rejects(()=>f.transport.upload('input',ciphertext()),safeFailure);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 const g=fake();for(const phase of ['input','open-proof','submit-proof','ack-intent','final'] as CheckoutAssetPhase[])g.add(phase);
 await assert.rejects(()=>g.transport.upload('submit-intent',ciphertext()),safeFailure);assert.equal(g.calls.filter(c=>c.method==='POST').length,0);
 const h=fake();for(const phase of ['input','open-proof','submit-proof','ack-intent','submit-intent'] as CheckoutAssetPhase[])h.add(phase);
 const ack=await h.transport.upload('final',ciphertext());assert.equal(ack.readbackVerified,true);assert.equal(h.rows.length,6);
 assert.equal((await h.transport.inspect()).assets.length,6);
});

test('ambiguous/non201 writes, incorrect readback and raw fetch failures never retry or leak details',async()=>{
 for(const mode of ['throw','400','200','readback'] as const){
  const f=fake(),original=ciphertext();f.state.hook=call=>{
   if(call.method==='POST'){
    if(mode==='throw')throw Error(TOKEN+' https://secret.invalid/private');
    if(mode==='400')return new Response('private provider error '+TOKEN,{status:400});
    if(mode==='200')return Response.json({secret:TOKEN},{status:200});
   }
   if(mode==='readback'&&new URL(call.url).hostname==='release-assets.githubusercontent.com')return new Response(new Uint8Array(Buffer.alloc(original.length,1)));
   return undefined;
  };
  await assert.rejects(()=>f.transport.upload('submit-intent',original),safeFailure);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  const count=f.calls.length;await assert.rejects(()=>f.transport.upload('submit-intent',original),safeFailure);assert.equal(f.calls.length,count);
  assert.equal(original.subarray(0,8).toString(),'G2GHOST1');
 }
});

test('anonymous visibility and oversized metadata/streams fail closed without raw response',async()=>{
 for(const mode of ['public-draft','public-asset','metadata','oversized'] as const){
  const f=fake();f.add('input');f.state.hook=call=>{
   if(mode==='public-draft'&&!call.headers.has('authorization')&&call.url.endsWith('/releases/123'))return new Response(null,{status:200});
   if(mode==='public-asset'&&!call.headers.has('authorization')&&call.url.includes('/releases/assets/'))return new Response(null,{status:200});
   if(mode==='metadata'&&call.headers.has('authorization')&&call.url.endsWith('/releases/123'))return new Response('x'.repeat(256*1024+1));
   if(mode==='oversized'&&new URL(call.url).hostname==='release-assets.githubusercontent.com')return new Response(new Uint8Array(Buffer.alloc(limits.checkpointBytes+1)));
   return undefined;
  };
  await assert.rejects(()=>f.transport.download('input'),safeFailure);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }
});

test('cancellation interrupts pending stream, closes owned reader and consumes download permission',async()=>{
 const f=fake();f.add('input');const abort=new AbortController();let cancelled=false;
 f.state.hook=call=>new URL(call.url).hostname==='release-assets.githubusercontent.com'?new Response(new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(Buffer.from('G2GHOST1')));queueMicrotask(()=>abort.abort());},cancel(){cancelled=true;}
 })):undefined;
 await assert.rejects(()=>f.transport.download('input',abort.signal),safeFailure);assert(cancelled);
 const count=f.calls.length;await assert.rejects(()=>f.transport.download('input'),safeFailure);assert.equal(f.calls.length,count);
});

test('already cancelled admissions and partial/failed201 uploads cannot be invoked again',async()=>{
 const f=fake(),abort=new AbortController();abort.abort();
 await assert.rejects(()=>f.transport.download('input',abort.signal),safeFailure);assert.equal(f.calls.length,0);
 await assert.rejects(()=>f.transport.download('input'),safeFailure);assert.equal(f.calls.length,0);
 const g=fake();await assert.rejects(()=>g.transport.upload('input',ciphertext(),abort.signal),safeFailure);assert.equal(g.calls.length,0);
 await assert.rejects(()=>g.transport.upload('input',ciphertext()),safeFailure);assert.equal(g.calls.length,0);
 for(const mode of ['id','digest','visibility','removed'] as const){
  const h=fake();let posted=false;
  h.state.hook=call=>{
   if(call.method==='POST'){posted=true;if(mode==='id'||mode==='digest')return Response.json({id:99,name:assetName(h.m,'input'),size:ciphertext().length,
    digest:mode==='digest'?'sha256:'+'f'.repeat(64):'sha256:'+hash(ciphertext()),state:'uploaded'},{status:201});}
   if(posted&&mode==='visibility'&&!call.headers.has('authorization'))return new Response(null,{status:200});
   if(posted&&mode==='removed'&&new URL(call.url).hostname==='release-assets.githubusercontent.com'){h.rows.length=0;return undefined;}
   return undefined;
  };
  await assert.rejects(()=>h.transport.upload('input',ciphertext()),safeFailure);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
  const count=h.calls.length;await assert.rejects(()=>h.transport.upload('input',ciphertext()),safeFailure);assert.equal(h.calls.length,count);
 }
});
