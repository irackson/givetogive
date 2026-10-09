/** Synthetic handles only; never evidence of native browser or OS cleanup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { StripeCheckoutDriver } from '../src/stripe-checkout-driver.ts';
const email='public-fixture@givetogive.invalid',bypass='public-fixture-bypass-only';
test('waiting driver binds staging access once only after a connected browser and before context/session',()=>{
 const driver=new StripeCheckoutDriver('',email);assert.throws(()=>driver.bindPreparedStagingAccess(bypass));
 Object.assign(driver,{browser:{isConnected:()=>true}});driver.bindPreparedStagingAccess(bypass);
 assert.throws(()=>driver.bindPreparedStagingAccess(bypass));
 const other=new StripeCheckoutDriver('',email);Object.assign(other,{browser:{isConnected:()=>true},context:{}});
 assert.throws(()=>other.bindPreparedStagingAccess(bypass));
});
test('close confirmation reflects both actual protocol calls and retains failed-close handles',async()=>{
 for(const fail of ['none','context','browser']){const driver=new StripeCheckoutDriver('',email),calls:string[]=[];
  const context={async close(){calls.push('context');if(fail==='context')throw Error('private-context-error');}},
   browser={async close(){calls.push('browser');if(fail==='browser')throw Error('private-browser-error');}};
  Object.assign(driver,{context,browser});const result=await driver.closeConfirmed();
  assert.deepEqual(calls,['context','browser']);assert.equal(result.contextClosed,fail!=='context');assert.equal(result.browserClosed,fail!=='browser');
  assert.equal(result.independentOsClosureRequired,true);assert.equal(result.paymentAccepted,false);
  const retained=driver as unknown as {context?:unknown;browser?:unknown};
  assert.equal(retained.context,fail==='context'?context:undefined);assert.equal(retained.browser,fail==='browser'?browser:undefined);
 }
});
test('generic executor close also rejects unconfirmed cleanup instead of silently returning success',async()=>{
 const driver=new StripeCheckoutDriver('',email);let calls=0;
 const browser={async close(){calls++;throw Error('private-close-error');}};Object.assign(driver,{browser});
 await assert.rejects(driver.close(),/protocol closure is unconfirmed/);assert.equal(calls,1);
 assert.equal((driver as unknown as {browser:unknown}).browser,browser);
});
