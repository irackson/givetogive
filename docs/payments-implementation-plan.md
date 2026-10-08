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
  and operational queues. Poll live cursors every second while visible, with
  bounded incremental catch-up and failure backoff; target
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

**October 3, 21:14 UTC follow-up:** signed `bfa90f213` is READY on canonical
production, Node 24, all five financial/simulation gates still off. Fresh
anonymous browser smoke passes 17/17 states with no console/page/server errors.
The 28-member ten-minute regression completed and drained: 799 successes,
five preserved authoritative rejections, genuine browser mutations and verified
32-Ask/169-contribution ownership. All 111 measured dashboard updates met the
five-second target, maximum 2,086 ms. The combined history assertion did not
pass; the original href was not retained and follow-up heading claims were
inferred, not explicitly recorded. Corrected exact-agent API reads pass, but
the separate history-only browser stopped before admission at 2.187 GiB RAM.
No new253 run is created or running; its fresh preparation remains plan-only.
Original failed hour histories stay unchanged. Canonical tiny-cohort clock and
all three customer bindings are verified; no paid tiers are granted. The new
$5 replacement remains open/unpaid at 21:03:42 after the ordinary acknowledgment
timed out without card or submit. Read-only provider/pointer diagnostics and
actual paid settlement remain required; no universal test-card ban is inferred.
Latest RAM at 21:13:37 is 1.536 GiB; do not lower the admission floor or disturb
other active Codex/Chrome work. See the measured verification record for receipts.
The older timestamped table below is historical, not current process liveness.

**October 3, 20:43 UTC follow-up:** fresh current-source CI E2E separately
passed 36/40 cases with four explicit environment/capture skips, no failures or
retries. Protected hosted E2E also passed 36/40 with different gate coverage;
neither suite closes financial or capture acceptance. The fresh 28-member
short run is now active under verified detached supervision, with all members
past three genuine successes and all three browser members making UI mutations.
Terminal drain and dashboard freshness are still in progress; the short run
does not replace the required full-population hour. See the verification record
for exact times, skip reasons, fixture cleanup and source/deployment binding.

**October 3, 20:28 UTC follow-up:** the first $5 test Checkout reached its
20:24:36 expiry deadline with no card entry or payment submission. Its visible
agent acknowledgment had an uncertain result, retained in immutable private
receipts; a separately prepared nonfinancial recovery was never invoked. Current
provider/app reconciliation is required before a new reviewed replacement
operation. Neither an expired Checkout nor a prepared recovery is paid acceptance.
Link CLI is deferred in the icebox, not required or installed for these tests.

**October 3, 19:55 UTC staging checkpoint:** the narrowed browser-observation and
live-feed/controller cadence fixes, plus three dependency security patches, passed
125 unit tests, 121 isolated integration tests, 86 simulator tests, root/tool types,
full lint, and the guarded staging build. Protected canonical staging deployment
`dpl_9v2tUXxH8AJ7qsaaSn8UfMdCmmZS` is READY, Node 24, with authored runtime digest
`9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f`.
Existing environment metadata and Supporter-only test gates are unchanged;
production is still the earlier disabled-gate release. Fresh CI E2E, the repaired
mixed-run regression/hour, and the original five-second freshness criterion are
not yet accepted. A separate 28-account, 126-line fresh regression cohort is
prepared, not launched. Three normal sandbox accounts passed nine unpaid browser
views; the first original $5 Supporter Checkout is `checkout_open`, not paid.
Its actual provider agent acknowledgment and subsequent card/settlement workflow
are being reviewed; no real wallet, card entry, or paid recognition is claimed.
Remaining dependency advisories and bounded fresh-build traces are recorded in
`dependency-security.md`. These results do not close the financial acceptance
requirements below.

