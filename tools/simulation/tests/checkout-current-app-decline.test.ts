import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { currentCheckoutCandidate as c } from '../src/checkout-current-profile.ts';
import { verifyCurrentDeclineAppSnapshot } from '../src/checkout-current-app-decline.ts';
const now = Date.now();
function fixture(): Record<string, any> {
 const session = { access: 'active', expires: new Date(now + 60000).toISOString(), user: {
  id: c.memberId, email: c.memberEmail, role: 'member', sessionVersion: 2, authenticatedAt: now - 1000 } };
 return { before: structuredClone(session), after: structuredClone(session),
  availability: { environment: 'staging', livemode: false, subscriptions: true, askPayments: false, funds: false },
  overview: { tier: 'neighbor', paidGiving: 0, completedContributions: 0, subscriptions: [] }, subscriptions: [],
  payment: { id: c.operationId, kind: 'supporter', status: 'checkout_open', grossAmount: 500, currency: 'usd', tier: 'supporter',
   recurring: true, livemode: false, paidAt: null, refundedAmount: 0, disputedAmount: 0 },
  database: { readOnly: true, databaseIdentity: c.databaseIdentity, actorId: c.memberId, operationId: c.operationId,
   canonicalCustomerVerified: true, memberVerifiedAndActive: true, paymentStatus: 'checkout_open', paidCoverageCount: 0,
   paymentLedgerCount: 0, paidPaymentCount: 0, subscriptions: [], processedFailureWebhookObserved: false, pendingOrFailedWebhookObserved: false } };
}
test('ordinary neighbor and isolated DB no-paid snapshots never authorize original journal finalization', () => {
 const result = verifyCurrentDeclineAppSnapshot(fixture(), now);
 assert.equal(result.normalMemberNeighborObserved, true); assert.equal(result.canonicalDatabaseNoPaidEntitlementObserved, true);
 assert.equal(result.paymentAccepted, false); assert.equal(result.originalJournalFinalizationAllowed, false);
 assert.equal(result.processedFailureWebhookObserved, false);
});
test('an incomplete unpaid subscription is permitted only when all ordinary and DB observations agree', () => {
 const f = fixture(), sub = { id: 'sub_fixture', kind: 'supporter', status: 'incomplete', tier: null, paidThrough: null };
 for (const entries of [f.overview.subscriptions, f.subscriptions, f.database.subscriptions]) entries.push({ ...sub });
 assert.equal(verifyCurrentDeclineAppSnapshot(f, now).paymentAccepted, false);
 f.database.subscriptions[0].id = 'sub_other'; assert.throws(() => verifyCurrentDeclineAppSnapshot(f, now), /private details withheld/);
});
test('pending or failed webhook processing is surfaced, not represented as acceptance', () => {
 const f = fixture(); f.database.pendingOrFailedWebhookObserved = true;
 const result = verifyCurrentDeclineAppSnapshot(f, now);
 assert.equal(result.webhookProcessingPending, true); assert.equal(result.paymentAccepted, false);
});
test('rejects changed identities, environment, paid entitlement and inconsistent app payment states', () => {
 const changes = [
  (f: Record<string, any>) => { f.after.user.id = 'foreign'; },
  (f: Record<string, any>) => { f.after.user.sessionVersion++; },
  (f: Record<string, any>) => { f.before.expires = 'invalid'; },
  (f: Record<string, any>) => { f.after.expires = new Date(now).toISOString(); },
  (f: Record<string, any>) => { f.after.user.role = 'admin'; },
  (f: Record<string, any>) => { f.availability.livemode = true; },
  (f: Record<string, any>) => { f.overview.tier = 'supporter'; },
  (f: Record<string, any>) => { f.overview.paidGiving = 500; },
  (f: Record<string, any>) => { f.payment.paidAt = new Date().toISOString(); },
  (f: Record<string, any>) => { f.payment.refundedAmount = 500; },
  (f: Record<string, any>) => { f.payment.status = 'succeeded'; },
  (f: Record<string, any>) => { f.database.paymentStatus = 'failed'; },
  (f: Record<string, any>) => { f.database.databaseIdentity = 'other'; },
  (f: Record<string, any>) => { f.database.paidCoverageCount = 1; },
  (f: Record<string, any>) => { f.database.paymentLedgerCount = 1; },
  (f: Record<string, any>) => { f.database.paidPaymentCount = 1; },
  (f: Record<string, any>) => { f.database.memberVerifiedAndActive = false; },
 ];
 for (const change of changes) { const f = fixture(); change(f); assert.throws(() => verifyCurrentDeclineAppSnapshot(f, now), /private details withheld/); }
});
test('database inspector import is inert without environment or secrets', () => {
 const module = new URL('../../../scripts/checkout-current-app-inspect.mjs', import.meta.url).href;
 const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `await import(${JSON.stringify(module)});`], {
  env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], TEMP: process.env['TEMP'] }, timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
 assert.equal(output, '');
});
