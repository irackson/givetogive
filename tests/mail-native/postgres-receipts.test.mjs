import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import net from 'node:net';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import './fixture-context.mjs';

// No environment URL/password, dotenv, production database or remote host can
// be selected. This file is outside the ordinary unit test glob.
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.GITHUB_REPOSITORY!=='irackson/givetogive'
  ||process.env.GIVE_MAIL_NATIVE_FIXTURE!=='ephemeral-postgres-v1'){
  throw Error('Native fixture requires its fixed ephemeral hosted runner.');
}
const owner=postgres('postgres://give_mail_fixture:public-synthetic-fixture-password@127.0.0.1:55432/give_mail_fixture',{
  max:2,connect_timeout:2,idle_timeout:2,prepare:false});
const app=postgres('postgres://give_mail_app_fixture:public-synthetic-app-password@127.0.0.1:55432/give_mail_fixture',{
  max:8,connect_timeout:2,idle_timeout:2});
Object.defineProperty(globalThis,'__GIVE_NATIVE_FIXTURE_DB__',{value:drizzle(app)});
const {PostgresGiveMailReceiptStore,executeNativeGiveReceipt}=await import('../../src/server/mail/postgres-receipts.ts');
const {createGiveToGiveMailer,createGiveMailBinding}=await import('../../src/server/mail/give-mailer.ts');
const ddl=readFileSync(new URL('../../docs/sql/give-mail-receipts-v1.sql',import.meta.url),'utf8');
const sourceSha=createHash('sha256').update(ddl).digest('hex');
assert.equal(sourceSha,'5ecff1a8f780ae6c3624f04290a6f99872468eca06892fd6bd38bff157bc8e9f');
const request=n=>({key:'mail:'+n.toString(16).padStart(32,'0'),binding:'b'.repeat(64),app:'givetogive',providerScope:'mailgun:us:ianrackson.com'});
const control=capacity=>({schema:'give-mail-receipts-v1',maxRecords:capacity,used:0,receipts:{},providers:{}});
const state=async()=> (await owner`SELECT state FROM public.give_mail_receipt_ledger_v1 WHERE id='capacity:v1'`)[0]?.state;
async function initialize(capacity){
  await owner`TRUNCATE public.give_mail_receipt_ledger_v1`;
  await owner`INSERT INTO public.give_mail_receipt_ledger_v1(id,state) VALUES('capacity:v1',${owner.json(control(capacity))}::jsonb)`;
}

