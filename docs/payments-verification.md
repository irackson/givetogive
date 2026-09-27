# Payments and simulation: measured verification

Recorded September 26-27, 2026 (America/New_York). Hosted timestamps are UTC.
**Partial implementation acceptance, not a live-money release.**
The authoritative requirements remain in [the contract](payments-implementation-plan.md).

## Where this work is running

- Baseline: `f6638fe0b1845ae9cceb937959138af38d1ba971`, branch `main`.
- Public production remains `https://givetogive.vercel.app`, unchanged by this
  work. No production migrations, synthetic records or real payments were made.
- Protected staging: `https://givetogive-staging.vercel.app`, project
  `prj_HvlFV1kKHVsML73nlsJAFQNA7grP`.
- Protected hosted checkpoint (predating the new local supporter-change slice):
  `dpl_F7bF7cEViSugHKq9aNjg8Hyk1ZJR`, immutable address
  `https://givetogive-staging-jteyuuoa1-iracksons-projects.vercel.app`.
- Payment, supporter and fund gates are false. Application Stripe credentials
  remain unconfigured, never live. CLI authentication is separate (see below).
  Staging and CI have separate restricted databases/roles and
  environment identity markers; neither can read/write production app tables.
- Vercel protection covers **all** staging deployment URLs. An anonymous
  request redirects to Vercel authentication. Test bypass is host-scoped and
  never sent as a global browser header to Stripe or OAuth origins.

## Earlier protected-hosted checkpoint

These measurements belong to the hosted checkpoint above. They do not claim the
new local supporter-change code has been deployed or provider-accepted.

| Check                                 | Observed result                                                       | Boundary                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit suite                            | 47 passed                                                             | Existing domain + payment/environment + MCP policy/transport, script preflight, portal policy, sandbox Checkout/clock policy, publishable-key mode/secret-exposure safeguards.                                                                                                               |
| Isolated CI integration suite         | 57 passed                                                             | Real isolated PostgreSQL: 25 payment, 12 production-policy admin elevation, 8 MCP/simulation, 2 auth concurrency, 3 isolation preflight, 4 case/control, 3 separate-transaction control races. Provider recovery adapters are stubbed.                                                       |
| Local simulator suite                 | 27 passed; typecheck passed                                           | Scheduler/checkpoints/budgets/browser readiness/telemetry safety and controlled Checkout/clock harness, not autonomous/provider acceptance.                                                                                                                                                  |
| TypeScript, lint and production build | Passed                                                                | No disabled checks. Isolated staging build; hosted build also passed.                                                                                                                                                                                                                        |
| Production dependency audit           | Zero vulnerabilities                                                  | `npm audit --omit=dev --audit-level=moderate` at this snapshot.                                                                                                                                                                                                                              |
| Protected hosted browser suite        | 29 passed, no skips (2.3 minutes)                                     | Existing community views/workflows, private recovery-email sink, auth boundaries, new admin/member views, case acknowledgement/escalation, Ask pause/resume, actual TOTP enrollment/replay/elevation, session revocation, real analytics, simulation record creation, hosted workflow probe. |
| Hosted durable recovery               | Completed: `wrun_01M3J8DMTVXJ0SR201EVGNQESW`                          | Real hosted workflow with genuinely empty financial queues on the current deployment. No Stripe call/payment lifecycle claimed.                                                                                                                                                              |
| Final-deployment runtime error query  | No error-level logs at check                                          | Historical first-deployment `/giving` unauthorized SSR error fixed with page-level early auth guards and regression tested.                                                                                                                                                                  |
| Database isolation probe              | Both identities/restricted roles pass; no production table privileges | Read-only privilege metadata; no production member rows read.                                                                                                                                                                                                                                |
| Git branches                          | Only local `main` and remote `main`                                   | Implementation remains uncommitted/unpushed; do not trigger production auto-deploy before its reviewed migration.                                                                                                                                                                            |

## New local supporter-change checkpoint — September 27

- Local implementation now includes paid-upgrade, scheduled downgrade,
  cancellation/resumption and undo services; immutable preview/confirm/history
  APIs; billing UI; workflow/recovery integration; paid service intervals; guarded
  clock-time recognition; durable applied-event evidence; and fenced provider
  observations. The [slice design](supporter-changes-design.md) describes the
  implemented boundaries. This is not an actual Stripe lifecycle acceptance.
- The latest completed root unit checkpoint is **91 passing** (including seven
  new preflight checks); the earlier complete isolated CI checkpoint was **93
  passing**, plus lint. That CI run precedes the three additional coverage
  regressions below; do not add the focused counts to those totals because suites
  overlap. Final integrated typecheck/build/rerun remains a separate release check.
