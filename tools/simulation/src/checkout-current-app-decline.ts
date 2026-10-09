/** Pure comparison of ordinary cookie-session billing reads with an independently
 * obtained read-only isolated database snapshot. Not a sign-in, provider read,
 * webhook signature verification or authority to finalize a financial journal. */
import { z } from 'zod';
import { currentCheckoutCandidate as c } from './checkout-current-profile.ts';
const unpaidStatus = z.enum(['checkout_open', 'failed', 'expired']);
const subscription = z.object({ id: z.string(), kind: z.literal('supporter'), status: z.enum(['incomplete', 'incomplete_expired', 'canceled', 'past_due', 'unpaid']),
 tier: z.null(), paidThrough: z.null() });
const memberSession = z.object({ access: z.literal('active'), expires: z.string(), user: z.object({
 id: z.literal(c.memberId), email: z.literal(c.memberEmail), role: z.literal('member'), sessionVersion: z.number().int().nonnegative(),
 authenticatedAt: z.number().finite() }) });
const payment = z.object({ id: z.literal(c.operationId), kind: z.literal('supporter'), status: unpaidStatus,
 grossAmount: z.literal(500), currency: z.literal('usd'), tier: z.literal('supporter'), recurring: z.literal(true),
 livemode: z.literal(false), paidAt: z.null(), refundedAmount: z.literal(0), disputedAmount: z.literal(0) });
export function verifyCurrentDeclineAppSnapshot(raw: unknown, now = Date.now()) {
 try {
  const value = z.object({ before: memberSession, after: memberSession,
   availability: z.object({ environment: z.literal('staging'), livemode: z.literal(false), subscriptions: z.literal(true),
    askPayments: z.literal(false), funds: z.literal(false) }),
   overview: z.object({ tier: z.literal('neighbor'), paidGiving: z.literal(0), completedContributions: z.literal(0), subscriptions: z.array(subscription).max(1) }),
   subscriptions: z.array(subscription).max(1), payment,
   database: z.object({ readOnly: z.literal(true), databaseIdentity: z.literal(c.databaseIdentity), actorId: z.literal(c.memberId),
    operationId: z.literal(c.operationId), canonicalCustomerVerified: z.literal(true), memberVerifiedAndActive: z.literal(true),
    paymentStatus: unpaidStatus, paidCoverageCount: z.literal(0), paymentLedgerCount: z.literal(0), paidPaymentCount: z.literal(0),
    subscriptions: z.array(subscription).max(1), processedFailureWebhookObserved: z.boolean(), pendingOrFailedWebhookObserved: z.boolean() })
  }).parse(raw);
  const { before, after, database } = value;
  if (!Number.isFinite(now) || before.user.sessionVersion !== after.user.sessionVersion ||
   [before, after].some(session => Date.parse(session.expires) <= now + 15000 || !Number.isFinite(Date.parse(session.expires)) ||
    session.user.authenticatedAt > now + 5000) || database.paymentStatus !== value.payment.status)
   throw Error('Member identity or payment changed');
  const signature = (entries: z.infer<typeof subscription>[]) => JSON.stringify(entries.map(entry => ({
   id: entry.id, kind: entry.kind, status: entry.status, tier: entry.tier, paidThrough: entry.paidThrough })).sort((a, b) => a.id.localeCompare(b.id)));
  if (signature(value.overview.subscriptions) !== signature(value.subscriptions) || signature(value.subscriptions) !== signature(database.subscriptions))
   throw Error('Subscription observations disagree');
  return Object.freeze({ normalMemberNeighborObserved: true, canonicalDatabaseNoPaidEntitlementObserved: true,
   paidCoverageCount: 0, paymentLedgerCount: 0, originalJournalFinalizationAllowed: false,
   processedFailureWebhookObserved: database.processedFailureWebhookObserved,
   webhookProcessingPending: database.pendingOrFailedWebhookObserved, paymentAccepted: false, retryAllowed: false,
   independentProviderWebhookAndOriginalJournalReviewRequired: true });
 } catch { throw Error('Current decline app observation rejected; originals and holds retained; private details withheld.'); }
}
