import assert from 'node:assert/strict';
import test from 'node:test';
import './give-mail-test-context.mjs';
import { SyntheticReceiptStore } from './mail-fixtures/synthetic-store.ts';
const {createGiveToGiveMailer,createGiveMailBinding,readGiveMailConfiguration}=await import('../../src/server/mail/give-mailer.ts');
const {renderMessage}=await import('../../src/server/mail/templates.ts');
const {createMailgunDelivery}=await import('../../src/server/mail/mailgun.ts');
const {getGiveToGiveMailRuntime}=await import('../../src/server/mail/runtime.ts');
const key=(n=1)=>'mail:'+n.toString(16).padStart(32,'0');
const to='synthetic@example.invalid',url='https://givetogive.ianrackson.com/verify-email?token=PUBLIC-FIXTURE';
const material=()=>new TextEncoder().encode('PUBLIC-GIVE-TEST-ONLY-BINDING-MATERIAL');
const config={apiKey:'PUBLIC-NOT-A-CREDENTIAL',domain:'ianrackson.com' as const,region:'us' as const};
function setup(response:()=>Promise<Response>=async()=>Response.json({id:'<PUBLIC-QUEUED-ID>',message:'Queued'}),timeoutMs=500){
  const store=new SyntheticReceiptStore();let effects=0;
  const fetch:typeof globalThis.fetch=async(...args)=>{effects++;requests.push(args);return response();};
  const requests:Parameters<typeof globalThis.fetch>[]=[];
  const runtime={config:{...config,timeoutMs},store,fetch,bind:createGiveMailBinding(material())};
  return {store,runtime,requests,effects:()=>effects,mailer:createGiveToGiveMailer(runtime)};
}
test('runtime activation is disabled and cannot be enabled with environment configuration alone',()=>assert.equal(getGiveToGiveMailRuntime(),undefined));
test('exact GiveToGive private sender profile and region are required',()=>{
  const source={EMAIL_PROVIDER:'mailgun',MAILGUN_API_KEY:config.apiKey,MAILGUN_DOMAIN:config.domain,MAILGUN_REGION:'us',
    EMAIL_FROM:'GiveToGive <noreply@ianrackson.com>',EMAIL_REPLY_TO:'givetogive@ianrackson.com',EMAIL_CONTACT:'givetogive@ianrackson.com'};
  assert.deepEqual(readGiveMailConfiguration(source),config);
  for(const change of [{MAILGUN_REGION:'eu'},{EMAIL_FROM:'Other <noreply@ianrackson.com>'},{EMAIL_REPLY_TO:'support@ianrackson.com'},{EMAIL_CONTACT:'support@ianrackson.com'},{MAILGUN_API_KEY:'bad\nkey'},{EMAIL_PROVIDER:'gmail'}])assert.throws(()=>readGiveMailConfiguration({...source,...change}));
});
for(const purpose of ['email_verification','password_reset'] as const)test(`branded ${purpose} template uses HTML/text, exact headers and no unsubscribe/tracking`,async()=>{
  const f=setup();assert.equal((await f.mailer.sendAuth({to,url,purpose,intentKey:key()})).state,'accepted');
  const init=f.requests[0]![1]!,body=init.body as FormData;
  assert.equal(body.get('from'),'GiveToGive <noreply@ianrackson.com>');assert.equal(body.get('h:Reply-To'),'givetogive@ianrackson.com');
  assert.equal(body.get('to'),to);assert.match(String(body.get('html')),/GiveToGive/);assert.match(String(body.get('text')),/GiveToGive/);
  assert.equal(body.has('h:List-Unsubscribe'),false);assert.equal(body.has('h:List-Unsubscribe-Post'),false);
  for(const field of ['o:tracking','o:tracking-clicks','o:tracking-opens'])assert.equal(body.get(field),'no');
  assert.equal(init.redirect,'error');assert.equal(f.effects(),1);
});
test('same logical intent reconciles across factory recreation without a second effect',async()=>{
  const f=setup(),input={to,url,purpose:'email_verification' as const,intentKey:key()};
  await f.mailer.sendAuth(input);const receipt=structuredClone([...f.store.records.values()]);
  assert.equal((await createGiveToGiveMailer(f.runtime).sendAuth(input)).state,'accepted');assert.equal(f.effects(),1);
  assert.deepEqual([...f.store.records.values()],receipt);
});
test('twelve concurrent identical requests elect one submitting claim and effect',async()=>{
  const f=setup(),input={to,url,purpose:'password_reset' as const,intentKey:key()};
  await Promise.all(Array.from({length:12},()=>f.mailer.sendAuth(input)));assert.equal(f.effects(),1);assert.equal(f.store.records.size,1);
});
test('changed recipient or token URL never rebinds the same intent',async()=>{
  const f=setup(),input={to,url,purpose:'password_reset' as const,intentKey:key()};await f.mailer.sendAuth(input);
  for(const changed of [{to:'other@example.invalid'},{url:url+'-changed'}])assert.equal((await f.mailer.sendAuth({...input,...changed})).state,'unknown');
  assert.equal(f.effects(),1);assert.equal(f.store.records.size,1);
});
for(const status of [202,408,500])test(`ambiguous provider status ${status} remains unknown and never resends`,async()=>{
  const f=setup(async()=>new Response('PRIVATE-PROVIDER-DETAIL',{status}));const input={to,url,purpose:'password_reset' as const,intentKey:key()};
  const first=await f.mailer.sendAuth(input);assert.equal(first.state,'unknown');assert.equal(first.retryAllowed,false);
  await createGiveToGiveMailer(f.runtime).sendAuth(input);assert.equal(f.effects(),1);assert.doesNotMatch(JSON.stringify(first),/PRIVATE-PROVIDER|PUBLIC-NOT-A-CREDENTIAL|example.invalid/);
});
test('network response loss is quarantined, including after factory recreation',async()=>{
  const f=setup(async()=>{throw Error('PRIVATE-ACK-LOSS');}),input={to,url,purpose:'password_reset' as const,intentKey:key()};
  assert.equal((await f.mailer.sendAuth(input)).state,'unknown');await createGiveToGiveMailer(f.runtime).sendAuth(input);assert.equal(f.effects(),1);
});
test('known acceptance with failed receipt acknowledgement is not converted to retry permission',async()=>{
  const f=setup();f.store.complete=async()=>{throw Error('PUBLIC-SYNTHETIC-LOST-COMMIT');};
  const mailer=createGiveToGiveMailer(f.runtime),input={to,url,purpose:'password_reset' as const,intentKey:key()};
  const outcome=await mailer.sendAuth(input);assert.equal(outcome.state,'accepted');assert.equal(outcome.receipt,'uncertain');assert.equal(outcome.retryAllowed,false);
  assert.equal((await mailer.sendAuth(input)).state,'unknown');assert.equal(f.effects(),1);
});
test('provider ID collision retains first association and quarantines another request',async()=>{
  const f=setup(),input={to,url,purpose:'password_reset' as const};assert.equal((await f.mailer.sendAuth({...input,intentKey:key(1)})).state,'accepted');
  const second=await f.mailer.sendAuth({...input,intentKey:key(2)});assert.equal(second.state,'unknown');
  await f.mailer.sendAuth({...input,intentKey:key(2)});assert.equal(f.effects(),2);assert.equal(f.store.ids.size,1);
});
test('stalled/late acceptance obeys total deadline and cannot trigger a second submission',async()=>{
  const f=setup(async()=>{await new Promise(r=>setTimeout(r,60));return Response.json({id:'<PUBLIC-LATE-ID>',message:'Queued'});},15);
  const input={to,url,purpose:'password_reset' as const,intentKey:key()},result=await f.mailer.sendAuth(input);
  assert.equal(result.state,'unknown');await new Promise(r=>setTimeout(r,70));await f.mailer.sendAuth(input);assert.equal(f.effects(),1);
});
test('zero-byte response stream is bounded and cancelled using the repaired transport',async()=>{
  let pulls=0,cancelled=false;const f=setup(async()=>new Response(new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(0));},cancel(){cancelled=true;}})),50);
  const result=await f.mailer.sendAuth({to,url,purpose:'password_reset',intentKey:key()});assert.equal(result.state,'unknown');assert.ok(pulls<=4098);assert.equal(cancelled,true);
});
test('HTML is escaped and action URLs cannot leak to another app or protocol',()=>{
  const message=renderMessage({app:'givetogive',kind:'email-verification',to,name:'<script>name</script>',actionURL:url});
  assert.doesNotMatch(message.html,/<script>/);assert.match(message.html,/&lt;script&gt;/);
  for(const actionURL of ['https://evil.example/','http://givetogive.ianrackson.com/','https://user:pass@givetogive.ianrackson.com/','https://givetogive.ianrackson.com/#secret'])assert.throws(()=>renderMessage({app:'givetogive',kind:'password-reset',to,actionURL}));
  assert.throws(()=>renderMessage({app:'givetogive',kind:'password-reset',to:'victim@example.invalid\r\nBcc: other@example.invalid',actionURL:url}));
});
test('forged prepared objects fail before private binding, reservation and network',async()=>{
  const f=setup(),prepared=renderMessage({app:'givetogive',kind:'password-reset',to,actionURL:url}),deliver=createMailgunDelivery(config,f.runtime);
  for(const copy of [{...prepared},Object.freeze({...prepared}),JSON.parse(JSON.stringify(prepared))])assert.equal((await deliver(key(),copy)).state,'rejected');
  assert.equal(f.store.reserveCount,0);assert.equal(f.effects(),0);
});
test('receipt model contains no recipient, access URL, body or private material',async()=>{
  const f=setup();await f.mailer.sendAuth({to,url,purpose:'password_reset',intentKey:key()});const stored=JSON.stringify([...f.store.records.values()]);
  for(const privateValue of [to,url,config.apiKey,'PUBLIC-GIVE-TEST-ONLY-BINDING-MATERIAL','<html'])assert.equal(stored.includes(privateValue),false);
});
test('campaign preparation requires app-updates scope and owned unsubscribe; no one-click claim',async()=>{
  const f=setup(),input={to,intentKey:key(),title:'<b>Update</b>',body:'<script>private</script>',actionURL:'https://givetogive.ianrackson.com/updates',subscription:{scope:'app-updates' as const,unsubscribeURL:'https://givetogive.ianrackson.com/unsubscribe?token=PUBLIC-SCOPED-FIXTURE'}};
  assert.equal((await f.mailer.sendCampaign(input)).state,'accepted');const body=f.requests[0]![1]!.body as FormData;
  assert.equal(body.get('h:List-Unsubscribe'),'<'+input.subscription.unsubscribeURL+'>');assert.equal(body.has('h:List-Unsubscribe-Post'),false);
  assert.match(String(body.get('text')),/app-updates/);assert.doesNotMatch(String(body.get('html')),/<script>/);
  assert.throws(()=>f.mailer.sendCampaign({...input,subscription:{...input.subscription,unsubscribeURL:'https://evil.example/unsubscribe'}}));
});