- The wider 36-case local browser run had **31 passing, 4 intentional environment/
  capture skips and 1 case-sensitive label assertion failure**. The assertion was
  corrected to the actual `Neighbor` label, then its targeted rerun passed 1/1.
  This is not described as a clean full-suite rerun. All five supporter cases
  passed within that run. A fresh build after the authentication split is pending.
- The local simulator suite now passes **28 tests** and its typecheck, including
  redacted validation diagnostics and clearing raw transcripts. This adds no
  autonomous model or actual provider acceptance evidence.
- Focused evidence checks passed **7 policy + 6 rollback-only CI database tests**:
  delayed application after renewal, exact ownership/invoice/item/price/period,
  immutable replay, stored-event recovery, metadata rejection, trigger-level
  rewrite/delete/truncate prevention, and refund/dispute suppression after replay.
- The coverage CI suite passed **7 tests**, including three new regressions for
  fund-versus-supporter isolation and proration-start containment in both the
  subscription-observation SQL path and the invoice-reconciliation callback.
  These run real SQL with explicit provider stubs inside rollback fixtures.
- **8 focused local Playwright tests passed in 44.7 seconds without skips or
  retries**: the five supporter cases (signed-out auth, free-member billing/
  support, foreign/unknown operations, profile privacy and pending recognition)
  plus three frozen-account cases. Fresh verified frozen sign-in reaches only
  restricted billing; old sessions remain revoked; normal/admin/portal/Checkout
  APIs remain denied; public profiles do not receive frozen owner identity;
  unverified sign-in is denied; restricted sign-out works. The latest clean run
  also checks that empty recurring history exposes no fund cancellation control,
  an unknown fund handoff fails closed when its dedicated policy is unavailable,
  and signed-out fund cancellation requests return 401. An earlier clean run
  passed 8/8 in 37.5 seconds before these fund assertions. No payment/subscription/
  paid-coverage fixtures were created.
  This proves browser/auth boundaries, not actual Stripe cancellation or a paid
  tier. The owned loopback server stopped after the run.
- **4 focused UI policy regressions passed** for the reopened restricted undo
  quote: confirmation now uses server-issued `canConfirm`, independent of the
  discarded local preview input. Server-denied undo remains hidden; restricted
  upgrade/downgrade/resume stay hidden even with a positive capability; separate
  sales/management gates remain enforced. This uses capability objects only,
  not synthetic paid database records. Current TypeScript and owned-file ESLint
  passed. The actual Stripe confirmation remains separately unaccepted.
- Migrations **0017/0018 are applied to isolated CI and staging**, never production.
  The staging guard verified database `givetogive_staging_20260926` with zero
  subscriptions/settled payments before migration; the schema now has 34 tables.
  The new application code has not yet been deployed to that staging schema.
  Old paid coverage needs the documented verified-invoice backfill/preflight;
  no historical start/item/application evidence may be invented.

### Stripe setup status

CLI **1.52.0** is authenticated to Ian's original account
`acct_1QRImkDGxNrMbq4f`; a test-balance read succeeded. Separate sandboxes were
created with live-settings copying off: **GiveToGive Development**
`acct_1UKPU8Ded7vKVapt` and **GiveToGive CI** `acct_1UKPVfD0WEho6xH0`.
Additional authorization completed for **both Development and CI**. Actual
`/v1/balance` reads in each confirmed `livemode: false` and zero balances. The CLI's
active sandbox is GiveToGive Development at this checkpoint.
Application restricted API keys, webhook signing secrets and catalog
are not yet configured. No Checkout/card/provider-payment write or paid tier
is implied by sandbox creation or successful CLI authorization.

## Actual local and hosted simulation results

`sim-smoke-deterministic-20260926-b` completed **10 members x 3 cycles = 30
successful actions in 49.127 seconds**. Each independently authenticated member
performed MCP identity/search and a browser visit. All 10 browser checkpoints
loaded fully with no console/page errors. All **200 telemetry events were
acknowledged**, no pending outbox remained, and hosted status was `completed`.
This is deterministic runtime evidence, not model-selected autonomous behavior.

A separate hosted safety probe verified duplicate-save idempotency, private
operation ownership, forged-actor rejection and absence of financial tools when
Stripe is unconfigured. The first smoke exposed and fixed a null-session browser
bug; interrupted execution resumed persisted cycles without replaying completed
actions. Both smoke runs' 22 credentials were revoked/expired after final sync;
immutable histories remain. No owned simulator or model process was left running.

Qwen3.5-4B probes timed out. Gemma 4 E2B produced one valid real tool decision in
49.79 seconds after correcting llama.cpp tool-selection compatibility. This is
approximately 1.2 decisions/minute in that narrow probe, not a statistically
useful reliability measurement or acceptable 100-agent throughput result.
Low GPU clocks/power-limit telemetry merits diagnosis, not an assumed explanation.
No user applications, drivers or power settings were changed for benchmarking.

