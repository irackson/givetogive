// Authenticated-envelope shape fixtures only; no native job/provider authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { privateFile } from '../src/hosted-community-bundle.ts';
import { validatePreparedHandoffFailure, preparedHandoffBinding as b } from '../../../scripts/checkout-prepared-handoff-inspect.mjs';
function fixture(patch:object={}) {
 const worker={protocol:1,purpose:'current-member-receipt',phase:'opening',failed:true,
  memberSignIns:1,noticeRequests:0,submitAttempts:0,apiDisposed:true,driverClosed:true,
  executionEvidence:'native-playwright-adapter',paymentAccepted:false,retryAllowed:false,
  independentJobOsProviderLedgerVerificationRequired:true,privateDetailsWithheld:true,...patch};
 const parent={worker,executionEvidence:'native-linux-parent',cleanup:{ownedGroupClosed:true,exitObserved:false,exitCode:null,
  publicOutputBytes:0,escapedDescendantObserved:false,paymentAccepted:false,retryAllowed:false}};
 return {protocol:1,purpose:'current-checkout-native-originals',profileDigest:'f'.repeat(64),
  binding:{releaseId:42,operationId:b.operationId,job:{id:'113939127604',nonce:'1f8e6f6d5714013aa242a7a0cce8ef06',headSha:b.headSha}},
  files:[privateFile('parent/worker-receipt.json',Buffer.from(JSON.stringify(worker))),privateFile('parent/parent-receipt.json',Buffer.from(JSON.stringify(parent)))],
  excludedMemberRuntimeDirectories:true,independentClosureAndSettlementRequired:true,paymentAccepted:false,retryAllowed:false};
}
test('failed preparation-free financial phase is classified without erasing the original exit-event gap',()=>{
 const result=validatePreparedHandoffFailure(fixture(),'f'.repeat(64));
 assert.equal(result.previousSubmitAttempts,0);assert.equal(result.originalExitEventUnobserved,true);
 assert.equal(result.financialAdmission,false);assert.equal(result.paymentAccepted,false);
});
test('submission, notice, changed phase, forged digest and extra private phases are ineligible',()=>{
 for(const patch of [{submitAttempts:1},{noticeRequests:1},{phase:'fixture'},{failed:false}])
  assert.throws(()=>validatePreparedHandoffFailure(fixture(patch),'f'.repeat(64)));
 assert.throws(()=>validatePreparedHandoffFailure(fixture(),'e'.repeat(64)));
 const extra=fixture();extra.files.push(privateFile('exchange/submission-request.g2genc',Buffer.from('offline fixture')));
 assert.throws(()=>validatePreparedHandoffFailure(extra,'f'.repeat(64)));
 const corrupt=fixture();corrupt.files[0]!.digest='e'.repeat(64);
 assert.throws(()=>validatePreparedHandoffFailure(corrupt,'f'.repeat(64)));
 const duplicate=fixture();duplicate.files.push(duplicate.files[0]!);
 assert.throws(()=>validatePreparedHandoffFailure(duplicate,'f'.repeat(64)));
});
