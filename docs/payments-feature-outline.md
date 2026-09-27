# GiveToGive: payments, operations, and simulated community

## Scope and provenance

This inventory compares the current implementation with commit
`f6638fe0b1845ae9cceb937959138af38d1ba971` (`f6638fe`, September 26, 2026),
the published, non-payment baseline. The older [feature outline](feature-outline.md)
compares a different starting point; its then-new features already existed at
this baseline and are not counted as new again here.

Tags describe origin, not deployment or acceptance:

- **existed before**: working functionality already present at `f6638fe`.
- **partly implemented before**: the product foundation existed, but an important
  part of the broader capability did not. This never means Stripe code existed
  when there were only off-platform money pledges.
- **brand new**: a capability or subsystem introduced after that baseline.
- **newly finished**: a specific incomplete behavior or hardening gap in an
  existing feature was completed in this implementation. It does not certify a
  whole untested provider workflow.

Snapshot: payment code is gated; genuine Stripe sandbox acceptance and live-money
approval remain outstanding. This document does not claim that these changes
have replaced the public production release. Protected staging verification,
the final PDF, deployment identity, and full acceptance results must be recorded
separately in the release handoff and [acceptance contract](payments-implementation-plan.md).

## Existing community capabilities retained

| Capability | Tag | Behavior retained |
| --- | --- | --- |
| Editorial design and responsive navigation | existed before | Warm paper, cobalt/coral accents, illustrations, public/member layouts, recovery screens. New payment/admin pages extend this visual language. |
| Five Ask types | existed before | Time, task, item, money, and resource; goals, difficulty, estimated time, stable slugs and numeric-ID links. |
| Browse and saved Asks | existed before | Search, type/status/difficulty/time filters, URL state, private saves, empty/loading/error states; board limited to the latest 100 matching Asks. |
| Ask creation and owner edits | existed before | Type-specific creation, owner-only editing, stable URLs, goal constraints, public activity. |
| Multiple partial non-monetary contributions | existed before | Pledged/completed/cancelled lifecycle, ownership rules, private notes, no self-offers, capacity locks and idempotent transitions. |
| Legacy money pledges | existed before | Off-platform member records, explicitly not Stripe charges or verified payments. Existing rows are preserved, never converted into financial evidence. |
| Profiles and contribution history | existed before | Public profile, owner editing, paginated history, private owner history, honest email-confirmation and join-date cues. |
| Account authentication | existed before | Email/password, Discord entry, email verification, password reset, safe callbacks, branded auth recovery. There is no separate username-login system. |
| Application architecture | existed before | Next.js App Router, React, TypeScript, tRPC/TanStack Query, Auth.js, Drizzle/PostgreSQL, Vercel and Node 24. |

## Money and paid membership

| Capability | Tag | Implemented behavior and boundary |
| --- | --- | --- |
| Money-Ask goals and partial help | partly implemented before | Goals and partial off-platform pledges existed. Verified payments, fees, recipient onboarding and financial recovery did not. |
| Explicit payment-enabled money Asks | brand new | Owner opt-in for eligible USD money Asks without any legacy contributions. No silent conversion or mixing of pledge totals and paid totals. Manual contribution transitions are rejected after enrollment. |
| Payment-aware owner editing | newly finished | Existing edits now preserve the payment boundary: goal changes cannot erase paid, pending, allocation, or reversible-dispute capacity; forged type/currency edits are rejected. |
| Partial Checkout gifts | brand new | Hosted Checkout, frozen quote, donor/Ask ownership rules, stable operation IDs, reservation locking and pending/success/failure/cancellation states. Real provider execution still requires sandbox verification. |
| Transparent fee quote | brand new | Integer USD cents; 5% of gross plus an explicitly configured processing estimate is deducted from the gift. Recipient net is frozen; actual processing variance belongs to the platform. |
| Verified Ask progress | brand new | Only reconciled recipient principal counts as paid help. Pending and disputed capacity stays separate; refunds/disputes can reduce progress and reopen an Ask. A return URL cannot mark payment complete. |
| Receiving account | brand new | Accounts v2 customer/recipient mappings, US recipient checks, embedded onboarding/notifications/account management/payouts, Express dashboard fallback. Provider eligibility, onboarding and actual payouts are not yet verified. |
| Personal giving records | brand new | Private paginated payment history, individual status/amount/fee record and provider receipt link when one actually exists. Other members cannot read the record. |
| Supporter and Sustainer | brand new | $5/month Supporter and $15/month Sustainer, with free Neighbor. Separate subscription accounting, one active supporter subscription per member, paid-invoice recognition, optional public badge and customer-portal handoff. No aid priority or identity-verification claim. |
| Paid-through recognition | brand new | Positive paid coverage drives tier recognition, including prorated invoice ordering. Cancellation retains paid time; full refunds/disputes revoke affected coverage; partial refunds retain residual coverage. Replayed old events cannot restore revoked coverage. Zero-payment/customer-credit invoices require review. |
| Subscription changes | brand new | Dedicated immutable preview/confirmation, paid prorated upgrade, scheduled period-end downgrade, undo, cancellation and resumption, with revision/lease protection and durable recovery. Frozen or overdue members retain safe cancellation paths. Portal requires an explicit active, matching-mode policy with period-end/no-proration cancellation and plan changes disabled. Isolated database/provider-stub tests pass; actual provider configuration, paid transitions and test-clock lifecycle still need sandbox acceptance. |
| Historical upgrade evidence | brand new | Authenticated application snapshots retain exact account/subscription/invoice/item/price/period proof across later renewals and event retention. Refund/dispute state independently suppresses present recognition. Database-fenced provider reads prevent stale workers overwriting newer subscription observations. |
| Community funds | brand new | Public fund pages, one-time/monthly Checkout paths, available versus allocated principal, and public allocation history. Fund subscriptions do not count as supporter subscriptions. |
| Administrative fund allocation | brand new | Named recipient Ask, amount and reason; no self-awards; only settled, unallocated principal is eligible. Source-linked transfers reserve capacity and do not charge a second giving fee. |

