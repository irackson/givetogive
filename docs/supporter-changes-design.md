# Dedicated supporter changes: implementation design

September 27, 2026. **Implemented in the local working tree; actual Stripe sandbox
acceptance is outstanding.** The full [acceptance contract](payments-implementation-plan.md)
remains authoritative. The protected hosted checkpoint predates this slice;
local implementation and stubbed tests are not proof of a published payment flow.
All payment gates remain off. No real Checkout, card payment, paid tier, upgrade,
schedule or clock advance is claimed by this document.

## Behavior

- Upgrade Supporter to Sustainer on the same subscription and existing item.
  Collect the prorated difference; recognition requires both verified paid
  coverage and Stripe applying the update.
- Schedule Sustainer to Supporter at the existing period end; no immediate
  credit/refund or lower recognition. Keep billing anchor and quantity one.
- Present current paid recognition, current billing price, and pending/scheduled
  change separately. An intention or redirect never grants a tier.
- Tier changes accept only known USD monthly products/prices, one item, automatic collection,
  no unpaid current invoice/trial/pause/unknown schedule or unsupported pricing
  adjustment. Other shapes fail closed with actionable recovery information.
- Cancellation/resumption management is separately gated from new sales so a
  paused sales feature or unpaid renewal does not trap a member in billing.
  Verified frozen members can freshly authenticate into a billing-only identity
  for their own history and cancellation/unpaid-upgrade undo. The browser/auth
  boundary passed three focused tests alongside the five supporter tests (8/8,
  no skips/retries). Old sessions remain revoked; normal/public-owner/admin
  access is not restored. Actual Stripe cancellation remains unaccepted.
  Frozen members cannot resume billing or initiate a new tier change.

## Additive state

Migrations **0017 and 0018 are applied to isolated CI and staging**, not production.
The staging guard verified zero subscriptions/settled payments before migration;
the resulting schema has 34 tables. The new application code is not yet deployed
to that staging schema. Subscription state
now includes provider item ID, item period start/end, schedule/latest-invoice IDs,
change revision, short-running mutation ownership and pending-change ID. Provider
reads use a database-clock lease plus a monotonic revision fence; descriptive
observation timestamps are not used to order concurrent responses.

Persisted supporter change operations include actor/subscription/mode ownership,
action, canonical input hash, expected revision, source/target server prices,
quote/proration date/amount/expiry, effective date, invoice/PaymentIntent/schedule
IDs, a frozen source-period end, durable step/status, claim lease/retries and safe errors. Preserve prior
operations and audit events. A scheduled change does not retain the short-running
mutation lock forever; undo/cancel targets its exact operation separately.

Paid coverage records first-class invoice-line/item provenance and **both** service
period start and end, joined to the settled payment and configured price/tier.
The legacy end-only projection does not grant a future period early or infer
historical tier from today's subscription price. Backfill only from actual
provider invoices; never invent coverage starts. Retain refund/dispute exclusions
and the documented partial-refund policy.

Authenticated `customer.subscription.pending_update_applied` snapshots are
captured before webhook acknowledgement as minimal immutable evidence: event,
platform/customer account, actor, subscription, invoice, item, price and service
interval. Metadata cannot establish ownership. A delayed event still proves its
old invoice after renewal; it never borrows today's tier. Stored proof is tried
first on recovery, then only the exact already-owned inbox event ID is retrieved
from Stripe. This matters because provider event retrieval has a retention limit.

Database triggers reject evidence rewrites/deletes/truncation. Coverage provenance
is likewise immutable except one-way `appliedAt: null -> timestamp` and a verified
legacy `itemId: null -> ID` fill. No new application may lack item provenance.
Current-subscription fallback proof matches invoice/item/price and requires a
contained proration start and exact period end, as does durable event proof.

## Upgrade and recovery

Authenticated preview/confirm/status/history APIs are wired to the member billing
UI. Identity, subscription, item, price and amount are derived on the server.
Preview uses `invoices.createPreview`,
`always_invoice` proration and a fixed proration timestamp. Store a short-lived
quote and provider-state fingerprint. Revalidate at confirmation; materially
changed amount/state requires renewed consent through a **new operation ID**.
An existing operation ID never silently acquires a different quote.

Reopening a quoted change from history uses the server's `canConfirm` capability,
not transient client preview input. Restricted identities still receive only
cancel/unpaid-upgrade-undo capabilities; the frontend separately hides all other
action kinds and honors the management gate. Four focused display-policy tests
cover reopening an allowed undo, denied capabilities, restricted action kinds,
and the separate sales/management gates. They are UI policy checks, not payment
or provider acceptance.

Persist admission before calling `subscriptions.update` with the existing item,
target price, `payment_behavior: pending_if_incomplete`, `always_invoice`, and the
same proration timestamp. Never hold a database transaction over Stripe calls.
Validate provider/payment-method eligibility for pending updates; do not silently
downgrade to an immediate unpaid update when unsupported.

For decline/3DS, retain the old tier and offer the owner a verified provider
invoice URL for that same invoice. No new subscription or repeated charge request.
Paid + applied, pending, expired, voided and ambiguous outcomes stay distinct.
Zero-due/credit-only and unsupported multi-payment shapes require reconciliation.

## Scheduled downgrade and cancellation

Create a schedule from the existing subscription, persist its ID, then preserve
the current phase through its period end followed by the Supporter phase with
no proration and release behavior. Preserve supported taxes/discounts/settings;
unknown configurations require review rather than destructive reconstruction.

