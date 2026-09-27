# Resume here: payments and simulation checkpoint

Recorded September 27, 2026 (America/New_York). Ian requested a safe pause point
because his usage is running low. **The full goal is not complete.** Do not infer
production readiness from the large amount of implemented local code.

## Release boundary — read first

- Working directory: this GiveToGive checkout, branch `main`. Keep only `main`
  locally and remotely. Preserve local work; do not reset, clean, or stash it away.
- The published application baseline is commit
  `f6638fe0b1845ae9cceb937959138af38d1ba971` at
  <https://givetogive.vercel.app>. Production has **not** received migrations
  `0011` through `0018`.
- Remote `main` was verified at signed commit `e2cd44d30fd62ab65a611aa1adbfdeba7f42afd5`,
  containing only this handoff and safe ignore rules. The payment,
  auth, admin, and simulation implementation is **not production-ready** and
  must not be pushed into an automatic production deployment yet.
- The credential scan classified the remaining password match as a deliberate
  redaction-test sentinel, not an account password. This implementation is being
  saved in a separate local-only signed checkpoint. Inspect `git status`,
  `git log origin/main..main`, and the final chat report to confirm it exists.
  Its subject is `Checkpoint isolated payments and simulation work (not production ready)`.
  A local recovery bundle, if created, is `tmp/checkpoints/payments-pause.bundle`.
  The bundle excludes ignored environment files, models, dependencies, and keys.
- **Do not blindly push an ahead-of-origin local checkpoint.** New code reads
  new database fields even with payment feature gates off. Production requires
  an explicitly reviewed additive migration and compatible release sequence.
- Root `.env.local` is production-like. Never use normal `db:migrate`, `db:push`,
  `db:seed`, or unguarded development/tests as a shortcut. No production payment,
  fixture, migration, or data change was made during this implementation.
- `.vercel/project.json` links **production**, not staging. Do not run a generic
  `vercel --prod` from this checkout. Production project:
  `prj_ybTPdccFCvwTBUNrYDC8qxJ2fqq3`.

## Requirements and implemented scope

Read `docs/payments-implementation-plan.md` as the acceptance contract, then
`docs/supporter-changes-design.md`, `docs/payments-runbook.md`, and
`docs/simulation.md`. This dated handoff supersedes older status paragraphs in
those documents; it does not change the requirements.

Implemented locally, not fully provider-accepted:

- Partial Ask payments, Connect Accounts v2, reservations, ledger, reconciliation,
  refund/dispute capacity handling, webhook ingestion and durable recovery.
- Supporter/Sustainer checkout, paid upgrades, scheduled downgrades, cancel,
  resume, unpaid-upgrade undo, immutable quote/history and paid coverage evidence.
- One-time/monthly fund contributions, allocation controls and dedicated
  cancellation-only hosted portal handoff for an owned recurring fund subscription.
- Admin MFA/elevation, operational cases/controls, audit, analytics and simulation
  activity/history; scoped MCP; Strands/local-model simulation tooling.
- Fresh verified frozen-member login yields restricted billing-only identity;
  ordinary sessions/API privileges remain denied. Cancellation and unpaid-upgrade
  undo are available without opening Checkout, general portal, or account editing.
- Latest freeze/send fix commits a provider-start marker under the member row
  lock. Freeze prevents unsent upgrade/resume, while previously started requests
  retain same-key recovery. No provider network call is held in a DB transaction.

## Verified environments and deployment state

- CI database **and role**: `givetogive_ci_20260926`, `.env.ci.local`.
- Staging database **and role**: `givetogive_staging_20260926`, `.env.staging.local`.
- Both isolated schemas have migrations through **0018**. Before the last staging
  migration, the safety guard verified zero subscriptions/settled payments.
- Both files are ignored. Credentials must remain there or in the appropriate
  secure deployment environment, never in chat/source/docs.
- All payment/supporter/fund sales gates remain **off**; live approval is false.
  Application restricted API keys and webhook signing secrets are still missing.
