// Explicit read-only post-submit isolated DB observation. Import is inert. No
// member sign-in, provider request, entitlement write or financial journal update.
import { currentCheckoutCandidate as c } from '../tools/simulation/src/checkout-current-profile.ts';
import { isolatedConfiguration, verifyIsolatedTarget } from './isolated-environment.ts';
const guard = value => { if (!value) throw Error('Current decline database observation rejected; private details withheld.'); };
export async function inspectCurrentDeclineApp(target) {
 let sql;
 try {
  guard(target && /^cs_test_[A-Za-z0-9]+$/.test(target.sessionId) && /^acct_[A-Za-z0-9]+$/.test(target.customerAccountId));
  const configuration = isolatedConfiguration(process.env, 'staging');
  guard(configuration.identity === c.databaseIdentity && process.env.STRIPE_PLATFORM_ACCOUNT_ID === 'acct_1UKPU8Ded7vKVapt');
  const { default: postgres } = await import('postgres');
  sql = postgres(configuration.directUrl, { max: 1, connect_timeout: 15, idle_timeout: 5, onnotice() {} });
  return await sql.begin('read only', async tx => {
   await tx.unsafe("SET LOCAL statement_timeout='15000ms'"); await verifyIsolatedTarget(tx, configuration);
   const members = await tx.unsafe('SELECT u.id,u.email,u.role,u.session_version,u.is_synthetic,u.email_verified IS NOT NULL AS verified,u.frozen_at IS NOT NULL AS frozen,a.id AS agent_id FROM givetogive_user u JOIN givetogive_simulation_agent a ON a.user_id=u.id WHERE a.run_id=$1 AND u.id=$2', [c.runId, c.memberId]);
   guard(members.length === 1 && members[0].email === c.memberEmail && members[0].role === 'member' && members[0].is_synthetic &&
    members[0].verified && !members[0].frozen && members[0].agent_id === c.agentId);
   const accounts = await tx.unsafe('SELECT stripe_account_id,livemode FROM givetogive_payment_account WHERE user_id=$1', [c.memberId]);
   guard(accounts.length === 1 && accounts[0].stripe_account_id === target.customerAccountId && accounts[0].livemode === false);
   const rows = await tx.unsafe('SELECT actor_id,status,checkout_id,invoice_id,payment_intent_id,livemode,gross_amount,paid_at,currency,kind,tier,recurring,refunded_amount,disputed_amount FROM givetogive_payment WHERE id=$1', [c.operationId]);
   const p = rows[0]; guard(rows.length === 1 && p.actor_id === c.memberId && p.checkout_id === target.sessionId && !p.livemode &&
    p.gross_amount === 500 && p.paid_at === null && p.currency === 'usd' && p.kind === 'supporter' && p.tier === 'supporter' && p.recurring &&
    p.refunded_amount === 0 && p.disputed_amount === 0 && ['checkout_open','failed','expired'].includes(p.status));
   guard(!p.invoice_id || p.invoice_id === target.invoiceId); guard(!p.payment_intent_id || p.payment_intent_id === target.paymentIntentId);
   const subscriptions = await tx.unsafe('SELECT id,kind,status,paid_through AS "paidThrough",initial_payment_id,account_id,livemode FROM givetogive_payment_subscription WHERE actor_id=$1', [c.memberId]);
   guard(subscriptions.length <= 1 && subscriptions.every(sub => sub.initial_payment_id === c.operationId && sub.account_id === target.customerAccountId && !sub.livemode && sub.paidThrough === null));
   const [counts] = await tx.unsafe('SELECT (SELECT count(*)::int FROM givetogive_supporter_paid_coverage c JOIN givetogive_payment_subscription s ON s.id=c.subscription_id WHERE s.actor_id=$1) AS coverage,(SELECT count(*)::int FROM givetogive_payment_ledger l JOIN givetogive_payment p ON p.id=l.payment_id WHERE p.actor_id=$1) AS ledger,(SELECT count(*)::int FROM givetogive_payment WHERE actor_id=$1 AND (paid_at IS NOT NULL OR status IN (\'succeeded\',\'refunded\',\'partially_refunded\'))) AS paid', [c.memberId]);
   guard(counts.coverage === 0 && counts.ledger === 0 && counts.paid === 0);
   const ids = [target.sessionId, target.invoiceId, target.paymentIntentId].filter(Boolean);
   const hooks = await tx.unsafe('SELECT stripe_event_id,object_id,type,status,processed_at FROM givetogive_payment_webhook_inbox WHERE object_id=ANY($1::text[]) AND stripe_account_id=$2 AND livemode=false LIMIT 101', [ids, process.env.STRIPE_PLATFORM_ACCOUNT_ID]);
   guard(hooks.length <= 100);
   return { readOnly: true, databaseIdentity: c.databaseIdentity, actorId: c.memberId, operationId: c.operationId,
    canonicalCustomerVerified: true, memberVerifiedAndActive: true, memberSessionVersion: members[0].session_version, paymentStatus: p.status,
    paidCoverageCount: 0, paymentLedgerCount: 0, paidPaymentCount: 0,
    subscriptions: subscriptions.map(sub => ({ id: sub.id, kind: sub.kind, status: sub.status, tier: null, paidThrough: sub.paidThrough })),
    failureEvents: hooks.filter(h => ['payment_intent.payment_failed','invoice.payment_failed'].includes(h.type)).map(h => ({
     eventId: h.stripe_event_id, objectId: h.object_id, type: h.type, status: h.status, processedAt: h.processed_at })),
    processedFailureWebhookObserved: hooks.some(h => ['payment_intent.payment_failed','invoice.payment_failed','checkout.session.async_payment_failed'].includes(h.type) && h.status === 'processed' && h.processed_at),
    pendingOrFailedWebhookObserved: hooks.some(h => ['pending','failed'].includes(h.status)) };
  });
 } catch { throw Error('Current decline database observation rejected; private details withheld.'); }
 finally { await sql?.end({ timeout: 5 }); }
}
