// Local operator prerequisite reads. Default is inert; no key dump, sign-in,
// preparation, provider mutation, schema write, budget reset or grant.
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { inspectOriginalCheckoutBudget } from '../tools/simulation/src/checkout-original-budget.ts';
import { approved } from '../tools/simulation/src/hosted-checkout-policy.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const guard = value => { if (!value) throw Error('Checkout operator prerequisites rejected; private details withheld.'); };

export async function inspectLocalCheckoutPrerequisites() {
 let sql;
 const start = Date.now();
 const active = () => guard(Date.now() >= start && Date.now() - start <= 90000);
 try {
  guard(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) === 24);
  const { isolatedConfiguration, verifyIsolatedTarget } = await import('./isolated-environment.ts');
  const configuration = isolatedConfiguration(process.env, 'staging');
  guard(configuration.identity === approved.databaseIdentity && process.env.APP_URL === approved.origin &&
   process.env.SUPPORTERS_ENABLED === 'true' && process.env.PAYMENTS_ENABLED === 'false' && process.env.FUNDS_ENABLED === 'false' &&
   process.env.STRIPE_LIVE_APPROVED === 'false' && process.env.STRIPE_PLATFORM_ACCOUNT_ID === approved.platformAccountId &&
   /^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY ?? ''));
  const original = inspectOriginalCheckoutBudget(join(root, 'tmp/stripe-test-acceptance-manual', approved.runId));
  const { default: postgres } = await import('postgres');
  sql = postgres(configuration.directUrl, { max: 1, connect_timeout: 15, idle_timeout: 5, onnotice() {} });
  const snapshot = await sql.begin('read only', async tx => {
   await verifyIsolatedTarget(tx, configuration); active();
   const runs = await tx.unsafe('SELECT mode,environment,database_identity,agent_count,status FROM givetogive_simulation_run WHERE id=$1', [approved.runId]);
   guard(runs.length === 1 && runs[0].mode === 'deterministic' && runs[0].environment === 'staging' &&
    runs[0].database_identity === approved.databaseIdentity && runs[0].agent_count === 3 && ['created','paused','running'].includes(runs[0].status));
   const members = await tx.unsafe('SELECT a.id AS agent_id,u.id,u.email,u.role,u.is_synthetic,u.email_verified IS NOT NULL AS verified,u.frozen_at IS NOT NULL AS frozen FROM givetogive_user u JOIN givetogive_simulation_agent a ON a.user_id=u.id WHERE a.run_id=$1 ORDER BY u.id', [approved.runId]);
   guard(members.length === 3);
   for (const [index, member] of members.entries()) {
    const suffix = String(index + 1).padStart(3, '0');
    guard(member.id === `synthetic-6658c4939d672ff5-${suffix}` && member.agent_id === `bot_6658c4939d672ff5_${suffix}` &&
     member.email === `neighbor-6658c4939d672ff5-${suffix}@givetogive.invalid` && member.role === 'member' && member.is_synthetic && member.verified && !member.frozen);
   }
   const accounts = [];
   for (const member of members) {
    const mappings = await tx.unsafe('SELECT stripe_account_id,livemode FROM givetogive_payment_account WHERE user_id=$1', [member.id]);
    const bindings = await tx.unsafe("SELECT entity_id,run_id,environment,outcome,details FROM givetogive_operation_event WHERE actor_id=$1 AND action='simulation_clock_bind'", [member.id]);
    guard(mappings.length === 1 && mappings[0].livemode === false && bindings.length === 1 && bindings[0].run_id === approved.runId &&
     bindings[0].environment === 'staging' && bindings[0].outcome === 'completed' && bindings[0].details.accountId === mappings[0].stripe_account_id &&
     bindings[0].details.version === 1 && bindings[0].details.databaseIdentity === approved.databaseIdentity && bindings[0].details.livemode === false);
    accounts.push({ actorId: member.id, customerAccountId: mappings[0].stripe_account_id, clockId: bindings[0].entity_id });
   }
   guard(new Set(accounts.map(account => account.clockId)).size === 1 && new Set(accounts.map(account => account.customerAccountId)).size === 3);
   const payments = await tx.unsafe('SELECT id,actor_id,status,livemode,gross_amount,paid_at,recurring,currency,kind,tier FROM givetogive_payment WHERE actor_id=ANY($1::text[])', [members.map(member => member.id)]);
   guard(payments.length === 2 && payments.every(payment => payment.actor_id === members[0].id && payment.status === 'expired' && payment.livemode === false &&
    payment.gross_amount === 500 && payment.paid_at === null && payment.recurring === true && payment.currency === 'usd' && payment.kind === 'supporter' && payment.tier === 'supporter') &&
    new Set(payments.map(payment => payment.id)).size === 2 && payments.some(payment => payment.id === 'f827ab6e-ae5e-477c-935e-4e5c66b91636') &&
    payments.some(payment => payment.id === '51033cb7-0087-4b98-9a56-62e2cd35d477'));
   const [counts] = await tx.unsafe('SELECT (SELECT count(*)::int FROM givetogive_payment_subscription WHERE actor_id=ANY($1::text[])) AS subscriptions,(SELECT count(*)::int FROM givetogive_supporter_paid_coverage c JOIN givetogive_payment_subscription s ON s.id=c.subscription_id WHERE s.actor_id=ANY($1::text[])) AS coverage,(SELECT count(*)::int FROM givetogive_payment_ledger l JOIN givetogive_payment p ON p.id=l.payment_id WHERE p.actor_id=ANY($1::text[])) AS ledger', [members.map(member => member.id)]);
   guard(counts.subscriptions === 0 && counts.coverage === 0 && counts.ledger === 0); active();
   return { accounts, expiredPayments: payments.length };
  });
  const { stripeClient } = await import('../src/server/payments/stripe.ts');
  const { stripeCheckoutReads } = await import('../tools/simulation/src/checkout-provider-proof.ts');
  const stripe = stripeClient(); guard(stripe.getMaxNetworkRetries() === 2);
  const reads = stripeCheckoutReads(stripe);
  const platform = await reads.platform(); active(); const balance = await reads.balance(); active();
  guard(platform.id === approved.platformAccountId && balance.livemode === false);
  const clock = await reads.clock(snapshot.accounts[0].clockId); active();
  guard(clock.id === snapshot.accounts[0].clockId && clock.name === `givetogive:${approved.runId}` && clock.livemode === false &&
   clock.status === 'ready' && clock.frozen_time === 1791055028);
  for (const account of snapshot.accounts) {
   const customer = await reads.customer(account.customerAccountId); active();
   guard(customer.id === account.customerAccountId && customer.livemode === false && customer.configuration?.customer?.test_clock === clock.id);
   const invoices = await reads.invoices(account.customerAccountId); active();
   const subscriptions = await reads.subscriptions(account.customerAccountId); active();
   guard(Array.isArray(invoices.data) && invoices.data.length === 0 && invoices.has_more === false &&
    Array.isArray(subscriptions.data) && subscriptions.data.length === 0 && subscriptions.has_more === false);
  }
  return { original, target: snapshot.accounts.find(account => account.actorId === approved.actorId),
   summary: { observedAt: new Date(start).toISOString(), environment: 'staging', readOnly: true,
    originalBudgetVerified: true, priorExpiredReservedCents: 1000, candidateReservedCents: 1500, candidateUnused: true,
    activeSyntheticMembers: 3, restrictedDatabaseRoleVerified: true, providerIdentityVerified: true, providerTestMode: true,
    allThreeCanonicalClockBindingsVerified: true, clockReady: true, providerInvoicesAbsent: true, providerSubscriptionsAbsent: true,
    appSubscriptions: 0, paidCoverage: 0, ledgerEntries: 0, memberActions: 0, databaseWrites: 0,
    checkoutCreated: false, submitAttempted: false, paymentAccepted: false, releaseVerificationStillRequired: true } };
 } catch { throw Error('Checkout operator prerequisites rejected; private details withheld.'); }
 finally { await sql?.end({ timeout: 5 }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  if (process.argv.length === 3 && process.argv[2] === '--inspect-readonly') {
   const result = await inspectLocalCheckoutPrerequisites(); console.log(JSON.stringify(result.summary));
  } else {
   guard(process.argv.length === 2); console.log(JSON.stringify({ execute: false, externalRequests: 0, databaseWrites: 0,
    memberActions: 0, checkoutCreated: false, paymentAccepted: false }));
  }
 } catch { console.error('Checkout operator prerequisites rejected; private details withheld.'); process.exitCode = 1; }
}
