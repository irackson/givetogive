import assert from 'node:assert/strict';
import test,{beforeEach,after} from 'node:test';
import {fixture} from './give-mail-test-context.mjs';
import {SyntheticReceiptStore} from './mail-fixtures/synthetic-store.ts';
const {sendAuthEmail}=await import('../../src/server/auth/email.ts');
const {createGiveMailBinding}=await import('../../src/server/mail/give-mailer.ts');
const {registrationEmailMessage,authEmailRequestMessage}=await import('../../src/lib/auth-email-status.ts');
const to='synthetic@example.invalid',url='https://givetogive.ianrackson.com/verify-email?token=PUBLIC-API-FIXTURE',intentKey='mail:'+'a'.repeat(32);
let effects=0;
const prior={app:process.env['APP_ENV'],provider:process.env['EMAIL_PROVIDER']};
beforeEach(()=>{
  effects=0;fixture.runtime=undefined;fixture.captured.length=0;fixture.sealCount=0;
  Object.assign(fixture.env,{NODE_ENV:'production',AUTH_EMAIL_STAGING_RECIPIENTS:'',GOOGLE_CLIENT_ID:'PUBLIC-GOOGLE-FIXTURE',GOOGLE_CLIENT_SECRET:'PUBLIC-GOOGLE-FIXTURE',GOOGLE_REFRESH_TOKEN:'PUBLIC-GOOGLE-FIXTURE',GMAIL_SENDER:'synthetic@example.invalid',RESEND_API_KEY:'PUBLIC-RESEND-FIXTURE',AUTH_EMAIL_FROM:'synthetic@example.invalid'});
  process.env['APP_ENV']='production';process.env['EMAIL_PROVIDER']='mailgun';
});
after(()=>{if(prior.app===undefined)delete process.env['APP_ENV'];else process.env['APP_ENV']=prior.app;if(prior.provider===undefined)delete process.env['EMAIL_PROVIDER'];else process.env['EMAIL_PROVIDER']=prior.provider;});
function admit(response:()=>Promise<Response>){fixture.runtime={config:{apiKey:'PUBLIC-MAILGUN-FIXTURE',domain:'ianrackson.com',region:'us'},store:new SyntheticReceiptStore(),bind:createGiveMailBinding(new TextEncoder().encode('PUBLIC-API-BINDING-FIXTURE-MATERIAL')),fetch:async()=>{effects++;return response();}};}
test('mailgun selection with disabled runtime reports no acceptance and never falls back to existing Gmail/Resend',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('fallback forbidden');};
  try{const result=await sendAuthEmail({to,url,purpose:'email_verification',intentKey});assert.deepEqual(result,{delivered:false,captured:false,previewUrl:undefined});assert.equal(effects,0);}finally{globalThis.fetch=old;}
});
for(const environment of ['staging','test'])test(`${environment} capture precedes Mailgun/provider selection and keeps the encrypted-sink path`,async()=>{
  process.env['APP_ENV']=environment;fixture.env['AUTH_EMAIL_STAGING_RECIPIENTS']=to;admit(async()=>Response.json({id:'<PUBLIC-ID>',message:'Queued'}));
  const result=await sendAuthEmail({to,url,purpose:'password_reset',intentKey});assert.equal(result.captured,true);assert.equal(result.delivered,false);
  assert.equal(effects,0);assert.equal(fixture.sealCount,1);assert.equal(fixture.captured[0]?.['urlCiphertext'],'SYNTHETIC-SEALED-URL');assert.equal(result.previewUrl,undefined);
});
test('even an admitted test runtime cannot generate an intent for a legacy caller',async()=>{
  admit(async()=>Response.json({id:'<PUBLIC-ID>',message:'Queued'}));assert.equal((await sendAuthEmail({to,url,purpose:'password_reset'})).delivered,false);assert.equal(effects,0);
});
test('accepted API result hides provider ID, body, token URL and configuration; duplicate does not resend',async()=>{
  admit(async()=>Response.json({id:'<PRIVATE-PROVIDER-ID>',message:'Queued'}));const input={to,url,purpose:'email_verification' as const,intentKey};
  const result=await sendAuthEmail(input);assert.equal(result.delivered,true);assert.equal((await sendAuthEmail(input)).delivered,true);assert.equal(effects,1);
  for(const value of ['PRIVATE-PROVIDER-ID',url,to,'PUBLIC-MAILGUN-FIXTURE'])assert.equal(JSON.stringify(result).includes(value),false);
});
test('unknown response remains uncertain with no fallback/resend and no new public diagnostics',async()=>{
  admit(async()=>{throw Error('PRIVATE-PROVIDER-ERROR');});const input={to,url,purpose:'password_reset' as const,intentKey};
  const first=await sendAuthEmail(input);assert.equal(first.delivered,false);assert.equal((await sendAuthEmail(input)).delivered,false);assert.equal(effects,1);
  assert.doesNotMatch(JSON.stringify(first),/PRIVATE|PROVIDER|token/);
  for(const purpose of ['email_verification','password_reset'] as const)assert.match(authEmailRequestMessage(purpose,'production',false),/^If /);
  assert.doesNotMatch(registrationEmailMessage(first.delivered,false),/PRIVATE|PROVIDER/);
});
test('explicit disabled or invalid selection cannot reach any configured legacy provider',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('provider forbidden');};
  try{for(const mode of ['disabled','invalid']){process.env['EMAIL_PROVIDER']=mode;assert.equal((await sendAuthEmail({to,url,purpose:'password_reset'})).delivered,false);}}finally{globalThis.fetch=old;}
});
