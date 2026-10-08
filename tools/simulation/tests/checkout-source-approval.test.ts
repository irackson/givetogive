import test from 'node:test';
import assert from 'node:assert/strict';
import { approved, approvedSourceTuples, approvedSourceTuple } from '../src/hosted-checkout-policy.ts';

test('source approvals preserve historical evidence and match only whole immutable tuples', () => {
 assert.equal(Object.isFrozen(approvedSourceTuples), true);
 const historical = { sourceDigest: approved.sourceDigest, canonicalSourceDigest: approved.canonicalSourceDigest,
  rootLockDigest: approved.rootLockDigest, runnerDigest: approved.runnerDigest };
 assert.deepEqual(approvedSourceTuple(historical), historical);
 for (const tuple of approvedSourceTuples) {
  assert.equal(Object.isFrozen(tuple), true);
  assert.deepEqual(approvedSourceTuple(tuple), tuple);
  const { sourceDigest: _source, ...native } = tuple;
  assert.deepEqual(approvedSourceTuple(native), tuple);
  for (const key of ['sourceDigest','canonicalSourceDigest','rootLockDigest','runnerDigest'] as const)
   assert.equal(approvedSourceTuple({ ...tuple, [key]: 'f'.repeat(64) }), undefined);
  for (const other of approvedSourceTuples) {
   const mixed = { ...tuple, runnerDigest: other.runnerDigest };
   if (!approvedSourceTuples.some(value => Object.keys(mixed).every(key => value[key as keyof typeof value] === mixed[key as keyof typeof mixed])))
    assert.equal(approvedSourceTuple(mixed), undefined);
  }
 }
});