- Protected staging: <https://givetogive-staging.vercel.app>, project
  `prj_HvlFV1kKHVsML73nlsJAFQNA7grP` (same Vercel team as production).
- Most recent hosted staging checkpoint: `dpl_F7bF7cEViSugHKq9aNjg8Hyk1ZJR`,
  <https://givetogive-staging-jteyuuoa1-iracksons-projects.vercel.app>.
  **It predates the latest supporter/frozen-account/fund-cancellation changes.**
- Staging protection covers all deployment URLs. Scope any bypass to that exact
  staging host; never send it as a global header to Stripe/OAuth pages.

## Stripe setup — actual completed work vs remaining work

Stripe CLI 1.52.0 is installed at `C:\Users\Ian\bin\stripe.ps1`. Both separate
sandboxes are authorized. Development/test was selected at checkpoint; recheck
before any command. Never copy CLI-managed credentials into the application.

| Sandbox | Account | Supporter $5/month | Sustainer $15/month |
| --- | --- | --- | --- |
| Development | `acct_1UKPU8Ded7vKVapt` | `price_1UKQAjDed7vKVapt1QVzZRIt` | `price_1UKQAkDed7vKVaptGa4556dB` |
| CI | `acct_1UKPVfD0WEho6xH0` | `price_1UKQJCD0WEho6xH0IBZoR5U5` | `price_1UKQJDD0WEho6xH0J3XTq21f` |

Actual sandbox products/prices and portal configurations were created with
explicit account contexts and environment metadata. Responses verified
`livemode: false`; IDs are in the corresponding ignored local env files.

- Development normal portal: `bpc_1UKQB4Ded7vKVaptehd5loWp`.
- Development cancellation-only portal: `bpc_1UKQIeDed7vKVaptAwWizyOq`.
- CI normal portal: `bpc_1UKQJsD0WEho6xH0A3YMmF9y`.
- CI cancellation-only portal: `bpc_1UKQJsD0WEho6xH0XAOdSp70`.
- Actual Development portal responses passed the application's policy validators.
  Normal portal allows invoices/payment method management but not plan changes;
  dedicated portal enables only period-end/no-proration cancellation. Both disable
  portal login and pausing. Test actual hosted flow before claiming acceptance.
- No customers, Checkout sessions, payments, subscriptions, transfers, or webhook
  destinations were created in this setup segment. Catalog setup is not payment QA.

**Security handoff:** the Stripe Dashboard unexpectedly exposed the default
Development test secret in a tool diagnostic. Ian was notified. Do not reuse or
repeat it; **rotate that test secret before use**. No live key was involved.
Two unsaved restricted-key drafts may remain open in the browser (Development
and CI). No key was created. Obtain action-time approval/secure user entry,
without dumping API-key pages or logging values. The proposed 19-permission
draft has NOT been proven least-privilege. In particular, Accounts v2,
subscription schedules, invoice-payment reads and inline Checkout product/price
creation need actual permission testing. Do not broaden permissions speculatively.

## Verification at pause

These results are intentionally separate; do not add overlapping focused runs.

- Latest staging production build: **`npm run build:staging` passed** (37 static
  pages). This checks current local application code, not a new hosted deployment.
- Root unit suite: **102/102 passed**.
- Global TypeScript check: passed after the final freeze-lock race test.
- Root lint: **passed with no warnings** after renaming one unused test argument.
- Latest supporter service suite: **18/18 passed**, plus **1/1** new explicit
  separate-transaction freeze/send race test, rerun successfully after its TS fix.
- Fund cancellation: **3 unit + 6 isolated CI/stub tests passed**.
- Focused local browser run: **8/8 passed**, no skips/retries; includes restricted
  billing, supporter views, unknown fund handoff denial and signed-out denial.
- Earlier complete isolated CI integration checkpoint: **93/93 passed**, but
  **predates latest changes**. A fresh complete CI run is still required.
