import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { approved } from '../src/hosted-checkout-policy.ts';
import { inspectOriginalCheckoutBudget } from '../src/checkout-original-budget.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const originalId = 'f827ab6e-ae5e-477c-935e-4e5c66b91636', replacementId = '51033cb7-0087-4b98-9a56-62e2cd35d477';
function fixture(mode = 'ok') {
 const directory = mkdtempSync(join(tmpdir(), 'g2g-budget-'));
 const entries = [originalId, approved.operationId, '90aa9334-4553-4814-ad41-f172ef98c0a9'].map((operationId, index) => ({
  role: ['supporter', 'sustainer', 'clock-supporter'][index], actorId: `synthetic-6658c4939d672ff5-${String(index + 1).padStart(3, '0')}`,
  agentId: `bot_6658c4939d672ff5_${String(index + 1).padStart(3, '0')}`, operationId, maximumAmountCents: index === 1 ? 1500 : 500,
  scenario: 'success', expectedTier: index === 1 ? 'sustainer' : 'supporter',
  checkout: { kind: 'supporter', tier: index === 1 ? 'sustainer' : 'supporter', recurring: true } }));
 const plan = { version: 1, runId: approved.runId, credentialIdentityDigest: 'a'.repeat(64), runBudgetCents: 2500,
  actorBudgetCents: 1500, additionalOneRenewalBudgetCents: 2500, entries };
 const replacement = { ...entries[0], operationId: replacementId }, sqlite = join(directory, 'admission.sqlite');
 writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan));
 writeFileSync(join(directory, 'supporter-replacement-plan.json'), JSON.stringify(replacement));
 const db = new DatabaseSync(sqlite);
 db.exec('CREATE TABLE manual_plan_anchor(run_id TEXT PRIMARY KEY,digest TEXT); CREATE TABLE ui_checkout_budget(run_id TEXT PRIMARY KEY,run_budget INTEGER,actor_budget INTEGER); CREATE TABLE ui_checkout_intent(run_id TEXT,operation_id TEXT,actor_id TEXT,request_hash TEXT,maximum_cents INTEGER,state TEXT,PRIMARY KEY(run_id,operation_id))');
 db.prepare('INSERT INTO manual_plan_anchor VALUES (?,?)').run(approved.runId, mode === 'wrong-anchor' ? 'f'.repeat(64) : hash(JSON.stringify(plan)));
 db.prepare('INSERT INTO manual_plan_anchor VALUES (?,?)').run(`replacement:${replacementId}`, hash(JSON.stringify(replacement)));
 db.prepare('INSERT INTO ui_checkout_budget VALUES (?,?,?)').run(approved.runId, mode === 'changed-budget' ? 3000 : 2500, 1500);
 for (const id of [originalId, replacementId]) {
  db.prepare('INSERT INTO ui_checkout_intent VALUES (?,?,?,?,?,?)').run(approved.runId, id, entries[0]!.actorId!,
   hash(JSON.stringify({ ...entries[0]!.checkout, operationId: id })), 500, 'prepared');
 }
 if (mode === 'consumed-candidate') db.prepare('INSERT INTO ui_checkout_intent VALUES (?,?,?,?,?,?)').run(approved.runId, approved.operationId,
  approved.actorId, 'f'.repeat(64), 1500, 'unresolved');
 if (mode === 'wrong-request') db.exec("UPDATE ui_checkout_intent SET request_hash='changed'");
 db.close();
 for (const [id, filename] of [[originalId, 'supporter-expiry-reconciliation.json'], [replacementId, 'supporter-replacement-expiry-final-2026-10-03.json']]) {
  writeFileSync(join(directory, filename!), JSON.stringify({ runId: approved.runId, operationId: id, readOnly: true, appStatus: 'expired',
   normalUiPaymentStatus: 'expired', providerStatus: mode === 'unproven-expiry' ? 'open' : 'expired', providerPaymentStatus: 'unpaid',
   providerInvoiceAbsent: true, providerSubscriptionAbsent: true, appPaidAtAbsent: true, prepareReplayAllowed: false,
   originalAdmissionPreserved: true, financialSubmitJournalExists: false }));
 }
 return { directory, sqlite };
}
test('SELECT-only inspection preserves original budget/anchors and produces exact recurring candidate', () => {
 const f = fixture(), before = hash(readFileSync(f.sqlite).toString('base64'));
 const result = inspectOriginalCheckoutBudget(f.directory);
 assert.equal(result.candidateUnused, true); assert.equal(result.priorExpiredReservedCents, 1000);
 assert.equal(result.plan.steps[0]!.operationId, approved.operationId); assert.equal(result.plan.steps[0]!.checkout.recurring, true);
 assert.equal(result.additionalRenewalBudgetNotAdmitted, true); assert.equal(result.paymentAccepted, false);
 assert.equal(new Set(result.expiredHistoryDigests).size, 2);
 assert.equal(hash(readFileSync(f.sqlite).toString('base64')), before);
});
test('changed anchors/budgets/request, unproven expiry or consumed candidate cannot reset admission', () => {
 for (const mode of ['wrong-anchor', 'changed-budget', 'wrong-request', 'unproven-expiry', 'consumed-candidate']) {
  const f = fixture(mode), before = hash(readFileSync(f.sqlite).toString('base64'));
  assert.throws(() => inspectOriginalCheckoutBudget(f.directory), /Original Checkout budget unconfirmed/);
  assert.equal(hash(readFileSync(f.sqlite).toString('base64')), before);
 }
});