Stripe's portal cannot update or cancel a subscription with a scheduled change.
Therefore explicit app actions must support undo, period-end cancellation and
resumption for owned schedules. Release an owned downgrade to keep Sustainer,
preserving any existing cancellation. For scheduled cancellation, end the current
phase with schedule `end_behavior: cancel`; never call immediate schedule cancel.
Pending upgrade and schedule mechanisms must not coexist. Resolve/void an unpaid
pending invoice before another change. If payment wins a cancellation race,
reconcile it without promising rollback or silently refunding.

Use member/subscription locks and mandatory revision. One competing mutation
wins; same-input retries return the same operation, changed-input reuse conflicts.
An ambiguous provider result retains mutation ownership. Reconcile through known
object relationships before retrying; stable step keys expire conservatively
after 23 hours, after which blind replay is prohibited. Do not overwrite external
cancellation/portal changes or apply stale provider snapshots.

Schedule and subscription pending-update webhook processing, durable workflow
execution and bounded recovery are wired. Actual invoice lines are validated
independently of the subscription's present price. Historical paid-and-applied
execution may settle an old operation after a later renewal/refund without
restoring current recognition; refunds/disputes still independently suppress it.

## Recurring fund cancellation boundary

Recurring fund gifts are not supporter tier changes. Their billing-table action
uses a separate cancel-only Stripe portal flow for the exact owned fund
subscription, including for a freshly authenticated billing-only identity.
The frontend requires the dedicated `fundCancellation` availability flag, not a
new-sales/fund-enrollment flag. An ended or already-canceling gift has no cancel
action. Restricted accounts never receive the general billing portal button.

The dialog explains the handoff before opening Stripe: the user must confirm
period-end cancellation there; the app requests no new charge or refund.
Returning to the billing page is not confirmation. The renewal label remains
based on reconciled provider state. A dedicated cancellation-only configuration
must disable non-cancellation features and must not reuse the broad portal policy.
The latest eight gate-off browser cases pass, including no cancellation control
for an account with no recurring records, rejection of an unknown fund target
when its dedicated policy is unavailable, and rejection after sign-out. These
checks create no financial records and do not exercise a real recurring fund
subscription. The confirmation dialog/provider handoff still needs actual
hosted cancellation acceptance.

## Time and the tiny sandbox clock cohort

Recognition now has a centralized authoritative `asOf` source. Production and ordinary members always
use wall time. Only the exact guarded synthetic staging cohort may use a
persisted, provider-verified named-clock binding and Stripe's retrieved frozen
time. Verify mode/account/run/database identity; a runner timestamp is never
authoritative. During advancement or unverifiable clock state, report
reconciliation pending rather than silently reverting to wall time. Billing,
support and the owner's profile show pending status; public profiles do not expose
private reconciliation details. Retired clock members do not silently become
wall-clock members or start new billing mutations.

Apply `periodStart <= asOf < periodEnd` consistently to billing overview,
recognition/profile badges, simulator assertions and cohort analytics. This is
needed both to prevent early future-tier access and to expire old higher-tier
coverage when a test clock advances beyond downgrade time.

## Implemented local checks and outstanding acceptance

Implemented: interval/provenance storage, authoritative time seam, durable change
operations, immutable quotes, ownership/revision guards, upgrade/pending-payment
service paths, schedule/cancellation/undo/resume paths, connected billing UI,
operation history, workflows and recovery hooks.

Observed local checks include 7 application-evidence policy tests; 6 rollback-only
evidence database tests; 7 coverage database tests (including both current-snapshot
period-containment paths); separate-transaction observation-fence tests; 4 UI
confirmation-policy regressions; and 8 gate-off browser tests for authentication,
restricted frozen billing, billing/support state, operation ownership and private
pending-recognition UI. The latest focused browser run passed 8/8 in 44.7 seconds
without skips or retries; current TypeScript and owned-file lint also passed.
Provider adapters in CI are explicit stubs. None of these tests represent a
genuine paid account or Stripe charge.

The Stripe CLI is authenticated and separate Development/CI sandboxes were created
with live settings copying off. Application restricted keys, webhook secrets,
catalog and end-to-end provider tests are not yet provisioned/accepted. CLI login
is not an application credential. See [measured verification](payments-verification.md)
for checkpoint counts and remaining external steps.

The full acceptance matrix still requires provider-observed races/retries, interrupted
provider steps, lost responses, duplicate/out-of-order events, decline/3DS,
void-versus-payment races, unsupported shapes, stale cancellation, future/overlap
coverage, refund/dispute revocation and clock failures. Keep one subscription/item
and immutable balanced journals. Then run genuine provider purchases and clock
renewal/change/failure/cancellation scenarios; mocks are not acceptance evidence.
Tax treatment and registration remain a live-launch gate; do not enable automatic
tax without the intended active registration and pricing policy.

Primary references reviewed with the Stripe documentation CLI:
[pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates),
[proration preview](https://docs.stripe.com/billing/subscriptions/prorations#preview-proration),
[unpaid-invoice prorations](https://docs.stripe.com/billing/subscriptions/prorations#prorations-and-unpaid-invoices),
[schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules),
[portal limitations](https://docs.stripe.com/customer-management#limitations),
[schedule release](https://docs.stripe.com/api/subscription_schedules/release).
