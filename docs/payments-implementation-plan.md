# Payments and simulated community implementation contract

Accepted objective: implement the finalized GiveToGive plan in full, including
verification, fixes, deployment, and truthful reporting of external blockers.
Baseline: `f6638fe` on `main`. This checklist does not redefine the goal around
whatever happens to be implemented. Unchecked requirements remain unfinished.

## Product decisions

- Preserve the existing editorial design, five Ask types, authentication,
  profiles, saved Asks, and partial non-monetary contribution lifecycle.
- Individual Ask gifts use multiple partial Stripe payments and immediate
  destination transfers after payment success; bank payouts follow Stripe.
- New payment-enabled Ask goals measure net recipient amounts; reservations
  prevent overfunding. Legacy off-platform records remain clearly labeled and
  are never converted into paid Stripe records or silently reinterpreted.
- GiveToGive funds accept one-time and monthly gifts; an administrator records
  an amount, recipient Ask, and reason for each allocation. No self-awards.
  Public allocation history excludes private financial information.
- Neighbor is free; Supporter is $5/month; Sustainer is $15/month. Optional
  badges and personal impact summaries do not confer aid priority or identity
  verification. One supporter subscription per member; fund subscriptions are
  distinct. Upgrades require successful prorated payment; downgrades and
  cancellation take effect at period end; paid recognition expires at paid-through.
- USD and US recipients initially. No annual plans, trials, wallets, escrow,
  lending, cross-border payouts, or unsupported tax-deductibility claims.
- A frozen quote deducts 5% of gross plus the disclosed configured processing
  estimate. Actual Stripe cost variance belongs to the platform. Fees apply to
  fund intake once, never to allocation. Supporter plans have no extra giving fee.
- Preserve paid, pending, failed, refunded, disputed, restricted, and canceled
  states separately. Stripe-backed payment completion cannot be set manually.

## Architecture and safety requirements

- Work only on main, preserve unrelated edits, signed verified commits, push
  and verify deployments. Only main remains locally/remotely at handoff.
- Separate staging Vercel project, isolated Neon database with synthetic data,
  authentication secrets, canonical origin, and environment identity.
- Separate Stripe sandboxes for simulation/development and CI; no bot access
  to live payments or production data. Laptop and Codex Cloud are alternative
  development machines and may share the Development sandbox with staging.
  CI means automated integration-test execution, not every Cloud task.
  Staging email sink and access restriction.
- Independent live gates for Ask payments, supporters, and community funds;
  actual Stripe eligibility/verification and operational prerequisites remain
  required even when sandbox tests pass. Never invent business facts or attest
  to legal agreements for Ian. Do not initiate real-money test purchases.
- Checkout Sessions, Customer Portal, Accounts v2 recipient transfers,
  Express dashboard, platform-managed pricing and negative-balance liability.
  Embedded onboarding, notifications, management, payouts; dashboard fallback.
- Destination charges for Asks; separate charges/transfers for pooled funds.
  Refunds/disputes include explicit recovery, failed recovery queues, fee
  reversals, payout failure handling, and reconciliation.
- Integer money, balanced immutable ledger with compensating entries, first-class
  Stripe ID ownership mappings, signature-verified durable webhook inbox,
  deduplication/out-of-order handling, stable idempotency keys and operation IDs.
  Never hold DB transactions across network requests or trust return-page success.
- Hosted durable payment recovery using Vercel Workflows; durable audit history
  in PostgreSQL. The laptop is never a dependency for financial correctness.
- Shared authorized business services behind tRPC, worker, and versioned MCP.
  Scoped revocable staging per-user tokens; never trust input user IDs. Checkout
  handoff rather than arbitrary card charging. Future OAuth 2.1 adapter documented;
  public ChatGPT submission/widgets are outside this release.
- Member/admin roles, unambiguous verified Ian bootstrap, recent authentication
  plus TOTP for live administrative money actions, atomic rate limiting, session
  and token revocation, account/payment freeze, audited admin actions.
- Least-privilege secrets in sensitive env; no credentials, PAN, private banking
  data, authentication links, or hidden reasoning in telemetry/model inputs/PDFs.
- Tax treatment reviewed before live subscriptions; registration required before
  automatic tax can be represented as operational.

## Local simulation and administration

**Accepted revision, October 1, 2026:** ongoing scripted users plus a smaller
browser cohort replaces the 100 autonomous-model-agent requirement. Start with
250 scripted users and three browser users, configurable up to 30 browser users.
The two groups run together in the same isolated community. All member activity
uses the existing UI APIs and normal, independent sign-in sessions. MCP remains
an existing integration, but is not the simulator's member-action transport.

- Independent scripted and browser accounts with private sessions, schedules,
  budgets, histories and one controller per account. Default browser population
  and concurrency are three; both may be configured from one through 30.
  Concurrency is admitted against measured memory headroom, not promised to fit
  this laptop at the maximum. Account count and current active actions are distinct.
- JSONL scenarios support exact references to previous results and conditional
  selection from current API results. Recurring rules continue during browser
  activity, including interactions with newly browser-created Asks. Refresh state
  before a mutation, accept authoritative race outcomes and never force an outcome.