test('isolated native SQL, actual adapter and durable transport', {timeout:60000},async t=>{
  try{
    const identity=(await owner`SELECT current_database() AS database, current_setting('server_version_num') AS version`)[0];
    assert.equal(identity.database,'give_mail_fixture');
    assert.equal(Math.floor(Number(identity.version)/10000),16);
    await owner.unsafe(ddl);
    await owner.unsafe("CREATE ROLE give_mail_app_fixture LOGIN PASSWORD 'public-synthetic-app-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION");
    await owner.unsafe('GRANT USAGE ON SCHEMA public TO give_mail_app_fixture');
    await owner.unsafe('GRANT SELECT, UPDATE ON public.give_mail_receipt_ledger_v1 TO give_mail_app_fixture');
    const role=(await app`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`)[0];
    assert.deepEqual({...role},{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
    console.log(JSON.stringify({engineVersion:identity.version,sqlSha256:sourceSha,scope:'ephemeral loopback synthetic database only; ordinary app role'}));

    await t.test('preloaded guard blocks provider HTTP, external DNS and every other port',async()=>{
      await assert.rejects(fetch('https://api.mailgun.net/v3/ianrackson.com/messages'),/network denied/);
      assert.throws(()=>https.get('https://example.invalid'),/network denied/);
      assert.throws(()=>net.connect({host:'example.invalid',port:443}),/network denied/);
      assert.throws(()=>net.connect({host:'127.0.0.1',port:5432}),/network denied/);
      assert.throws(()=>dns.lookup('example.invalid',()=>{}),/network denied/);
      assert.throws(()=>new dns.Resolver(),/network denied/);
      assert.throws(()=>new dns.promises.Resolver(),/network denied/);
      assert.throws(()=>dgram.createSocket('udp4'),/network denied/);
      assert.throws(()=>new dgram.Socket('udp4'),/network denied/);
    });

    await t.test('native provider ID enforces printable ASCII and exact 512-character bound',async()=>{
      for(const length of [1,255,256,512]){
        const rows=await owner`SELECT public.give_mail_outcome_v1(${owner.json({state:'accepted',providerMessageId:'x'.repeat(length)})}::jsonb) AS valid`;
        assert.equal(rows[0].valid,true);
      }
      for(const value of ['', 'x'.repeat(513), 'has space', 'line\nfeed', 'é', '\u007f']){
        const rows=await owner`SELECT public.give_mail_outcome_v1(${owner.json({state:'accepted',providerMessageId:value})}::jsonb) AS valid`;
        assert.equal(rows[0].valid,false);
      }
    });
    await t.test('missing control refuses and never bootstraps',async()=>{
      const store=new PostgresGiveMailReceiptStore({maxRecords:1});
      await assert.rejects(store.reserve(request(1)));
      assert.equal(await state(),undefined);
    });
    await t.test('32 competing same-intent transactions admit exactly one',async()=>{
      await initialize(2);
      const store=new PostgresGiveMailReceiptStore({maxRecords:2});
      const results=await Promise.all(Array.from({length:32},()=>store.reserve(request(1))));
      assert.equal(results.filter(x=>x.state==='new').length,1);
      assert.equal(results.filter(x=>x.state==='existing').length,31);
      assert.equal((await state()).used,1);
      assert.deepEqual(await store.reserve({...request(1),binding:'c'.repeat(64)}),{state:'conflict'});
    });
    await t.test('competing different intents cannot exceed capacity',async()=>{
      await initialize(8);
      const store=new PostgresGiveMailReceiptStore({maxRecords:8});
      const results=await Promise.allSettled(Array.from({length:16},(_,i)=>store.reserve(request(i+1))));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,8);
      assert.equal(results.filter(x=>x.status==='rejected').length,8);
      const saved=await state();assert.equal(saved.used,8);assert.equal(Object.keys(saved.receipts).length,8);
    });
    await t.test('fencing and provider collision preserve immutable outcomes',async()=>{
      await initialize(2);
      const store=new PostgresGiveMailReceiptStore({maxRecords:2});
      const a=await store.reserve(request(1)),b=await store.reserve(request(2));
      assert.equal(await store.complete(a.claim,{state:'accepted',providerMessageId:'<fixture@test.invalid>'}),'saved');
      assert.equal(await store.complete(b.claim,{state:'accepted',providerMessageId:'<fixture@test.invalid>'}),'provider_id_conflict');
      assert.equal(await store.complete(a.claim,{state:'unknown',reason:'deadline'}),'stale');
      assert.equal(await store.complete(request(1).key+'.'+'0'.repeat(32),{state:'unknown',reason:'deadline'}),'stale');
      assert.deepEqual((await store.reserve(request(2))).outcome,{state:'unknown',reason:'provider_id_conflict'});
      assert.deepEqual((await state()).providers,{'<fixture@test.invalid>':request(1).key});
    });
    await t.test('invalid native arguments and corrupt history fail without writes',async()=>{
      await initialize(1);
      const before=await state();
      for(const [operation,payload,capacity] of [[null,{},1],['reserve',{},null],['reserve',{},0],['reserve',{request:request(1),claim:'bad'},1]]){
        await assert.rejects(owner`SELECT public.give_mail_receipt_command_v1(${operation},${owner.json(payload)}::jsonb,${capacity})`);
        assert.deepEqual(await state(),before);
      }
      for(const corrupt of [{...before,used:1},{...before,providers:{foreign:'mail:'+ '1'.repeat(32)}},{...before,maxRecords:'1'},{...before,foreign:true}]){
        await owner`UPDATE public.give_mail_receipt_ledger_v1 SET state=${owner.json(corrupt)}::jsonb WHERE id='capacity:v1'`;
        await assert.rejects(new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1)));
        assert.deepEqual(await state(),corrupt);
      }
    });
    await t.test('JSON-null and malformed retained fields fail closed before writes',async()=>{
      const key=request(1).key,claim=key+'.'+'a'.repeat(32);
      const record={request:request(1),claim,phase:'completed',outcome:{state:'accepted',providerMessageId:'<retained@fixture.invalid>'}};
      const valid={...control(2),used:1,receipts:{[key]:record},providers:{'<retained@fixture.invalid>':key}};
      const vectors=[
        {...valid,receipts:null},{...valid,providers:null},{...valid,used:null},{...valid,maxRecords:null},
        ...['request','claim','phase','outcome'].map(field=>({...valid,receipts:{[key]:{...record,[field]:null}}})),
        {...valid,receipts:{[key]:{...record,request:{...request(1),messageExpiresAt:null}}}},
        {...valid,receipts:{[key]:{...record,request:{...request(1),binding:null}}}},
        {...valid,receipts:{[key]:{...record,outcome:{state:'accepted',providerMessageId:null}}}},
        {...valid,providers:{}},
        {...valid,used:2,receipts:{...valid.receipts,[request(2).key]:{...record,request:request(2),claim:request(2).key+'.'+'a'.repeat(32)}},providers:{'<retained@fixture.invalid>':request(2).key}},
        {...valid,receipts:{[key]:{...record,foreign:true}}},
        {...valid,receipts:{[key]:{...record,phase:'submitting'}}},
      ];
      await initialize(2);
      for(const corrupt of vectors){
        await owner`UPDATE public.give_mail_receipt_ledger_v1 SET state=${owner.json(corrupt)}::jsonb WHERE id='capacity:v1'`;
        await assert.rejects(new PostgresGiveMailReceiptStore({maxRecords:2}).reserve(request(2)));
        assert.deepEqual(await state(),corrupt);
      }
    });
    await t.test('server lock deadline fails and rolls back',async()=>{
      await initialize(1);
      let unlock,locked;
      const gate=new Promise(resolve=>{unlock=resolve}),ready=new Promise(resolve=>{locked=resolve});
      const holder=owner.begin(async tx=>{await tx`SELECT state FROM public.give_mail_receipt_ledger_v1 FOR UPDATE`;locked();await gate;});
      await ready;const started=performance.now();
      try{await assert.rejects(new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1)),error=>['55P03','57014'].includes(error.code??error.cause?.code));}
      finally{unlock();await holder;}
      assert.ok(performance.now()-started<4500);
      assert.equal((await state()).used,0);
    });
    await t.test('server statement deadline cancels before commit',async()=>{
      await initialize(1);
      await owner.unsafe("CREATE FUNCTION public.fixture_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3); RETURN NEW; END $$; CREATE TRIGGER fixture_delay BEFORE UPDATE ON public.give_mail_receipt_ledger_v1 FOR EACH ROW EXECUTE FUNCTION public.fixture_delay()");
      try{await assert.rejects(new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1)),error=>(error.code??error.cause?.code)==='57014');assert.equal((await state()).used,0);}
      finally{await owner.unsafe('DROP TRIGGER fixture_delay ON public.give_mail_receipt_ledger_v1; DROP FUNCTION public.fixture_delay()');}
    });
    await t.test('lost caller acknowledgement retains committed submitting claim',async()=>{
      await initialize(1);
      const uncertain=new PostgresGiveMailReceiptStore({maxRecords:1,execute:async(...args)=>{await executeNativeGiveReceipt(...args);throw Error('synthetic acknowledgement loss');}});
      await assert.rejects(uncertain.reserve(request(1)));
      assert.deepEqual(await new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1)),{state:'existing'});
      assert.equal((await state()).used,1);
    });
    await t.test('new client and current-history restore retain duplicate protection',async()=>{
      await initialize(1);
      const store=new PostgresGiveMailReceiptStore({maxRecords:1});
      const r=await store.reserve(request(1));await store.complete(r.claim,{state:'accepted',providerMessageId:'<restore@fixture.invalid>'});
      const snapshot=await state();await initialize(1);
      await owner`UPDATE public.give_mail_receipt_ledger_v1 SET state=${owner.json(snapshot)}::jsonb WHERE id='capacity:v1'`;
      const restarted=postgres('postgres://give_mail_app_fixture:public-synthetic-app-password@127.0.0.1:55432/give_mail_fixture',{max:1,connect_timeout:2,prepare:false});
      try{const rows=await restarted`SELECT public.give_mail_receipt_command_v1('reserve',${restarted.json({request:request(1),claim:request(1).key+'.'+'a'.repeat(32)})}::jsonb,1) AS result`;assert.deepEqual(rows[0].result,{state:'existing',outcome:{state:'accepted',providerMessageId:'<restore@fixture.invalid>'}});}
      finally{await restarted.end({timeout:2});}
    });
    await t.test('10000 retained accepted receipts remain inside the actual server deadline',async()=>{
      await initialize(10000);
      const snapshot=control(10000);snapshot.used=10000;
      for(let i=1;i<=10000;i++){
        const req=request(i),pid=`<scale-${i}@fixture.invalid>`;
        snapshot.receipts[req.key]={request:req,claim:req.key+'.'+'a'.repeat(32),phase:'completed',outcome:{state:'accepted',providerMessageId:pid}};
        snapshot.providers[pid]=req.key;
      }
      await owner`UPDATE public.give_mail_receipt_ledger_v1 SET state=${owner.json(snapshot)}::jsonb WHERE id='capacity:v1'`;
      const started=performance.now();
      const result=await new PostgresGiveMailReceiptStore({maxRecords:10000}).reserve(request(1));
      assert.equal(result.state,'existing');assert.equal(result.outcome.state,'accepted');
      console.log(JSON.stringify({nativeScaleRecords:10000,elapsedMs:performance.now()-started}));
      assert.equal((await state()).used,10000);
    });
    await t.test('coherent old snapshot cannot be detected without independent history',async()=>{
      await initialize(1);const stale=await state();
      await new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1));
      await owner`UPDATE public.give_mail_receipt_ledger_v1 SET state=${owner.json(stale)}::jsonb WHERE id='capacity:v1'`;
      assert.equal((await new PostgresGiveMailReceiptStore({maxRecords:1}).reserve(request(1))).state,'new');
      // Expected counterexample, not recovery approval: production activation
      // requires an independent advancing checkpoint/restore hold.
    });
    await t.test('real native reservation precedes one mocked HTTP; replay sends zero',async()=>{
      await initialize(1);let calls=0;
      const runtime={config:{apiKey:'PUBLIC-FIXTURE',domain:'ianrackson.com',region:'us'},store:new PostgresGiveMailReceiptStore({maxRecords:1}),bind:createGiveMailBinding(Buffer.alloc(32,7)),fetch:async()=>{calls++;assert.equal((await state()).used,1);assert.equal(Object.values((await state()).receipts)[0].phase,'submitting');return new Response(JSON.stringify({id:'<native@fixture.invalid>',message:'Queued. Thank you.'}),{status:200});}};
      const mailer=createGiveToGiveMailer(runtime);
      const input={intentKey:request(1).key,to:'owner@example.invalid',url:'https://givetogive.ianrackson.com/verify-email?token=synthetic',purpose:'email_verification'};
      assert.equal((await mailer.sendAuth(input)).state,'accepted');
      assert.equal((await mailer.sendAuth(input)).state,'accepted');assert.equal(calls,1);
    });
  }finally{await app.end({timeout:2});await owner.end({timeout:2});}
});