**October 3, 19:30 UTC follow-up:** the mixed run described in the 19:00 snapshot
below subsequently failed at 1,799 least-active post-warmup seconds and was safely
stopped/drained at 19:15:39 UTC. Its 29,216 successes/199 rejections are preserved;
there are no pending mutations, telemetry, live claims or controllers. The partial
steady-load dashboard sample failed the original five-second requirement
(32 late; maximum 5,583 ms; four not rendered). Narrow observation/cadence fixes
are being verified locally; another genuine hour and full measurement are required.
Canonical clock/customer setup for the fresh three-member cohort is now verified
at 19:17:48 UTC with three actual Accounts-v2 mappings and immutable bindings,
zero Asks/payments/subscriptions/paid coverage/ledger entries. Do not rerun setup
or infer paid tiers. Installed Stripe guidance does not prohibit ordinary sandbox
card automation; revalidate the actual provider screen before treating historical
browser restrictions as a current human-only gate. No new paid acceptance yet.
Targeted dependency patches and their verification are local and not yet released.
All required outcomes below remain unchanged.

**Audit checkpoint: October 3, 2026, 19:00 UTC.** The additive production
schema and disabled-gate publication are complete; the full contract is not.
Signed implementation `ff131b6` and documentation follow-up `5382663` are pushed.
The latter is READY on the canonical production alias, Node 24, with the same
browser-tested authored runtime digest `6c5b823f7a1a8ed5d73b31c8dba1ca82b900ac103a91b4b9167193d8567c4a73`.
"Implemented" or provider-only evidence below never means paid member acceptance.
The current mixed-community run is still running, not a completed hour or drained
handoff. Later receipts must supersede this timestamp rather than erase failed history.