- Fixed regression scenarios and ongoing rule-based community behavior use the
  same authenticated UI routes. No direct SQL activity, impersonation header,
  privileged simulation member token, fabricated event or financial entitlement.
  Initial synthetic account setup is separate from community activity.
- Local-model decisions are optional exploration; the required runner, browser
  workflows and community acceptance do not depend on a model benchmark.
- No paid-model fallback or automatic subscription upgrade. The runner never
  terminates user applications; an operator may close clearly unrelated apps only
  with explicit user permission, preserving other active Codex/ChatGPT work.
  Preserve memory headroom; reject production target/origin/database/Stripe mode.
- Local SQLite checkpoints and outbound authenticated staging telemetry/control.
  One mutation per agent, ambiguity reconciliation, finite retries/turns/spend.
  No shell, SQL, unrestricted HTTP, admin, or Stripe-secret tools for agents.
- Approximately 60% Neighbor, 25% Supporter, 15% Sustainer synthetic users, overlapping
  asker/helper/donor roles and at least 30 recipients; restricted cases included.
  Paid tiers provisioned through actual Stripe test flows, not entitlement edits.
- Separate fixed regression/failure scenarios, adaptive scripted community and
  optional model-selected exploration. Label the actual controller and outcomes.
- In-app admin overview, live activity, entity histories, simulation control room,
  and operational queues. Poll cursors every two seconds while visible; target
  five-second visible updates, connection/freshness states, idle-page backoff.
- Honest agent states: idle/observing/queued/generating/acting/backoff/paused/failed.
  Correlate intent, tool call, authoritative application result, Stripe event,
  and ledger. No fabricated metrics or treating attempted actions as successes.
- Start/pause/resume/stop, per-agent controls, activity/concurrency settings,
  history replay versus new reruns, laptop offline detection/checkpoint recovery.
- Centrally defined giving/fulfillment/fund availability/recurring revenue and
  operations metrics; never mix simulation with production or fund subscriptions
  with supporter MRR. Filters and exports retain denominators and time bounds.

## Ordered delivery and acceptance evidence

