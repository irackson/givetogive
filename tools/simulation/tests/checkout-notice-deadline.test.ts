// Pure elapsed-time tests; no browser, provider, authorization or payment proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeObservationDeadline } from '../src/stripe-checkout-driver.ts';
test('authorized broker wait is excluded from DOM settling time, not from proof freshness',()=>{
 assert.equal(noticeObservationDeadline(15000,1000,21000),35000);
 assert.equal(noticeObservationDeadline(15000,1000,1000),15000);
});
test('unbounded waits, backward clocks and nonfinite values cannot extend a DOM deadline',()=>{
 for(const values of [[15000,1000,999],[15000,1000,61001],[NaN,1000,1001],[15000,Infinity,Infinity]])
  assert.throws(()=>noticeObservationDeadline(values[0]!,values[1]!,values[2]!));
});