| ID | Required outcome | Status / authoritative evidence |
| --- | --- | --- |
| F01 | Baseline preserved; isolated staging/CI settings and synthetic-only DB | Verified foundation: distinct restricted roles/markers; production-table privilege probes deny staging/CI read/write. Synthetic activity remains isolated. Production now has the reviewed additive schema and dark release; actual old→new→old normal-auth/Ask compatibility and legacy-data preservation pass. |
| F02 | Additive migrations, auth hardening, roles, admin step-up, audit events | Implemented and isolated-policy tested. October 3 18:37 UTC production 0011–0018 migration passed: nineteen total migrations, ten legacy tables preserved, unrelated schema unchanged, safe member defaults, 34 tables/116 constraints/ten triggers. Twelve production-policy elevation tests pass; Ian's selected verified administrator bootstrap/MFA remains unfinished. |
| F03 | UI-authenticated scripted/browser activity feasibility | Real CI/hosted cross-account browser/API scenarios pass, including streamed rejection and stale-target no-POST regression. Completed 25/100-account ramps; pre-POST browser halts fixed. Earlier 253 run retained 39,591 successes but failed the hour and was safely retired. Fresh 253 run is active with independently verified ownership and all-member participation, not final acceptance. Legacy MCP smoke remains separate. |
| P01 | Ask onboard→Checkout→webhook→contribution→transfer→receipt | Implemented, published dark, and production Ask payments disabled. Development/staging and CI application test keys are configured; credentials are no longer the blanket blocker. Actual recipient onboarding, normal member paid Checkout, owned signed settlement, contribution/transfer/receipt chain remain unverified. Prepare isolated recipient/Ask setup and scoped test-gate admission; human Checkout/required provider attestations must not be bypassed. |
| P02 | Full/partial refunds, disputes, recovery/payout failures | Implemented; DB/provider-stub race and recovery tests pass. Real sandbox outcomes unverified. |
| P03 | Supporter lifecycle: signup/renewal/upgrade/downgrade/cancel/failure/recovery | Implemented; staging Supporter test gate enabled, production disabled. Immutable quotes, paid upgrades, scheduled downgrades, cancel/resume and recovery pass isolated DB/stub tests. CI provider-only initial/renewal invoices were paid and canceled with zero app mappings, not member acceptance. Earlier three ordinary-UI preparations and unpaid signed expiry are genuine but not paid. Fresh three-member identity-only cohort is verified: zero clock/customer/payment/coverage/ledger records and no paid grants. Canonical clock/customer setup remains independent work; human test-card Checkout then actual hosted settlement and every lifecycle transition remain open. |
| P04 | One-time/monthly fund gifts and reconciled admin allocations | Implemented; isolated source/recovery tests pass. Actual sandbox gifts/allocations unverified. |
| P05 | Fees, rounding, reservations, double-spend races, balanced ledger | Unit and real PostgreSQL invariants/races verified; provider reconciliation still required. |
| M01 | Per-user MCP authorization/scopes/token revocation/shared rules | Implemented; official transport, strict schemas, scoped credentials, CI concurrency/revocation tests and hosted safety probe pass. |
| A01 | All public/account/admin views and dialogs connected to real APIs | Partial: hosted accessible states and seventeen anonymous production route/state checks pass; private routes remain sign-in gated. Public FAQ disclosure opens; authenticated mutation dialogs were not bypassed. Paid financial records, enabled provider dialogs and authenticated production acceptance remain unfinished. |
| A02 | Metrics reconcile with authoritative data, filters/history/freshness work | Actual SQL/API metrics and browser checks pass. First 253-user dashboard sample: 105 actions, maximum visible latency 4,002 ms, zero browser errors. Steady-state/full-soak freshness and populated financial cases remain open. |
| S01 | Configurable 1–30 browser controllers and measured hardware limits | Partial: configuration up to 30, bounded independent pools and real three-browser runs pass. Fresh 250-script/three-browser run admitted at 4.22 GiB free; 19:00 UTC review measured minimum 1.23 GiB during activity. This measures a 253-account population, not 253 simultaneous actions or 30 browsers. Final pressure/headroom report and larger-browser limits remain unmeasured. Local-model benchmark is optional. |
| S02 | Scripted population ramp and ≥1h mixed-cohort soak after warmup | Unfinished: earlier read-halt run and `a90697e2-be08-42a4-b88c-f2f176fbed0a` failed; the latter retained 39,591 successes but only 3,509 least-active post-warmup seconds, then safe recovery/Stop/drain. Fresh `2ba5c5e4-f339-4b19-88a2-013c7ed447f1` is running; at 19:00 UTC it has 19,567 successes and 1,692 measured post-warmup seconds, not an hour. Earliest possible acceptance is 19:31:45.159 UTC, subject to all-member continuity and final drain. Configuration up to 30 is not a 30-browser soak. |
| S03 | Each participant ≥3 valid observe/select/act cycles and authenticated action | Current participation subcriterion verified, not final soak: 19:00 UTC fresh-run review finds all 253 participants with ≥63 successes/≥24 successful mutations and independent ownership proof for 520 Asks/3,943 contributions. Actual cross-user discovery and durable outcome/reference tests pass. Still-running pending work/outbox is not a drained terminal checkpoint; final journal/control/ownership cleanup remains open. No paid-tier implication. |
| S04 | Cross-tier/all-type/all-three-money-flow interaction evidence | Unfinished; seeded persona labels grant no paid tiers. Actual Stripe test subscriptions required. |
| S05 | Pause/resume/restart/model interruption/laptop-offline payment recovery | Partial: real normal-auth Pause/Resume/restart and confirmed Stop/recovery/drain exercised; durable supervisor probe survives launcher exit. This does not prove laptop-offline payment recovery. Hosted empty-queue Workflow and provider-stub recovery are not actual interrupted paid settlement; that scenario remains unverified. Model exploration remains optional, not a substitute. |
| T01 | Unit/type/lint/build/existing E2E pass without disabling checks | Verified current runtime: root units 118/118, isolated integration 121/121 (zero skips), full root types/lint, exact-old/current builds, and CI E2E 36 passed/four reviewed environment/capture skips/zero failures/retries. Simulator 70/70 and types pass. Separate suites, not additive totals; provider-only and paid browser acceptance remain distinct. |
| T02 | Cross-account/guest/owner/admin privacy and untrusted-input coverage | Browser/DB/MCP authorization and normal-cookie runner allowlist/identity/diagnostic-privacy cases pass; anonymous production private-route gates pass. Populated financial cross-tier acceptance remains open. Optional model exploration additionally needs injection testing if used. |
| T03 | Payment success/decline/3DS/abandon/async/lost return cases | Partial: real provider-only CI initial/renewal success, decline and authentication-required probes pass; all fixtures terminal, no app money/tier mappings. Completed 3DS, hosted financial settlement and UI return/lost-return acceptance remain unfinished. Return URL cannot mark paid, verified in implementation/browser empty state. |
| T04 | Duplicate/out-of-order webhooks, workers restart/timeouts/429/reconcile | Partial: signature/source separation, duplicate synthetic events and stubbed ambiguity/replay contracts pass. Actual hosted thin ping and owned unpaid Checkout-expiry delivery are verified; paid-event ordering/duplicate effects and real worker interruption/timeout/429 reconciliation remain outstanding. |
| T05 | Browser Checkout each paid tier/main money path; small test-clock cohort | Unfinished. Earlier browser unpaid abandonment/API expiry and ordinary-UI preparations pass; provider-only CI paid renewals have zero app mappings. Fresh three-account staging identity cohort is provisioned without Asks or paid grants; canonical clock/customer binding is still pending at its 18:57 UTC readback. Prepare fresh short-lived handoffs only when Ian is present. Provider agent-card boundary requires human test Checkout; no new Stripe key or real card is needed for these Supporter/Sustainer tests. Main Ask/fund path acceptance remains separate. |
| T06 | Responsive/keyboard/all-new-modal/empty/error/load/browser+server checks | Partial: accessible desktop/mobile/confirmation states captured and tested; provider-dependent dialogs cannot be truthfully captured yet. |
| R01 | Verified staging then production-compatible deployment with live gates | Verified dark rollout: protected staging, private-copy old→new→old auth/session/Ask browser rehearsal, removed fixtures, both builds, final CI regression and actual production nineteen-migration preservation checks pass. Signed `ff131b6` implementation and docs-only `5382663` are pushed; latest READY `dpl_EsFLCGY9TMfRKeb5Qq1Lr8K2iVo1` owns the public alias with unchanged tested runtime. Seventeen anonymous browser states pass; latest 18:56 UTC runtime gate/signature/log probes pass. All five production gates remain off. Authenticated production, external OAuth/email, Ian admin/MFA and paid/live acceptance remain unfinished. |
| R02 | README/runbook/setup/migration+rollback/evidence/feature-provenance outline | Authored; final measured evidence accompanies this checklist. Future successful provider/soak evidence must update it. |
| R03 | Updated screenshot PDF of all new views/dialogs, clearly test-labeled | Partial staging walkthrough and four anonymous published-smoke screenshots exist; neither is the completed all-view/dialog production/payment PDF. Final paid-state screenshots require genuine settled sandbox records; public/recovery/control-room capture work can continue independently. |
| R04 | Verified signed pushes; main only; simulation stopped + restart command | Signed verified `ff131b6`/`5382663` pushes and only-main local/remote are complete; revised runner is tracked/published. Failed run retirement/recovery commands are documented. Fresh 253 run is still active, so the final stopped/drained handoff and its exact safe restart guidance remain unfinished. Never duplicate a live run or replay unresolved intents. |

