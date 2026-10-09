import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { currentCheckoutCapabilityEvidence, currentCheckoutSourceEvidence, validateCurrentCheckoutPreflightContext } from '../src/checkout-current-preflight.ts';

const head = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY:'irackson/givetogive',GITHUB_REF:'refs/heads/main',GITHUB_JOB:'verify',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_ACTOR:'irackson',GITHUB_TRIGGERING_ACTOR:'irackson',
 GITHUB_SHA:head,GITHUB_RUN_ID:'123' };
test('current source preflight has its own read-only workflow context and no transfer credentials', () => {
 assert.equal(validateCurrentCheckoutPreflightContext(env,'linux',24),head);
 assert.equal(validateCurrentCheckoutPreflightContext({...env,GITHUB_EVENT_NAME:'workflow_dispatch'},'linux',24),head);
 for (const change of [{GITHUB_REF:'refs/heads/other'},{GITHUB_JOB:'checkout-parent'},
  {GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTOR:'other'},
  {GITHUB_TRIGGERING_ACTOR:'other'},{GITHUB_SHA:'invalid'},{GITHUB_RUN_ID:'0'},
  {STRIPE_SECRET_KEY:'public-fixture'},{CHECKOUT_BUNDLE_KEY:'public-fixture'},
  {CHECKOUT_GITHUB_TOKEN:'public-fixture'},{COMMUNITY_RECOVERY_TOKEN:'public-fixture'},
  {SIM_CREDENTIALS:'public-fixture'},{GOOGLE_REFRESH_TOKEN:'public-fixture'},{VERCEL_TOKEN:'public-fixture'}])
  assert.throws(()=>validateCurrentCheckoutPreflightContext({...env,...change},'linux',24));
 assert.throws(()=>validateCurrentCheckoutPreflightContext(env,'win32',24));
 assert.throws(()=>validateCurrentCheckoutPreflightContext(env,'linux',22));
});
test('fresh source evidence must match the staged canonical app and lock, without extending financial approval', () => {
 const source = {canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest,
  rootLockDigest:checkoutReleaseBinding.lockDigest,runnerDigest:'b'.repeat(64)};
 const evidence=currentCheckoutSourceEvidence(source,head);
 assert.equal(evidence.financialSourceApprovalStillRequired,true);
 assert.equal(evidence.financialAdmission,false);
 assert.equal(evidence.historicalApprovalReused,false);
 assert.equal(evidence.nativeWaitingParent,false);
 assert.equal(evidence.checkoutPrepared,false);
 assert.equal(evidence.memberActions,0);
 for (const key of Object.keys(source)) {
  assert.throws(()=>currentCheckoutSourceEvidence({...source,[key]:'invalid'},head));
  assert.throws(()=>currentCheckoutSourceEvidence({...source,[key]:undefined} as never,head));
 }
 assert.throws(()=>currentCheckoutSourceEvidence({canonicalSourceDigest:source.canonicalSourceDigest,rootLockDigest:source.rootLockDigest} as never,head));
 assert.throws(()=>currentCheckoutSourceEvidence({...source,unexpected:'c'.repeat(64)} as never,head));
 assert.throws(()=>currentCheckoutSourceEvidence({...source,canonicalSourceDigest:'c'.repeat(64)},head));
 assert.throws(()=>currentCheckoutSourceEvidence({...source,rootLockDigest:'c'.repeat(64)},head));
 assert.throws(()=>currentCheckoutSourceEvidence(source,'invalid'));
});

test('credential-free capability observes unpublished sources without admitting a financial profile', () => {
 const unpublished = {canonicalSourceDigest:'c'.repeat(64),rootLockDigest:checkoutReleaseBinding.lockDigest,runnerDigest:'b'.repeat(64)};
 const observation = currentCheckoutCapabilityEvidence(unpublished,head);
 assert.equal(observation.stagedSourceMatches,false);
 assert.equal(observation.canonicalSourceDigest,unpublished.canonicalSourceDigest);
 assert.equal(observation.financialSourceApprovalStillRequired,true);
 assert.equal(observation.nativeWaitingParent,false);
 assert.equal(observation.memberActions,0);
 assert.equal(observation.checkoutPrepared,false);
 assert.equal(observation.financialAdmission,false);
 assert.equal(observation.paymentAccepted,false);
 assert.throws(()=>currentCheckoutSourceEvidence(unpublished,head));
 assert.throws(()=>currentCheckoutCapabilityEvidence({...unpublished,runnerDigest:'invalid'},head));
 assert.throws(()=>currentCheckoutCapabilityEvidence({...unpublished,extra:true} as never,head));
 assert.throws(()=>currentCheckoutCapabilityEvidence(unpublished,'invalid'));
 const matching={...unpublished,canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest};
 assert.equal(currentCheckoutCapabilityEvidence(matching,head).stagedSourceMatches,true);
});
test('preflight import and default command are inert; unsupported financial commands reject', () => {
 const url=new URL('../src/checkout-current-preflight.ts',import.meta.url),path=fileURLToPath(url);
 const result=JSON.parse(execFileSync(process.execPath,[path],{encoding:'utf8'}));
 assert.deepEqual(result,{execute:false,externalRequests:0,financialAdmission:false});
 const imported=execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(url.href)});console.log('inert');`],{encoding:'utf8'});
 assert.equal(imported.trim(),'inert');
 for(const args of [['--purchase'],['--execute-credential-free','--retry']]) {
  const child=spawnSync(process.execPath,[path,...args],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.stdout,'');
  assert.match(child.stderr,/Current Checkout preflight rejected; no financial admission/);
 }
});