| ID | Required outcome | Status / authoritative evidence |
| --- | --- | --- |
| F01 | Baseline preserved; isolated staging/CI settings and synthetic-only DB | Verified foundation: separate restricted roles/markers; production table privilege probes deny read/write. Public production unchanged. |
| F02 | Additive migrations, auth hardening, roles, admin step-up, audit events | Implemented and tested in isolated DBs; migrations 0011-0018 applied to CI and staging only. Twelve production-policy elevation tests pass. Real Ian bootstrap/MFA still required. |
| F03 | UI-authenticated scripted/browser activity feasibility | Real CI/hosted cross-account browser/API scenarios pass, including streamed rejection and stale-target no-POST regression. Completed 25/100-account ramps; the 100-user ramp exposed three pre-POST browser halts, now fixed. Full 253-account run retained 39,591 successes but failed the hour criterion; safely stopped without rewriting history. A fresh full run remains required. Legacy MCP smoke is separate evidence. |
| P01 | Ask onboard→Checkout→webhook→contribution→transfer→receipt | Implemented behind disabled gates; actual sandbox end-to-end verification blocked on credentials/setup. |
| P02 | Full/partial refunds, disputes, recovery/payout failures | Implemented; DB/provider-stub race and recovery tests pass. Real sandbox outcomes unverified. |
| P03 | Supporter lifecycle: signup/renewal/upgrade/downgrade/cancel/failure/recovery | Staging-only test gate enabled; production disabled. Immutable quotes, paid upgrades, scheduled downgrades, cancel/resume and recovery implemented; isolated DB/stub tests pass. Provider-only CI clock fixtures genuinely paid initial/renewal invoices and canceled, with zero app mappings; this is not app/member lifecycle acceptance. Three actual ordinary-UI Checkout preparations and one unpaid expiry/signature delivery verified. Automated test-card entry blocked by provider agent panel. Portal disallows its own plan changes/immediate cancellation. |
| P04 | One-time/monthly fund gifts and reconciled admin allocations | Implemented; isolated source/recovery tests pass. Actual sandbox gifts/allocations unverified. |
| P05 | Fees, rounding, reservations, double-spend races, balanced ledger | Unit and real PostgreSQL invariants/races verified; provider reconciliation still required. |
| M01 | Per-user MCP authorization/scopes/token revocation/shared rules | Implemented; official transport, strict schemas, scoped credentials, CI concurrency/revocation tests and hosted safety probe pass. |
| A01 | All public/account/admin views and dialogs connected to real APIs | Partial: hosted accessible states verified; enabled provider/financial record states await real sandbox data. |
| A02 | Metrics reconcile with authoritative data, filters/history/freshness work | Actual SQL/API metrics and browser checks pass. First 253-user dashboard sample: 105 actions, maximum visible latency 4,002 ms, zero browser errors. Steady-state/full-soak freshness and populated financial cases remain open. |
| S01 | Configurable 1–30 browser controllers and measured hardware limits | Partial: configuration up to 30, independent bounded pools and real hosted three-browser/ten-account run pass. Recorded RAM headroom 3.02 GiB at last heartbeat; larger population, pressure behavior and maximum browser limits remain unmeasured. Local-model benchmark optional. |
| S02 | Scripted population ramp and ≥1h mixed-cohort soak after warmup | Unfinished: first 253-user run stopped after one pre-intent read failure; bounded read-only recovery fixed/tested. Replacement `a90697e2-be08-42a4-b88c-f2f176fbed0a` failed at 3,509 seconds of least-active post-warmup coverage, retaining 39,591 successes. Actual admin recovery/control-only Stop/terminal cleanup completed; no history rewritten. Fresh all-participant hour continuity remains required. Configuration up to 30 browsers is not a measured 30-browser soak. |
| S03 | Each participant ≥3 valid observe/select/act cycles and authenticated action | Partial evidence: all 253 participants had at least nine successes/four successful mutations at 13:42:35 UTC; database ownership independently verified. Actual cross-user discovery and durable outcome/reference tests pass. Full-cohort terminal journal/control checks remain open; no paid-tier implication. |
| S04 | Cross-tier/all-type/all-three-money-flow interaction evidence | Unfinished; seeded persona labels grant no paid tiers. Actual Stripe test subscriptions required. |
| S05 | Pause/resume/restart/model interruption/laptop-offline payment recovery | Partial: local checkpoints/outbox and interrupted deterministic resume exercised. Hosted empty-queue workflow only; full payment/offline scenario unverified. |
| T01 | Unit/type/lint/build/existing E2E pass without disabling checks | Passing isolated unit/integration/build/lint and hosted browser suites; exact final counts in verification record. |
| T02 | Cross-account/guest/owner/admin privacy and untrusted-input coverage | Existing browser/DB/MCP cases pass; revised runner must reject identity overrides, credential leakage and arbitrary routes. Optional model exploration additionally needs injection tests. |
| T03 | Payment success/decline/3DS/abandon/async/lost return cases | Partial: real provider-only CI initial/renewal success, decline and authentication-required probes pass; all fixtures terminal, no app money/tier mappings. Completed 3DS, hosted financial settlement and UI return/lost-return acceptance remain unfinished. Return URL cannot mark paid, verified in implementation/browser empty state. |
| T04 | Duplicate/out-of-order webhooks, workers restart/timeouts/429/reconcile | Partial: signed synthetic events and stubbed ambiguity/replay contracts pass; hosted delivery and actual provider fault cases outstanding. |
| T05 | Browser Checkout each paid tier/main money path; small test-clock cohort | Unfinished. Actual test Checkout preparations plus browser unpaid abandonment/API expiry verified. A genuine provider-only clock cohort paid initial/renewal invoices, but zero app mappings means no paid member/hosted ledger acceptance. Main money path and browser paid-tier acceptance remain open. Automated card-entry boundary blocked by provider agent panel. |
| T06 | Responsive/keyboard/all-new-modal/empty/error/load/browser+server checks | Partial: accessible desktop/mobile/confirmation states captured and tested; provider-dependent dialogs cannot be truthfully captured yet. |
| R01 | Verified staging then production-compatible deployment with live gates | Protected staging deployed. Private-copy migration and old→new→old auth/session/Ask browser rehearsal pass, fixtures removed; both builds pass. Final CI browser regression: 36 passed/four intentional skips/zero failures. A fresh no-compute backup precedes actual production 0011–0018 migration at October 3 18:37 UTC: legacy data/unrelated schema preserved and nineteen migrations total. Signed `ff131b6` dark release is READY on the public alias; 17 anonymous route/state checks and runtime/log checks pass. Every production money/simulation gate remains off; paid/live acceptance, Ian's selected admin/MFA and external auth/email checks remain unfinished. |
| R02 | README/runbook/setup/migration+rollback/evidence/feature-provenance outline | Authored; final measured evidence accompanies this checklist. Future successful provider/soak evidence must update it. |
| R03 | Updated screenshot PDF of all new views/dialogs, clearly test-labeled | Partial staging walkthrough; not the completed all-state production/payment PDF. |
| R04 | Verified signed pushes; main only; simulation stopped + restart command | Main-only local/remote verified. Signed local implementation checkpoint exists; revised simulator work is uncommitted and no implementation push/deployment has occurred. Production auto-deploy remains gated by reviewed additive migration. Runner retirement documented separately. |

High-volume payment load tests use a fake adapter in isolation, not Stripe.
Real sandbox tests and fault-injection mocks are reported separately. Zero
cross-account leakage, duplicate financial effects, unexplained ledger imbalance,
or test/production contamination are mandatory. Report measured throughput,
queue latency, tool validity, RAM/VRAM, and dashboard freshness, not estimates.

Completion requires evidence for every row, not a build alone. If Stripe/business
approval, administrator identity/MFA, authentication, limits, or paid capacity
requires Ian, record that specific external gate while completing independent
work. Never call an unapproved live-money rollout complete.