### Remaining work versus actual external gates

This checkpoint does not reduce P01–P05, S04–S05 or T03–T06 to mock tests.

- **Independent work continues:** finish explicit short-run history navigation,
  then create and verify a fresh253-account hour (none currently running), with
  authoritative continuity/ownership/drain review and steady-load dashboard
  freshness/history. Tiny-cohort canonical clock/customer setup and three normal
  unpaid sessions are verified; do not rerun that setup. Audit least-privilege
  key permissions; prepare
  isolated Ask/recipient/fund prerequisites and failure/recovery scenarios;
  capture non-paid public, auth, empty/error and control-room views. Preserve
  current live controller/journals, measured RAM guards and expired/ambiguous
  financial intents. A stale heartbeat never authorizes another runner.
- **Existing credentials are sufficient for the next three Supporter test
  Checkouts.** Actual staging Development and CI test account/key setup is
  configured. Fresh staging run `1aa24b5b-c467-4063-a62a-cd6df957b393` has three
  verified password-auth synthetic members and scoped private credentials;
  Its earlier 18:57 UTC identity-only readback was superseded by genuine canonical
  clock/customer setup. Current readback has the terminal expired original and
  unpaid replacement, no subscription/paid coverage/ledger and all three Neighbor.
  Desired Supporter/Sustainer/Supporter personas are not paid tiers. Do not rerun
  its once-only identity/admin/clock/customer setup or either financial preparation.
  Existing credentials are not a reason to ask Ian for new keys. The original
  expired admission remains preserved in the finite budget; later admissions
  require a separate reviewed budget check, not resetting its private journal.