Initial scope is USD and US recipients. No annual plans, trial plans, wallet,
escrow, lending, cross-border payout support, or claim of tax deductibility is
introduced. No paid tier is earned by assigning a label to a synthetic account.

## Financial reliability and administration

| Capability | Tag | Implemented behavior and boundary |
| --- | --- | --- |
| Financial ledger | brand new | Balanced, immutable integer journals; database-level checks and append-only compensating reversals. Frozen gross, recipient net, platform fee and actual processing variance remain distinct. |
| Webhook inbox | brand new | Signature checks, environment/account binding, minimal persisted identifiers, deduplication, current-provider-state reconciliation and replay handling for classic and v2 events. |
| Durable financial work | brand new | Hosted workflows for event processing, refunds, allocations and reservation recovery. Network calls do not run inside database transactions; laptop availability is not a correctness dependency. Hosted execution needs its own evidence. |
| Refunds and disputes | brand new | Durable idempotent operations, cumulative proportional recovery, transfer/application-fee reversal accounting, explicit terminal failures and operator cases. Open disputes reserve reversible goal capacity; won disputes cannot overfill it. |
| Ambiguous/failed transfer recovery | brand new | Recover by persisted operation identity before repeating an effect. Skipped recipient transfers remain an explicit case, not delivered help. Interrupted allocations support source reclamation; unresolved provider/balance ambiguity stays reserved for reconciliation. |
| Fair recovery queues | brand new | Attempt ordering and row claims prevent poison first-page records from starving newer work. Up to 20 batches per sweep; immediate workflows plus a daily Hobby-compatible fallback, not a five-minute recovery SLA. |
| Global activity and financial history | partly implemented before | Ask-local activity/history existed. Cross-entity operational events, financial journals, admin actions, telemetry and simulation histories are new. |
| Admin overview and drill-downs | brand new | Member/Ask/help/giving/recurring-revenue measures; activity filters and bounded export; payment history, journal/provider IDs, recovery queues; member detail and audited freeze/unfreeze controls. |
| Per-Ask payment pause | brand new | Authorized administrators can pause/resume new payment and fund-allocation reservations with an audited reason and stale-state protection. Existing Checkouts can still settle; refunds and recovery continue. No provider eligibility or environment gate is bypassed. |
| Recovery-case review | brand new | Paginated private operator history with audited acknowledgement/escalation and idempotent retries. Reviewing a case cannot resolve a financial hold, change a payment, or claim money recovered. |
| Analytics definitions | brand new | Giving excludes legacy pledges and supporter subscriptions. Verified net subtracts confirmed recipient refunds/disputes. Supporter MRR requires active, non-canceling, paid-through supporter subscriptions. Request latency is measured, not fabricated; missing observations remain unavailable. |
| Member/admin authorization | brand new | Verified administrator role, current account/freeze/session checks, server-side permissions and session/token revocation. A display name does not grant administration. |
| Financial admin step-up | brand new | Recent authentication and replay-protected TOTP mint a five-minute encrypted, account/session-bound elevation token held only in browser memory. Production financial actions enforce it. Ian's own bootstrap and MFA enrollment are not claimed complete. |
| Concurrent auth throttling | newly finished | The existing database limiter now updates atomically rather than losing simultaneous attempts. |
| Password-reset revocation | newly finished | Resetting an existing account password also invalidates prior session versions/tokens; already-issued sessions are no longer silently retained. |
| Environment isolation | brand new | Separate synthetic-only staging and CI databases/roles, environment identity, protected staging origin, private encrypted staging email sink, independent payment/supporter/fund flags, and explicit production live approval gate. |