See [the simulation guide](simulation.md) for revisions/hashes, settings, failed
benchmarks, measured RAM, exact smoke runs, controls and restart commands.

## Still unfinished

### External inputs and live-launch gates

- Provision scoped application restricted keys, signed webhook endpoints and the separate sandbox
  catalog. The CLI and connected chat integration are not server API keys.
  No credentials should be pasted into chat.
- Unambiguously identify Ian's verified application account; enroll his own
  authenticator. The seeded staging admin is synthetic, not Ian.
- Before any live enablement: provider/business eligibility, Connect verification,
  tax decisions/registration, hosting and recovery SLA review, production backup
  and migration, explicit live approval.

### Remaining implementation and acceptance work

- Frozen billing-only authentication and browser boundaries passed the focused
  checks above. Actual provider cancellation remains unaccepted; recurring-fund
  cancellation now has a separately scoped cancel-only handoff and gate-off
  browser rejection checks, not an accepted hosted cancellation lifecycle.
  General billing portal access stays unavailable to restricted identities.

- Actual provider validation of the newly implemented separate, serial
  Stripe-hosted Checkout/3DS executor, its server-owned attestation, durable
  budgets and reconciliation-only retries. The ordinary model/member browser
  remains same-origin; private payment controls are excluded from model tools.
- Actual sandbox cohort onboarding/subscription purchases and test-clock
  create/bind/advance tests. The scoped tiny-cohort clock lane is implemented;
  it has not contacted Stripe. Never substitute entitlement edits or persona
  labels for actual paid tiers.
- Dedicated paid-upgrade, scheduled cross-product downgrade, cancellation,
  resumption and undo services are now implemented locally and covered by
  policy/database tests with provider stubs. Deploying this new slice to protected
  staging and genuine signed-webhook/renewal/change/cancellation acceptance remain
  outstanding. Portal configuration remains separately guarded and unprovisioned.
- Real provider acceptance: onboarding, each Checkout/paid tier/fund path,
  renewals/plan changes, cancellation/failure recovery, declines/3DS/async,
  hosted signed webhooks, transfers/payout failures, refunds/disputes and
  crash/reconciliation. Stubbed transport tests are not provider proof.
- Robust model quality/injection/throughput benchmarks; autonomous 10/25/100
  ramp; one-hour 100-agent soak; every agent's required valid cycles;
  cross-tier/all-type/all-money-path interactions and dashboard freshness SLA.
- Production-compatible deployment, verified signed push, completed all-state
  provider/live-gated walkthrough. A READY staging deployment is not this result.

## Documents and screenshots

The [feature outline](payments-feature-outline.md) uses `existed before`,
`partly implemented before`, `brand new` and `newly finished` against `f6638fe`.
Tags describe provenance, not acceptance.

The partial staging PDF is generated from an opt-in hosted capture, with real
empty/disabled states and masked emails. It deliberately excludes authenticator
secrets, browser traces, credentials and fictional financial records. It does
not replace `givetogive-published-walkthrough.pdf`, the earlier public release guide.
The refreshed capture contains 50 actual views, including the loaded money-Ask
cards and operator dialogs, with no browser-console/page/server diagnostics.
All three temporary accounts, the unpaid demonstration Ask and nonfinancial
review fixture were removed afterward. The resulting 60-page PDF includes the
tagged capability appendix; all pages were rendered/visually reviewed and text
checked, with dense appendix pages also inspected at higher resolution.

New operator acceptance includes append-only case acknowledgement/escalation,
new-reservation pause/resume, and audit-revision concurrency protection. An ABA
regression verifies that a stale resume cannot clear a newer pause. Separate
backend transactions prove one effect/audit for competing revisions, stable
retries, and both reservation-versus-pause orderings without deleting holds.
The first 29-test hosted run passed 28 and exposed a test assertion racing the
dialog exit animation (duplicate visible case text). Waiting for dialog removal
fixed the assertion; the full 29-test rerun passed without retries or skips.

The [runbook](payments-runbook.md) contains isolated commands, security boundaries,
migration/rollback considerations, provider policy limits and metric definitions.

## Goal provenance

The saved goal inspected during this work belongs to this same `GiveToGive_DEV`
thread (`01a0404b-d64a-7382-9107-a34d97217891`). No second independent goal was
identified. The named payment/UI/simulation workers are collaborating subagents,
not evidence of additional user-created goals. The stored controller was paused
and subsequently resumed as active on September 27; its thread ID and full
objective remained unchanged. The user was notified when it resumed. No
duplicate goal or recurring background automation was created.
