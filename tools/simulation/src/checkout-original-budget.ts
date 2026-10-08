/** Explicit SELECT-only inspection of the original financial admission. No new
 * plan/budget/store, writes, credentials, Checkout or reset. Files and SQLite
 * anchors must agree before the selected candidate can be considered unused. */
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { approved } from './hosted-checkout-policy.ts';
import type { SandboxPlan } from './sandbox-plan.ts';
const fail = (): never => { throw Error('Original Checkout budget unconfirmed; no preparation or reset allowed.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const entrySchema = z.object({ role: z.enum(['supporter', 'sustainer', 'clock-supporter']), actorId: z.string(), agentId: z.string(),
 operationId: z.uuid(), maximumAmountCents: z.number().int(), scenario: z.literal('success'), expectedTier: z.enum(['supporter', 'sustainer']),
 checkout: z.object({ kind: z.literal('supporter'), tier: z.enum(['supporter', 'sustainer']), recurring: z.literal(true) }).strict() }).strict();
const planSchema = z.object({ version: z.literal(1), runId: z.literal(approved.runId), credentialIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/),
 runBudgetCents: z.literal(2500), actorBudgetCents: z.literal(1500), additionalOneRenewalBudgetCents: z.literal(2500),
 entries: z.array(entrySchema).length(3) }).strict();
const originalId = 'f827ab6e-ae5e-477c-935e-4e5c66b91636', replacementId = '51033cb7-0087-4b98-9a56-62e2cd35d477';

export function inspectOriginalCheckoutBudget(directory: string) {
 let db: DatabaseSync | undefined;
 try {
  const root = resolve(directory);
  for (let cursor = root;; cursor = dirname(cursor)) {
   guard(!lstatSync(cursor).isSymbolicLink() && realpathSync(cursor) === cursor);
   if (dirname(cursor) === cursor) break;
  }
  function bytes(name: string) {
   const path = join(root, name), stat = lstatSync(path);
   guard(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 262144);
   return readFileSync(path);
  }
  const planBytes = bytes('plan.json'); let raw: unknown;
  try { raw = JSON.parse(planBytes.toString('utf8')); } finally { planBytes.fill(0); }
  const plan = planSchema.parse(raw), admissionDigest = hash(JSON.stringify(raw));
  guard(new Set(plan.entries.map(entry => entry.operationId)).size === 3);
  const candidate = plan.entries[1]!;
  guard(plan.entries[0]!.operationId === originalId && candidate.operationId === approved.operationId &&
   candidate.actorId === approved.actorId && candidate.agentId === approved.memberId && candidate.role === 'sustainer' &&
   candidate.maximumAmountCents === 1500 && candidate.expectedTier === 'sustainer' && candidate.checkout.tier === 'sustainer');
  for (const [index, entry] of plan.entries.entries()) {
   const suffix = String(index + 1).padStart(3, '0');
   guard(entry.actorId === `synthetic-6658c4939d672ff5-${suffix}` && entry.agentId === `bot_6658c4939d672ff5_${suffix}` &&
    entry.role === ['supporter', 'sustainer', 'clock-supporter'][index] && entry.maximumAmountCents === (index === 1 ? 1500 : 500) &&
    entry.expectedTier === (index === 1 ? 'sustainer' : 'supporter') && entry.checkout.tier === entry.expectedTier);
  }
  const replacementBytes = bytes('supporter-replacement-plan.json'); let replacementRaw: unknown;
  try { replacementRaw = JSON.parse(replacementBytes.toString('utf8')); } finally { replacementBytes.fill(0); }
  const replacement = entrySchema.parse(replacementRaw);
  guard(replacement.operationId === replacementId && JSON.stringify({ ...replacement, operationId: originalId }) === JSON.stringify(plan.entries[0]));
  const sqlite = join(root, 'admission.sqlite'), stat = lstatSync(sqlite);
  guard(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  db = new DatabaseSync(sqlite, { readOnly: true });
  db.exec('BEGIN');
  guard(db.prepare('SELECT digest FROM manual_plan_anchor WHERE run_id=?').get(approved.runId)?.digest === admissionDigest &&
   db.prepare('SELECT digest FROM manual_plan_anchor WHERE run_id=?').get(`replacement:${replacementId}`)?.digest === hash(JSON.stringify(replacementRaw)));
  const budget = db.prepare('SELECT run_budget,actor_budget FROM ui_checkout_budget WHERE run_id=?').get(approved.runId);
  guard(budget?.run_budget === 2500 && budget.actor_budget === 1500);
  const intents = db.prepare('SELECT operation_id,actor_id,maximum_cents,state,request_hash FROM ui_checkout_intent WHERE run_id=? ORDER BY operation_id').all(approved.runId);
  guard(intents.length === 2);
  for (const [id, entry] of [[originalId, plan.entries[0]!], [replacementId, replacement]] as const) {
   const intent = intents.find(value => value.operation_id === id);
   guard(intent?.actor_id === entry.actorId && intent.maximum_cents === 500 && intent.state === 'prepared' &&
    intent.request_hash === hash(JSON.stringify({ ...entry.checkout, operationId: id })));
  }
  const histories: string[] = [];
  for (const [id, filename] of [[originalId, 'supporter-expiry-reconciliation.json'], [replacementId, 'supporter-replacement-expiry-final-2026-10-03.json']]) {
   const receiptBytes = bytes(filename!);
   try {
    const receipt = z.object({ runId: z.literal(approved.runId), operationId: z.literal(id!), readOnly: z.literal(true),
     appStatus: z.literal('expired'), normalUiPaymentStatus: z.literal('expired'), providerStatus: z.literal('expired'), providerPaymentStatus: z.literal('unpaid'),
     providerInvoiceAbsent: z.literal(true), providerSubscriptionAbsent: z.literal(true), appPaidAtAbsent: z.literal(true), prepareReplayAllowed: z.literal(false),
     originalAdmissionPreserved: z.literal(true), financialSubmitJournalExists: z.literal(false) }).parse(JSON.parse(receiptBytes.toString('utf8')));
    guard(receipt.operationId === id); histories.push(hash(receiptBytes));
   } finally { receiptBytes.fill(0); }
  }
  db.exec('COMMIT');
  const { actorId: __actorId, role: __role, ...step } = candidate;
  const sandboxPlan: SandboxPlan = { runId: approved.runId, runBudgetCents: 2500, actorBudgetCents: 1500, steps: [step] };
  return { plan: sandboxPlan, originalAdmissionDigest: admissionDigest, expiredHistoryDigests: histories as [string, string],
   originalStore: sqlite, priorExpiredReservedCents: 1000, candidateReservedCents: 1500, candidateUnused: true,
   additionalRenewalBudgetNotAdmitted: true, readOnly: true, paymentAccepted: false, retryAllowed: false };
 } catch { return fail(); } finally { db?.close(); }
}