Giving is not a bank-payout metric. Daily giving groups current net values by the
original UTC payment date, not a historical cash-flow reconstruction. Simulation
events and model statements are never authoritative financial success.

## MCP and local multi-agent simulation

| Capability | Tag | Implemented behavior and boundary |
| --- | --- | --- |
| Versioned member MCP API | brand new | Official SDK transport, strict schemas, scoped staging per-user tokens, revocation and shared authorized domain services. Tools browse Asks/profiles/funds/history and create/edit/save/contribute/complete/cancel as the authenticated member. |
| Retry and identity protection | brand new | Caller-supplied user IDs do not grant identity; stable correlation IDs bind mutation retries. Atomic domain writes and persisted operation results prevent duplicate effects; ambiguous external Checkout outcomes require reconciliation. |
| Checkout handoff tool | brand new | A gated test-mode Checkout preparation tool, not arbitrary card charging. No model access to Stripe secret keys or financial-administrator powers. |
| Controlled sandbox checkout lane | brand new | Separate serial, fixed-scenario browser harness with server-attested owned test Checkout, finite persistent budgets, secret-isolated fixed test-card entry, and reconciliation-only handling after ambiguous submission. Local policy/driver tests pass; actual Stripe-hosted DOM/3DS/provider outcomes remain unverified. |
| Tiny subscription-clock cohort | brand new | Explicit scoped operator endpoint creates/reads/advances one named test clock for a deterministic cohort of at most three synthetic members. Own-account binding occurs before first Checkout. Clock controls are not model tools; the 100-agent baseline has no clock scope. Actual renewals/cancellations remain unverified. |
| Independent agents | brand new | Up to 100 Strands TypeScript agent instances with distinct synthetic accounts, personas, goals, budgets, memory and checkpoints. They share bounded local inference capacity, not one conversation or 100 loaded model copies. |
| Local models/runtime | brand new | Native Windows llama.cpp with pinned/hash-checked Qwen3.5-4B and Gemma 4 E2B candidates, loopback-only model endpoint, bounded contexts/output, memory headroom guards and benchmark reports. No paid inference fallback or termination of Ian's apps. |
| Execution and recovery | brand new | Local SQLite checkpoints/outbox, one mutation at a time per agent, scoped browser contexts, authenticated outbound telemetry, command cursors, finite retries/budgets and offline detection. No shell/SQL/unrestricted-HTTP tools for agents. |
| Simulation control room | brand new | Create a run; inspect roster, individual agent and historical activity; start/pause/resume/stop; per-agent controls, activity/concurrency settings, freshness/connection states and completed-run replay boundaries. |
| Deterministic versus autonomous modes | brand new | Explicitly distinct modes. Deterministic regression activity does not establish model-selected behavior, and a successful model tool selection does not establish successful site execution. |

The requested 60 Neighbor / 25 Supporter / 15 Sustainer mix, recipient cohort and
cross-tier money interactions remain an acceptance target. Paid tiers must be
earned through genuine Stripe test flows. Provisioned accounts alone do not
prove the target, and 100 independent agents need not perform 100 concurrent
inference requests on this machine.

## New and changed views

