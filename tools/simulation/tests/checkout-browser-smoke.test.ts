import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckoutSmokeContext } from '../src/checkout-browser-smoke.ts';
import { approved } from '../src/hosted-checkout-policy.ts';
test('credential-free Checkout smoke uses its own exact workflow identity, not a forged community identity',()=>{
 const env={GITHUB_REPOSITORY:approved.repository,GITHUB_ACTOR:approved.actor,GITHUB_TRIGGERING_ACTOR:approved.actor,
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'checkout-parent',GITHUB_SHA:'a'.repeat(40)};
 assert.equal(validateCheckoutSmokeContext(env,'linux',24),'a'.repeat(40));
 for(const change of [{GITHUB_JOB:'staging-community'},{GITHUB_ACTOR:'other'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},
  {CHECKOUT_BUNDLE_KEY:'PUBLIC-FIXTURE'},{CHECKOUT_GITHUB_TOKEN:'PUBLIC-FIXTURE'},{STRIPE_SECRET_KEY:'PUBLIC-FIXTURE'},
  {DATABASE_URL:'PUBLIC-FIXTURE'},{SIM_CREDENTIALS:'PUBLIC-FIXTURE'}])
  assert.throws(()=>validateCheckoutSmokeContext({...env,...change},'linux',24));
 assert.throws(()=>validateCheckoutSmokeContext(env,'win32',24));
 assert.throws(()=>validateCheckoutSmokeContext(env,'linux',22));
});