- Earlier full browser run: 31 passed, 4 intentional environment/capture skips,
  1 case-sensitive `Neighbor` assertion failure; corrected targeted rerun passed
  1/1. A clean complete rerun is still required; do not call this fully green.
- Simulation suite: **28/28 and typecheck passed** at the preceding checkpoint.
- Production dependency audit: zero vulnerabilities at the preceding checkpoint.
- SQL tests use isolated databases/provider stubs, not real Stripe acceptance.
  Synthetic fixtures have been retired through reversible freeze/cancel/expiry;
  preserve ledger and payment audit history, never delete it to clean up tests.
- All subagents finished; owned browser-test servers and model process stopped.
  Recheck ports/processes on resume; do not terminate unrelated user applications.

## Local-model / 100-agent acceptance is still open

Hardware: G16, 16 GB RAM, RTX 4070 Laptop 8 GB. Recheck live available resources.
Native llama.cpp and pinned Qwen3.5-4B Q4_K_M / Gemma 4 E2B QAT Q4_0 models are
installed in ignored simulation runtime storage. Qwen hit 60-second timeouts.
Gemma completed two separate single decisions at approximately 50 seconds each;
latest measured throughput was 1.2 decisions/minute with only 0.91 GiB free RAM
afterward. The owned model was stopped. CUDA lists the GPU, but actual offload /
performance bottleneck has **not** been diagnosed. Ten deterministic hosted
members previously exercised MCP/browser telemetry; this is not evidence for
100 autonomous agents or the required one-hour soak.

Do not claim a paid 60/25/15 cohort exists: labels alone are not paid entitlement.
Agents must earn the expected provider-derived entitlement through real sandbox
flows. No fabricated paid invoices/coverage or manually assigned paid tiers.

## Resume in this order

1. Inspect Git status/log, this note, goal status and current deployment IDs.
   Confirm Ian resumed the goal; preserve the local checkpoint and remain on main.
2. Run the remaining integrated checks against **isolated** environments. Normal
   starting commands: `npm run test:unit`, `npm run lint`,
   `npm run test:integration`, `npm run build:staging`, and
   `npx playwright test`. Playwright loads/guards `.env.ci.local`; never point it
   at production. Inspect fixture cleanup and configuration before running.
   Simulator: `npm --prefix tools/simulation test` and
   `npm --prefix tools/simulation run typecheck`.
3. Complete secure sandbox-key rotation/RAK entry, webhook destination/secrets,
   Connect setup and protected staging environment configuration. Update the
   older runbook status (catalog/portals are no longer unprovisioned).
4. Deploy current code to the **staging project explicitly** and test actual
   provider paths: partial Ask payments, Connect recipient, fund single/monthly,
   owned cancellation, both paid tiers, upgrades/downgrades/resume/undo, clock
   renewals, refunds/disputes, declines/3DS/async and interrupted recovery.
   Assert ledger/coverage/provider truth, not just successful UI redirects.
5. Diagnose measured model performance safely, then autonomous 10 -> 25 -> 100
   ramp and one-hour soak with real sandbox-paid tiers, at least three action
   cycles per agent, real-time dashboard freshness and history checks.
6. Bootstrap Ian's real admin/MFA, finish legal/eligibility/tax and deployment
   prerequisites. Processing-fee estimates (currently 2.9% + $0.30) are estimates,
   not a verified live agreement. Live Stripe approval remains a separate gate.
7. Review production backup/additive migration/rollback and compatibility plan,
   then deploy and verify only what has actually passed. Do not enable live-money
   gates merely because sandbox tests pass. Preserve signed commits.
8. Finish the final published all-view/modal PDF and tagged capability outline.
   `output/pdf/givetogive-payments-staging-walkthrough.pdf` is a **partial staging**
   artifact, not proof the goal or final production walkthrough is complete.

The unrelated Call plugin prompting fix was published as version 1.0.8 in the
separate Personal Call Concierge project. Do not mix that repo's uncommitted
changes or any phone/calendar actions into this checkpoint.
