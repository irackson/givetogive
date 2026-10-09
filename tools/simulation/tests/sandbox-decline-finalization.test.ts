import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
function fixture() {
 const directory = mkdtempSync(join(tmpdir(), 'g2g-decline-finalization-')), path = join(directory, 'attempts.sqlite'), run = randomUUID(), operation = randomUUID();
 const ledger = new SandboxLedger(path, run, 1500, 1500);
 return { directory, path, run, operation, ledger, close: () => { ledger.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('finalizes the exact submitted decline once, preserving spent history and budget holds', () => {
 const f = fixture();
 try {
  const historical = randomUUID(); f.ledger.reserve(historical, 'member', 1000, 'success'); f.ledger.update(historical, 'ambiguous');
  f.ledger.reserve(f.operation, 'member', 500, 'decline'); f.ledger.update(f.operation, 'submitted');
  const before = f.ledger.get(f.operation)!; f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500);
  const after = f.ledger.get(f.operation)!;
  assert.equal(after.state, 'verified_decline'); assert.equal(after.amountCents, before.amountCents); assert.equal(after.actorId, before.actorId);
  assert.equal(f.ledger.get(historical)?.state, 'ambiguous');
  assert.throws(() => f.ledger.reserve(randomUUID(), 'member', 1, 'success'), /budget exhausted/);
  assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500), /once/);
  assert.deepEqual(f.ledger.get(f.operation), after);
 } finally { f.close(); }
});
test('rejects missing, unsubmitted, ambiguous, foreign and wrong-amount attempts without rewriting them', () => {
 const f = fixture();
 try {
  assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500), /once/);
  f.ledger.reserve(f.operation, 'member', 500, 'decline');
  let before = f.ledger.get(f.operation);
  assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500), /once/); assert.deepEqual(f.ledger.get(f.operation), before);
  f.ledger.update(f.operation, 'submitted'); before = f.ledger.get(f.operation);
  for (const [actor, amount] of [['foreign', 500], ['member', 501]] as const) {
   assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, actor, amount), /once/); assert.deepEqual(f.ledger.get(f.operation), before);
  }
  f.ledger.update(f.operation, 'ambiguous'); before = f.ledger.get(f.operation);
  assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500), /once/); assert.deepEqual(f.ledger.get(f.operation), before);
 } finally { f.close(); }
});
test('a submitted success scenario cannot be relabeled as a decline', () => {
 const f = fixture();
 try { f.ledger.reserve(f.operation, 'member', 500, 'success'); f.ledger.update(f.operation, 'submitted');
  const before = f.ledger.get(f.operation); assert.throws(() => f.ledger.finalizeSubmittedDecline(f.operation, 'member', 500), /once/);
  assert.deepEqual(f.ledger.get(f.operation), before);
 } finally { f.close(); }
});
test('two actual SQLite processes finalize one original decline exactly once', async () => {
 const f = fixture();
 try {
  f.ledger.reserve(f.operation, 'member', 500, 'decline'); f.ledger.update(f.operation, 'submitted');
  const module = new URL('../src/sandbox-ledger.ts', import.meta.url).href;
  const code = `const {SandboxLedger}=await import(${JSON.stringify(module)});const ledger=new SandboxLedger(${JSON.stringify(f.path)},${JSON.stringify(f.run)},1500,1500);try{ledger.finalizeSubmittedDecline(${JSON.stringify(f.operation)},'member',500);process.stdout.write('won');}catch{process.stdout.write('rejected');}finally{ledger.close();}`;
  const child = () => new Promise<string>((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { timeout: 15000, windowsHide: true },
   (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.deepEqual((await Promise.all([child(), child()])).sort(), ['rejected', 'won']);
  assert.equal(f.ledger.get(f.operation)?.state, 'verified_decline'); assert.equal(f.ledger.get(f.operation)?.amountCents, 500);
 } finally { f.close(); }
});