| Routes | Views/actions |
| --- | --- |
| Existing `/`, `/asks`, `/asks/[slugOrId]`, `/members/[id]` | Expanded navigation; payment-aware Ask progress and owner enrollment confirmation; Checkout quote dialog; optional supporter badge/preference. Existing non-monetary/legacy views remain. |
| `/support` | Free/paid plan comparison, sign-in/gated configuration states, subscription Checkout or billing management. |
| `/giving`, `/giving/[id]` | Private impact/history, payment detail, pending/failure/refund states, receipt link and Checkout cancellation confirmation. |
| `/account/billing` | Own subscription/tier overview, paid-through/time-verification state, change preview/confirmation/history, pending invoice handoff, cancel/resume/undo and provider portal. `/account` and `/billing` redirect here. Provider-dependent states remain gated until sandbox setup. |
| `/account/receiving` | Recipient setup/readiness/restrictions, embedded provider components when configured, dashboard fallback. `/receiving` redirects here. |
| `/account/security` | Session revocation confirmation and administrator authenticator/elevation controls. |
| `/funds`, `/funds/[slug]` | Public fund list/detail, balances/allocation history, one-time/monthly gift dialog and unavailable/empty states. |
| `/admin` | Admin-only overview, trends/definitions and measurement export. |
| `/admin/activity` | Filterable event history, linked entities, live/freshness indicators and export of the displayed bounded result set. |
| `/admin/users`, `/admin/users/[id]` | Member search/history, freeze/unfreeze confirmation and session effects. |
| `/admin/payments`, `/admin/payments/[id]` | Payment search, recovery queues, case review/escalation dialogs/history, per-Ask new-payment pause/resume, provider/ledger detail, refund dialog and reconciliation request. |
| `/admin/funds` | Create-fund and allocation dialogs, current availability/history and eligibility feedback. |
| `/admin/simulations`, `/admin/simulations/[id]`, `/admin/simulations/[id]/agents/[agentId]` | Run creation, fleet/control room, stop confirmation, agent detail and historical activity. |
| `/mcp`, `/api/simulation/*`, `/api/stripe/*` | Machine endpoints, not member-facing pages. Auth/signature/environment checks apply; new endpoints do not expose provider secrets. |

There is no standalone `/admin/asks` page or generic support/moderation system.
Stripe-hosted Checkout, portal, Express dashboard and configured embedded
onboarding are provider surfaces; locally rendered empty/gated pages are not
screenshots of successful provider use.

## Verification boundary at this handoff

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Root unit suite: 84 passed at the supporter-change checkpoint | Existing domain rules plus environment/portal policy, clock authority, immutable change quotes, historical application proof, paid coverage, fee/journal math, MCP/Checkout guards and script preflight. See the verification record for later targeted checks. | Provider eligibility or money movement. |
| Isolated CI integration suite: 93 passed at the supporter-change checkpoint | Real PostgreSQL locks/races, immutable journals/provenance, fenced provider observations, supporter change lifecycle, historical proof, capacity/recovery, scoped MCP and authorization. See the verification record for later targeted checks. | Real Stripe sandbox behavior; provider transports are explicitly stubbed. |
| Production-policy admin test: 12 passed | Actual financial-admin guard rejects missing/expired/wrong-user/wrong-session/tampered tokens and inactive/unverified/non-admin principals; accepts valid five-minute elevation. Exact CI database/role; temporary policy setting only; fixtures removed. | Ian's identity, authenticator enrollment, or a live financial action. |
| TypeScript, full lint and build passed | Integrated source is checked and protected staging builds successfully. | Full acceptance or a provider payment success. |
| Hosted browser suite: 29 passed | Existing community/member flows, new account/admin views, actual TOTP/session controls, case review, payment pause/resume and a completed empty-queue hosted recovery workflow. | Payment, transfer, subscription or populated-provider acceptance. |
| Local runtime: 27 passed | Agent isolation, scoped identity, strict tools, telemetry/checkpoint/budget safety, private controlled Checkout execution and explicit tiny clock cohorts. | Actual Stripe-hosted browser behavior or a completed autonomous 100-member run. |
| Local model probe | One real Gemma single-tool selection was valid after a compatibility fix, approximately 49.8 seconds for that decision. Earlier Qwen/Gemma probes failed or timed out. | Reliable broad tool selection, adversarial robustness, acceptable throughput or actual site execution. |

These are scoped results, not a replacement for the root release verification
record. A protected ten-member deterministic smoke completed 30 real nonfinancial
actions with 200 acknowledged telemetry records. No successful 100-agent autonomous soak or real Stripe
payment/subscription/test-clock lifecycle is claimed here.

Outstanding acceptance includes actual sandbox credentials/account setup,
onboarding, every Checkout path, declines/3DS/async flows, webhook delivery,
renewals/plan changes/test clocks, refunds/disputes/payout failures, crash recovery,
and the measured 10 -> 25 -> 100 autonomous progression with cross-tier actions.
Live launch additionally needs Ian's verified admin/MFA setup, business and tax
decisions, hosting/recovery readiness, reviewed production migration/deployment,
and explicit approval. See the [operator runbook](payments-runbook.md),
[simulation guide](simulation.md), and [payment invariants](../src/server/payments/README.md).
