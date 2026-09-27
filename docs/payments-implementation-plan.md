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
  to live payments or production data. Staging email sink and access restriction.
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

- 100 independent Strands TypeScript agents, not one shared Swarm conversation.
  Separate account/personality/goals/budget/memory/relationships/schedules.
- Native Windows llama.cpp shared local model. Benchmark Qwen3.5-4B Q4_K_M
  against Gemma 4 E2B QAT Q4_0; retain revision/hash/settings and measurements.
  Start at two inference requests, 4K contexts, bounded outputs, two browser
  workers with independent sessions; adapt rate to measured capacity.
- No paid-model fallback, user-app termination, or automatic subscription upgrade.
  Preserve memory headroom; reject production target/origin/database/Stripe mode.
- Local SQLite checkpoints and outbound authenticated staging telemetry/control.
  One mutation per agent, ambiguity reconciliation, finite retries/turns/spend.
  No shell, SQL, unrestricted HTTP, admin, or Stripe-secret tools for agents.
- 60 Neighbor, 25 Supporter, 15 Sustainer synthetic users, overlapping asker/helper/
  donor roles and at least 30 recipients; incomplete and restricted cases included.
  Paid tiers provisioned through actual Stripe test flows, not entitlement edits.
- Separate deterministic regression/failure mode and autonomous model-selected
  behavior. Seeded scenarios do not imply deterministic model generation.
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
| F03 | Ten-agent local inference + MCP + telemetry feasibility | Partial: ten deterministic members exercise hosted MCP/browser/telemetry. One narrow Gemma decision passes; autonomous ten-member feasibility NOT established. |
| P01 | Ask onboard→Checkout→webhook→contribution→transfer→receipt | Implemented behind disabled gates; actual sandbox end-to-end verification blocked on credentials/setup. |
| P02 | Full/partial refunds, disputes, recovery/payout failures | Implemented; DB/provider-stub race and recovery tests pass. Real sandbox outcomes unverified. |
| P03 | Supporter lifecycle: signup/renewal/upgrade/downgrade/cancel/failure/recovery | Implemented behind disabled gates: immutable quotes, paid upgrades, scheduled period-end downgrades, undo/cancel/resume, durable recovery and exact historical paid/application evidence. Isolated DB/stub tests pass, including dunning/frozen-account cancellation and stale provider-response fencing. Actual Stripe invoices, hosted Checkout and test-clock lifecycle acceptance remain outstanding. Portal still disallows its own plan changes/immediate cancellation. |
| P04 | One-time/monthly fund gifts and reconciled admin allocations | Implemented; isolated source/recovery tests pass. Actual sandbox gifts/allocations unverified. |
| P05 | Fees, rounding, reservations, double-spend races, balanced ledger | Unit and real PostgreSQL invariants/races verified; provider reconciliation still required. |
| M01 | Per-user MCP authorization/scopes/token revocation/shared rules | Implemented; official transport, strict schemas, scoped credentials, CI concurrency/revocation tests and hosted safety probe pass. |
| A01 | All public/account/admin views and dialogs connected to real APIs | Partial: hosted accessible states verified; enabled provider/financial record states await real sandbox data. |
| A02 | Metrics reconcile with authoritative data, filters/history/freshness work | Actual SQL/API metrics and browser checks pass; measured simulation telemetry available. Financial populated cases and full freshness SLA remain acceptance work. |
| S01 | Model/tool reliability benchmark and documented hardware limits | Not accepted: Qwen timeouts; two separate one-decision Gemma successes around 50s. Latest short raw probe succeeded in 1.64s; structured run ended with only 0.91 GiB free RAM. Insufficient reliability/throughput evidence; owned model stopped. See simulation guide. |
| S02 | 10→25→100 ramp, ≥1h 100-agent soak after warmup | Unfinished. Deterministic smoke is not autonomous ramp or soak evidence. |
| S03 | Each agent ≥3 valid observe/decide/act cycles and authenticated action | Unfinished for the 100-agent autonomous cohort. Ten-member deterministic cycles tracked separately. |
| S04 | Cross-tier/all-type/all-three-money-flow interaction evidence | Unfinished; seeded persona labels grant no paid tiers. Actual Stripe test subscriptions required. |
| S05 | Pause/resume/restart/model interruption/laptop-offline payment recovery | Partial: local checkpoints/outbox and interrupted deterministic resume exercised. Hosted empty-queue workflow only; full payment/offline scenario unverified. |
| T01 | Unit/type/lint/build/existing E2E pass without disabling checks | Passing isolated unit/integration/build/lint and hosted browser suites; exact final counts in verification record. |
| T02 | Cross-account/guest/owner/admin privacy and prompt-injection coverage | Browser/DB/MCP authorization cases pass. Broad local-model injection benchmark remains unfinished. |
| T03 | Payment success/decline/3DS/abandon/async/lost return cases | Unfinished provider acceptance. Return URL cannot mark paid, verified in implementation/browser empty state. |
| T04 | Duplicate/out-of-order webhooks, workers restart/timeouts/429/reconcile | Partial: signed synthetic events and stubbed ambiguity/replay contracts pass; hosted delivery and actual provider fault cases outstanding. |
| T05 | Browser Checkout each paid tier/main money path; small test-clock cohort | Unfinished; no actual Stripe sandbox Checkout executed. |
| T06 | Responsive/keyboard/all-new-modal/empty/error/load/browser+server checks | Partial: accessible desktop/mobile/confirmation states captured and tested; provider-dependent dialogs cannot be truthfully captured yet. |
| R01 | Verified staging then production-compatible deployment with live gates | Protected staging deployed. Production migration/deployment deliberately not performed; payment gates remain off. |
| R02 | README/runbook/setup/migration+rollback/evidence/feature-provenance outline | Authored; final measured evidence accompanies this checklist. Future successful provider/soak evidence must update it. |
| R03 | Updated screenshot PDF of all new views/dialogs, clearly test-labeled | Partial staging walkthrough; not the completed all-state production/payment PDF. |
| R04 | Verified signed pushes; main only; simulation stopped + restart command | Main-only local/remote verified. No implementation commit/push yet: production auto-deploy must not run before reviewed additive migration. Runner retirement documented separately. |

High-volume payment load tests use a fake adapter in isolation, not Stripe.
Real sandbox tests and fault-injection mocks are reported separately. Zero
cross-account leakage, duplicate financial effects, unexplained ledger imbalance,
or test/production contamination are mandatory. Report measured throughput,
queue latency, tool validity, RAM/VRAM, and dashboard freshness, not estimates.

Completion requires evidence for every row, not a build alone. If Stripe/business
approval, administrator identity/MFA, authentication, limits, or paid capacity
requires Ian, record that specific external gate while completing independent
work. Never call an unapproved live-money rollout complete.