- **Human Checkout boundary:** Ian must complete the fresh hosted **test** card
  Checkouts if the provider's agent-control panel continues to prevent automated
  entry. Prepare the actual owned $5/$15/$5 sessions only when he is present;
  no real card or real-money fallback. Then independently verify provider truth,
  signed hosted inbox processing, app paid coverage/recognition and balanced
  ledger before renewals, lifecycle changes, refunds and recovery acceptance.
  Expired sessions, provider-only invoices and browser return pages do not pass
  these requirements. The full Ask/fund/cross-tier suite still remains required.
- **Live-only human/operational gates:** Ian's chosen unambiguously verified
  production administrator and personal TOTP setup; genuine recipient/business
  verification and legal agreements; eligibility/negative-balance obligations,
  subscription tax review and any required registrations. External OAuth/email
  delivery and authenticated production checks are unverified, not waived.
  Never invent identities/business facts, attest for Ian, or enable any live
  gate based only on successful sandbox evidence.

Authoritative private receipts for this audit: `tmp/production-payments-migration.json`,
`tmp/production-deployment-binding-1791053755721.json`,
`tmp/production-dark-release-probe.json`, `tmp/production-log-probe.json`,
`tmp/final-root-acceptance.json`, `tmp/production-release-smoke/evidence.json`,
`tmp/stripe-test-acceptance-results.md`, `tmp/stripe-test-acceptance-accounting-scope.json`,
`tmp/stripe-test-acceptance-cohort-readback.json`, and
`tmp/community-stage/review-2ba5c5e4-f339-4b19-88a2-013c7ed447f1-1791054041660.json`.
These contain safe evidence or remain ignored; never upload the private credential
files or opaque Checkout handoff URLs alongside them.

High-volume payment load tests use a fake adapter in isolation, not Stripe.
Real sandbox tests and fault-injection mocks are reported separately. Zero
cross-account leakage, duplicate financial effects, unexplained ledger imbalance,
or test/production contamination are mandatory. Report measured throughput,
queue latency, tool validity, RAM/VRAM, and dashboard freshness, not estimates.

Completion requires evidence for every row, not a build alone. If Stripe/business
approval, administrator identity/MFA, authentication, limits, or paid capacity
requires Ian, record that specific external gate while completing independent
work. Never call an unapproved live-money rollout complete.

## Icebox

- **Ian's personal admin MFA enrollment — deferred by Ian, October 8, 2026.**
  Dashboard viewing uses normal authentication and a fresh database identity
  check: only the verified, unfrozen `inasusr@gmail.com` real account is allowed.
  Synthetic admins remain available only in explicitly isolated staging/test;
  agents use those normal accounts, not a secret production bypass. This does
  not grant a financial admin role or remove existing production financial
  step-up requirements. Live payment gates remain off. Revisit enrollment before
  releasing live financial operator actions.

- **Link CLI for future agent purchases — deferred by Ian, October 3, 2026.**
  Do not install or authenticate it during this release. This optional wallet
  integration is not required for GiveToGive sandbox testing and does not
  authorize real purchases or access to personal financial history. Revisit
  only after Ian brings it out of the icebox.
