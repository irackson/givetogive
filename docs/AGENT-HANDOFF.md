# Resume here: payments and simulation checkpoint

**October 1 revision:** Ian authorized continuing with a persistent scripted
community (250 users) alongside three browser agents initially, configurable up
to 30. All member actions use the existing UI APIs and independent normal auth
sessions. This replaces the 100-model-agent completion requirement. Read the
updated simulation section in the implementation contract before resuming older
model/ramp work below; historical measurements remain evidence, not new requirements.

## October 2 resumed-goal checkpoint — supersedes old local test counts

### October 3 active-goal checkpoint — supersedes paused/live handles below

**Published dark release:** signed verified commit `ff131b6fd79f833753305ebe4fd79d0c6d4f56ec`
was pushed to `main`. READY production deployment
`dpl_7qTLBG19hfWoRxHABZp4i3mtdjHn` owns `givetogive.vercel.app`, Node 24.x.
Local and remote have only `main`. Actual runtime checks at 18:44 UTC confirm
payments/subscriptions/funds disabled and all three unsigned callbacks rejected
with signature-required HTTP 400. One-browser anonymous production smoke passed
17 route/state checks, with zero browser/console errors; browser closed.
Runtime log review at 18:48 UTC found zero error/fatal/HTTP 5xx records since
18:44 UTC. Evidence: `tmp/production-dark-release-probe.json`,
`tmp/production-release-smoke/evidence.json`, `tmp/production-log-probe.json`.
No production synthetic members, paid transactions or live gates were enabled.
Authenticated production login, external OAuth/email delivery, Ian's selected
verified administrator identity/MFA, and genuine paid Checkout acceptance remain
separate unfinished checks. The pre-deployment notes below are historical.

Ian explicitly resumed the goal and authorized subagents. The goal is active;
the October 2 pause instructions and running-process handles below are historical.
Do not restart session 19295/PID 29288: both are gone. The replacement run
`a90697e2-be08-42a4-b88c-f2f176fbed0a` failed the hour criterion: its least-active
post-warmup coverage was **3,509 seconds**, not 3,600. Preserve this failed history.
It retained 39,591 successes and 290 authoritative rejections across 253 members.

Actual admin recovery, control-only checkpoint and terminal cleanup now leave
that run **stopped/offline/unowned**, with zero pending mutations, unsent
telemetry, local account claims or live recorded controllers. The control-only
Stop was applied October 3 at 17:48:43 UTC; no member actions were restarted.
All 39,881 historical action rows and journal identities are unchanged, verified
by matching before/after fingerprints. New guarded runner `checkpoint`/`cleanup`
commands and regressions address the previously stranded offline Stop request.
Evidence: `tmp/community-stage/recovery-a90697e2-be08-42a4-b88c-f2f176fbed0a.json`.

The Development publishable test key is now loaded by actual READY staging
deployment `dpl_Dfsfv6kFCS6dQQHw16EoFv1gFNmo`, source digest
`c04e7dd2560d50b9e8653853401e8952757dfcda4c018b1d9c51b1c91b14efb0`.
The explicit protected staging project remains `prj_HvlFV1kKHVsML73nlsJAFQNA7grP`;
only its test Supporter gate is enabled. Public production and live/Ask/fund gates
remain unchanged. The CI sandbox's own matching test key pair is also configured.

Genuine **provider-only CI** Accounts-v2 test-clock fixtures paid two initial and
two renewal invoices (4,000 test cents total). Both subscriptions are canceled;
decline and authentication-required probes are terminal/canceled with zero
received cents. Independent October 3 18:00 UTC reads verify provider test mode,
exact sandbox, terminal objects and **zero app account/subscription/payment/
paid-coverage/ledger mappings** for these fixtures. This is not browser Checkout,
completed 3DS, hosted paid-webhook processing or member-tier acceptance. Existing
keys suffice for the remaining fresh manual test-card Checkout handoffs; do not
reuse expired or ambiguous old intents. Evidence: `tmp/stripe-test-acceptance-results.md`.

Latest actual checks: root units **118/118**, root types/lint pass; simulator
**70/70** and its types pass. Full integration rerun **121/121**, zero skipped.
Both guarded production-runtime builds and actual ordinary old→new→old browser
compatibility passed at 18:11 UTC. Evidence:
`tmp/release-compatibility-5e05c46b-63f6-4f5b-8842-5018a3749f72/evidence.json`.
Current runtime authored digest matches the root app; zero browser/console
errors and external provider requests, all fixtures removed, owned browser/server
processes stopped and listener clear. Next's multiple-lockfile workspace warning
was identified separately; it is not an auth/runtime failure. OAuth/email/payment
acceptance is still outside this rehearsal. Final isolated browser regression
passed: **36 passed, four intentional skips, zero failures/retries**. The skips
are two opt-in walkthrough captures and two explicitly staging-only probes.
Evidence: `tmp/release-final-e2e/summary-1791051419962.json`.

Production's additive migration actually passed at **18:37:36 UTC**: nineteen
migrations, ten legacy tables' data fingerprints preserved, unrelated schema
preserved and safe defaults for existing users. Fresh ready/no-compute backup
`br-aged-cherry-a4hn33kn` retains production at LSN `0/7C89E528`.
Evidence: `tmp/production-payments-migration.json`. All five payment/live/fund/
supporter/simulation gates remain disabled. No public code deployment yet.
Rollback means old app code with additive schema retained, not restoring the
entire shared database branch or rewriting migration history.

Fresh run `2ba5c5e4-f339-4b19-88a2-013c7ed447f1` is independently running under
tracked detached supervision: supervisor PID 28608, runner PID 29504 (verify
creation times/liveness before relying on these). All 253 members warmed up at
18:31:45.159 UTC. Its earliest possible hour acceptance is 19:31:45.159 UTC;
actual continuity, every-member windows and drained shutdown must still pass.
Journals: `tools/simulation/.state/community-soak253final1`; supervision and
launcher review: `.state/runs/<run-id>/`. Never duplicate this live run.

### October 2 explicit goal pause and authorized credential setup

Ian paused the goal to switch modes and explicitly authorized obtaining existing
Stripe test credentials using his signed-in CLI/browser while he is away.
`get_goal`/`update_goal` confirmed **paused**. Do not restart goal implementation,
deployments, or parallel goal workers until Ian resumes. The already-running
253-member soak is a separate process; do not duplicate or stop it merely because
the conversational goal is paused. Session **19295**, child PID **29288**, run
`a90697e2-be08-42a4-b88c-f2f176fbed0a` remain the handles to inspect on resumption.

Credential setup completed while paused: Development's existing public test key
was retrieved from the authenticated Dashboard and installed into
`.env.staging.local` and the exact protected staging project's sensitive variable
`STRIPE_PUBLISHABLE_KEY`; metadata verified both preview/production scopes on
**the staging project only**. No staging redeployment yet. Existing CI sandbox's
standard test secret was transferred through a one-shot loopback form directly
into `.env.ci.local`, with no secret value in chat, logs, command arguments or
tracked source. Independent provider account/balance reads verified the expected
CI account and test mode. Its matching publishable test key is also installed
in `.env.ci.local`. Other environment values and all gates preserved.
Temporary receiver processes exited; sensitive Dashboard pages closed. Neither
key was newly created or rotated. CLI credentials were not copied into app envs.
Least-privilege restricted-key acceptance remains open;
real paid Checkout/lifecycle coverage is not established by configuration alone.
Private operator helper: `tmp/stripe-key-receiver.mjs` (ignored, no embedded keys).

Additional **pre-pause** verification/prepared work, not full release acceptance:
the actual published production binding is READY deployment
`dpl_EJXLNDeTk3MxmQEpaKiW8Lj1rpUL`, source
`e2cd44d30fd62ab65a611aa1adbfdeba7f42afd5`, Node 24. An exact Git archive plus
its unchanged lockfile dependencies exists at `tmp/release-old-e2cd44d/`.
Actual old/new Drizzle/Auth.js adapter, database sessions, encrypted legacy JWT,
revocation/freeze, Ask/save/contribution data checks passed on the designated
private migration copy in an exclusive transaction, followed by verified
ROLLBACK. Evidence `tmp/app-data-compatibility-*.json`; helper
`tmp/rehearse-app-data-compatibility.mjs`. This does **not** verify browser login,
external OAuth or ordinary API flows yet.

New tracked rehearsal helpers `scripts/release-rehearsal-environment.ts` and
`scripts/run-release-rehearsal.mjs` bind only the exact private clone, remove
external credentials, disable sales/email/simulation, and require live identity,
full migration-history and build/source-fingerprint checks. The old snapshot's
**check** mode passed; neither old nor current snapshot was built or started.
Avoid heavy builds while child 29288 is alive. Five new environment tests and a
legacy JWT-policy regression bring root units to **117/117**; root lint and
typecheck passed. Root TypeScript/ESLint now exclude ignored `tmp/**` artifacts
because the exact old source copy otherwise polluted new source type checking;
normal app/tests/scripts checks remain enabled. Integration 121/121 and runner
59/59 are earlier verified counts, not newly rerun after these helper changes.
No commit, push, public-production DDL or deployment occurred at this checkpoint.

### October 2 14:15 UTC — replacement full-population run, supersedes live handle below

Run `6debd45f-3609-4f79-a28c-38c20083a4b7` is **stopped**, not hour acceptance.
At 14:02:56 UTC one scripted participant halted on an unavailable selection GET.
Independent SQLite review proved **no pending mutation**: no POST was admitted.
The old runner treated every unresolved read as an uncertain write. It was
stopped through the actual admin confirmation dialog and exited normally.
Terminal review: 21,596 successes, 174 HTTP-400 rejections, one read halt, every
participant ≥52 successes/20 successful mutations, 572 owned Asks and 4,424 owned
contributions independently verified. Zero pending intents/outbox/account claims,
zero live process and server owner released/offline. Least-active continuity was
1,386 seconds after warmup, **not** an hour. Preserve this failed run/journals.
Last steady-load freshness sample: 276 actions, maximum 4,574 ms, no browser errors.

Fix: the normal UI transport now distinguishes allowlisted observation GET
failures from uncertain POSTs. Only pre-intent observations get three bounded
one/two/four-second retries and fresh selection. POST retries explicitly remain
zero; an existing pending intent or generic/browser/auth fault never becomes
retryable. Three new policy/transport tests pass, including a failed read after
admission and secret-bearing raw diagnostics being withheld. Tools are now
**59/59 tests** in the complete rerun. Root units **111/111**, types and focused
lint pass. Isolated migration launch passed against the already-migrated CI DB;
the full integration suite under owned session **77266** finished **121/121**.
Root lint/typecheck/diff check also passed. Those two sessions are terminal.

Fresh UI-created run **`a90697e2-be08-42a4-b88c-f2f176fbed0a`** has 253 new
ordinary synthetic members, one run-control token, zero SQL Asks and zero paid
entitlements. Its immutable 1,115-line program passed hosted preflight. Owned
running session **19295**, child PID **29288**, 4,500 seconds, 250 script/three
browser users, four API slots/three browser slots. Private paths:
`tmp/community-stage/run-soak253retry1.json`, `.state/runs/<id>/` credentials and
program, `.state/community-soak253retry1/` journals; the `.state` directories are
under `tools/simulation/`. Supervised progress remains in
`tmp/community-stage/runner-a90697e2-be08-42a4-b88c-f2f176fbed0a.jsonl`.
Last hosted check: running/online, all 253 participants, minimum three cycles,
zero paused users. Do not restart a live process or infer hour proof from uptime.

Release tooling: `scripts/review-payment-migrations.ts` reads metadata only with
startup+transaction read-only, direct connection and bounded timeouts. It checks
the entire history prefix with `migration-history.ts`, explicit formatting-only
matches and exact SQL-chain digest; five regression tests pass. Existing isolated
migrations now reject mismatched history before Drizzle. Production contains ten
GiveToGive and **27 unrelated public tables**; protect other applications during
backup/rehearsal/recovery. No production writes or member-data reads. Staging/CI
each have all nineteen migrations; production still eleven. See migration review.
Neon project discovery was subsequently resolved through read-only Postgres
metadata; Ian need not supply the requested ID. Verified no-compute backup
`br-wild-credit-a4jo07ea` at LSN `0/71466740` and independent recovery/rehearsal
`br-dawn-lab-a4mm36bg` were created in project `muddy-truth-80467726`, never
connected to bots or deployed apps. The complete chain applied on the copy in
4,171 ms, retaining all ten legacy tables' aggregate data fingerprints, safe
member defaults, ten triggers and unrelated schema. Production readback remains
eleven migrations. Private helper/evidence in `tmp/rehearse-payments-migration.mjs`
and `tmp/payments-migration-rehearsal-*.json`. Old/new browser/auth compatibility
and actual rollout remain open. Rehearsal endpoint `ep-bitter-bread-a4uv2cgt`
was suspended after verification and provider readback reports **idle**; the
original production endpoint remains active. Preserve the backup and never
reset shared production.

Replacement-run warmup: **14:16:37.479 UTC**. Hour proof is impossible before
15:16:37.479 UTC and still requires actual continuity. At 14:27:18 UTC: 7,867
successes, 55 HTTP-400 rejections, minimum 25 successes/nine successful mutations
per user, 208 owned Asks/1,586 owned contributions, one live process and no
pending intents; ten unsent events are normal in-flight telemetry. Earlier
competing integration checks caused minimum recorded free RAM 0.656 GiB;
admission guard recovered, current headroom >4 GiB, no paused participants.
Freshness sample of 245 actions had maximum **5,714 ms**, missing the five-second
target; retain this failed sample. Later steady-load measurement **77417** is
terminal: 283 sampled actions, maximum **4,355 ms**, target met, no browser errors.
Both windows remain evidence; the later pass does not erase the earlier miss.
Runtime error/fatal and HTTP-5xx grouped queries for the verified deployment
returned no rows for the checked 13:35 UTC onward window. These are windowed
checks, not an unrestricted claim of zero errors forever.

At 14:31:45 UTC the replacement run was still owned/running/online: 10,718
successful actions, 75 failures (recorded authoritative rejections), minimum
35 resolved cycles per participant, zero paused participants and 3.12 GiB free
RAM. Session **19295** remains the live handle to poll; other test/measurement
sessions above are terminal. No further build/high-memory suite should compete
with this hour soak unless deliberate pressure verification is required.
Stripe publishable key/manual paid checkout and other financial gates remain
open. Main-only local/remote checked again; no commit/push/production deployment.

### October 2 full-population soak — live handle, do not duplicate

The 253-account run `6debd45f-3609-4f79-a28c-38c20083a4b7` was UI-created and
provisioned with 253 ordinary members, one run-control token, **zero SQL Asks**
and zero paid entitlements. Its immutable program has 1,115 lines. It is running
250 scripts and three browsers concurrently with four API slots and three
browser slots for 4,500 seconds. The owned terminal handle is **22338** and its
child PID is **19916**. Re-poll that handle and check authoritative hosted state;
do not restart on an observation timeout. No other ramp is running.

Private paths: `tmp/community-stage/run-soak253.json`,
`tools/simulation/.state/runs/<run-id>/credentials.json` and `activity.jsonl`,
and `tools/simulation/.state/community-soak253/` journals. The supervising helper
retains compact progress in `tmp/community-stage/runner-<run-id>.jsonl`.

At 13:42:35 UTC, independent journal/database review proved 3,074 successful
actions, every participant at least nine successes and four successful mutations,
104 owned Asks and 702 owned contributions. Twenty-seven authoritative HTTP-400
rejections were recorded, not invented successes. The run was running, owned and
had one live process covering all 253 local account claims. In-flight intents and
outbox rows are normal while running; verify zero outstanding at terminal.
Minimum recorded RAM headroom was 2.56 GiB. Three-success warmup completed at
**13:39:11.672 UTC**; an hour of continuous post-warmup participation cannot be
proved before 14:39:11.672 UTC. Do not infer it from uptime alone.

`tools/simulation/src/community-evidence.ts` measures the least recently active
participant, action gaps and per-participant five-minute windows. Three new tests
reject a dropped browser, long inactivity, duplicates/invalid success evidence.
The private review helper uses it and independently verifies database ownership.
First full-population dashboard measurement: 105 samples, maximum action-to-visible
4,002 ms, zero browser errors. Repeat under steady load and retain actual failures.

At 13:53:34 UTC: 10,285 successes, 90 recorded HTTP-400 rejections, no pending
mutations at that snapshot, fourteen queued telemetry events, minimum 32 successes
and eleven successful mutations per participant. Continuity covered 820 seconds
after warmup, two complete five-minute windows with at least nine successes per
participant/window, maximum successful-action gap 67.772 seconds. It is **not**
one-hour evidence yet. Second dashboard sample: 156 actions, maximum 4,803 ms,
zero browser errors. Latest hosted status query showed all 253 users online via
their one live controller with zero paused participants. A loaded dashboard
viewport screenshot is retained under `tmp/community-stage/screenshots/` for the
later final PDF; it is not the final all-payment-state walkthrough.

Completed ramps: 25 users (`ff42fef4-3900-42f4-9d84-82049ed1801b`) had 316 successes,
three rejections, minimum nine successes/user, clean terminal journals. The 100-user
run (`4e9668bd-f112-421f-8851-3e3baa2aa943`) had 1,184 successes, ten authoritative
HTTP-400 rejections and three browser halts **before any POST**. It exposed a stale
target race, so it is not clean browser-soak acceptance. All those runs are terminal.

Fixed runner bugs: pre-admission API-confirmed target changes now wait rather than
halt; post-admission ambiguity still never replays. Stream decoding uses the UI's
request negotiation, not response content type. The single UI mutation response is
captured before forwarding because Chromium discarded streamed responses during
success navigation; forwarding explicitly disables retries and redirects. Real
hosted regression passed after the fix, including actual HTTP-200 JSONL rejection
with no extra contribution, alongside full create/save/help/cancel/complete and
stale-target no-POST cases. Tools tests **56/56**, tools/root types, focused tools
lint and root lint, root unit **106/106** passed this turn. No source deploy needed
for these runner-only changes; staging digest remains pinned below.

Read-only financial review now proves all three prepared sessions expired, each
with a processed signed expiry event. There are still zero settlement ledger rows
and zero paid coverage. Never replay the expired success operation IDs or call
expiry a successful payment. Private financial harness deployment pins were updated
to the verified canonical deployment; read-only reconciliation confirmed the expired
unpaid outcome. Manual test Checkout/provider setup remains open.

Production metadata review found migrations 0011–0018 pending. The first three
historical checksum differences match only LF/CRLF variation; preserve history.
No member data read or production writes. See `payments-migration-review.md`.
Main is still the only local/remote branch; no commit or push this turn. Goal active.

### October 2 earlier acceptance and cloud-development correction

The goal was resumed after a model-capacity failure; it is active and incomplete.
Codex Cloud is an alternative **development** machine, not inherently CI. Ian
copied CI values following the earlier Cloud setup advice. Laptop, Cloud and
hosted staging may use the same Development Stripe sandbox with matching
account/catalog settings. The separately provisioned CI sandbox is reserved for
automated integration tests (for example future GitHub Actions); no Actions
workflow exists yet. Do not require a CI Stripe key just to develop in Cloud.
`docs/codex-cloud.md` distinguishes development and destructive integration-test
targets. The actual published Cloud configuration has not been inspected here.

- Staging supporters are enabled in **test mode only**. Ask payments, fund sales
  and live approval remain off. Public production remains unchanged.
- Latest protected, canonical staging deployment is
  `dpl_FPAK7fz4U6FdUaV9Uui9J6V4CkNR`, READY, source digest
  `2ba0af171eae9cd525a0fb7b1aa9b420e842578c6946198ea1609a0935686543`.
  Actual terminal-run query proves completed/offline/owner released; the brief
  completed-but-online presentation bug is fixed and unit-tested.
- Financial cohort `8015ff1e-65c0-4bb0-9d00-94d776951603` has ten synthetic
  normal-auth members, no SQL activity or paid entitlements. Three genuine test
  Checkout Sessions were prepared through ordinary `billing.createCheckout`.
  Durable SQLite intents/budgets precede those mutations. One browser attempt
  remains ambiguous and must never be replayed automatically. Stripe's agent
  panel blocked ordinary test-card entry; its Link token route does not support
  test mode. No real card, consumer-wallet authorization or bypass was used.
  A manual sandbox-only checkout may be needed; paid tiers remain unverified.
- Actual unpaid abandonment plus normal-member `billing.cancelCheckout` expired
  both the provider session and app reservation, retaining Neighbor status.
  Genuine signed snapshot event `evt_1UM1BxDed7vKVapt4DRTHhHG`
  (`checkout.session.expired`) was processed once, with hosted POST 200. This
  proves expiry delivery/processing, not successful payment/subscription coverage.
- Corrected mixed run `d0d7ca5f-e79e-4eb4-9c6b-2791c6554909` completed 240 seconds:
  137 successful actions, zero failures, every member at least twelve successes.
  Seven scripts and three browsers interacted with each other's real Asks.
  Independent journals have zero pending intents/outbox rows/controller claims;
  the process exited normally. Never restart this terminal run.
- Latest full checks: root unit 106/106, simulator 50/50, isolated PostgreSQL
  integration 121/121, root/tools types, root lint and guarded staging build
  passed. No paid-tier cohort, 253-user/hour soak or production release is proved.

Private helpers retain financial operation IDs, journals and account credentials.
Financial helper deployment pins must match the newest canonical deployment
before any further use. Never delete an ambiguity journal or reuse an account
under a second controller. Next: population ramp, mixed one-hour soak and measured
dashboard freshness; continue genuine sandbox financial lifecycle acceptance,
Connect/funds, release prerequisites, compatible production rollout and final PDF.

### October 2 secure Stripe setup and Stop acceptance — latest

The goal is **active**, not complete. Previous setup/verification statements below
are historical; this section supersedes their missing-credential and Stop status.

- Ian reported rotating the exposed Development key. The newly entered test key
  was independently verified against `acct_1UKPU8Ded7vKVapt` and test-mode balance.
  With his approval, it was moved from `.env.ci.local` to `.env.staging.local`;
  the mismatched CI entry was removed. Never print the key or reopen its exposed
  Dashboard page. The Stripe tab was closed at his request.
- CI remains a separate sandbox (`acct_1UKPVfD0WEho6xH0`) **without its app key**.
  Ian also pasted the earlier CI file into a publishing Codex cloud environment.
  Local correction did not correct that cloud copy. Ian subsequently clarified
  that Cloud is development, so it should use a coherent Development configuration,
  not be required to obtain the CI sandbox key. See the newer checkpoint above.
- Connect is enabled in both sandboxes. Development has three separate event
  destinations: platform snapshot `we_1UM01HDed7vKVaptu26kYTD2`, connected snapshot
  `we_1UM01KDed7vKVaptWR6tyEFT`, and connected thin
  `ed_test_61VVNyh5cIavIVai216VTnRURDSQMXRI4tnmHvOuWPua`.
  They were created disabled, then enabled only after the matching staging build
  and hosted configuration were verified. URLs contain a private protection bypass;
  never print full URLs, signing secrets, registry contents or provider responses.
- Nine Development settings (app key, account, two prices, two portal IDs, three
  signing secrets) are installed as sensitive variables on the **separate staging
  project**. Local staging signing secrets are installed too. Publishable key is
  still absent; embedded Connect onboarding requires it. The current key is a
  standard test secret, not a least-privilege restricted key; that acceptance is
  outstanding. Live approval and all new-sale gates remain **false**.
- Latest canonical staging deployment: `dpl_2ZdZR1kPBH5QR2sd6ccK4ggzyAF8`, READY,
  source digest `fa4bd77dba117bb6599d58e53e65345e836fc42dd4b2f66d127ba3055d39d67b`.
  Canonical alias was independently verified to point to that deployment/project.
  Hosted availability reports staging/test, configured billing management and
  sales disabled. All three routes return 400 for unsigned requests. A real Stripe
  thin-destination ping produced `/api/stripe/events` POST 200 in hosting logs.
  Stripe does not support that ping for snapshot destinations: real owned events
  must verify those. This is **not** payment lifecycle or durable-workflow proof.
- Added `/api/stripe/connect` with its own signing secret/account boundary and
  fixed recognition of Accounts v2 bracketed account-readiness events. Snapshot
  destinations cannot combine `@self` and `@accounts`, hence the separate routes.
- Fresh browser-created run `cb87c897-1579-4510-98ff-f0c848abb81f` (7 scripts + 3
  browsers) is **stopped** after actual UI Stop. Individual pause held agent
  `bot_e54a26cd5041424b_006` at 13 cycles while others progressed; actual individual
  Resume advanced it to 18. Hosted terminal metrics retained 132 successful
  actions and 3 browser-driver failures. Journals independently have 132 successes,
  zero pending intents/telemetry, zero controller rows/live processes. Do not
  restart this terminal run. Journals: `tools/simulation/.state/community-stop-acceptance/`.
- This run exposed duplicate-title selection in browser Save. All three browser
  actors safely halted; their failures must not be counted as population acceptance.
  The driver now locates the exact canonical Ask link and waits for the card.
  Updated real hosted mixed-account regression deliberately creates two equal
  titles and verifies only the intended Ask is saved: passed twice, latest
  **1/1 in 25.8s** after the diagnostic privacy wrapper.
  Raw Playwright diagnostics are now replaced with phase-only errors in public
  runner output; console/page errors still fail actions. Fresh full-run acceptance
  of the corrected driver remains required.
- Normal-cookie financial UI procedures were added to the explicit member-client
  allowlist. Two new contract tests prohibit admin/MCP shortcuts and verify router
  method matching. Legacy `sandbox-cli.ts` still uses MCP; **do not use it for the
  revised community's member payment actions**. Adapt the financial harness to
  normal UI auth with durable budgets and independent provider/ledger evidence.
- Latest results: focused webhook 12/12, root unit 105/105, simulator 45/45,
  simulator types and focused lint passed; full isolated integration 121/121 and
  root build passed at the immediately preceding webhook checkpoint. Final root
  TypeScript/lint and updated hosted regression passed after the driver edits.
  Tracked whitespace validation passed. Rerun relevant checks after further edits.
- No production migration, production deployment, commit or push occurred here.
  Current local HEAD is inherited `543e135` (Codex Cloud setup documentation),
  following `56bf5a8`; actual remote main remains `e2cd44d`. Only main was found
  locally and by a fresh remote branch listing. Preserve that documentation commit.

Private helpers: `tmp/stripe-secure-setup.mjs` (`install` is reconciliation-safe but
requires destinations disabled; do not rerun blindly now), `tmp/stage-delivery-probe.mjs`
(pins latest deployment/digest; setup requires sales off), `tmp/stage-log-review.mjs`
(captures logs and prints path/status only), `tmp/community-stop-journal.mjs`, and
the existing admin browser helper with `SIM_ACCEPTANCE_RUN_FILE` set to
`tmp/community-stage/run-stop.json`. They are ignored. Private setup registry is
`.stripe/secure-setup.json`, excluded from Git **and** deployment uploads.

Next: prepare a fresh financial cohort and durable normal-UI Checkout harness,
enable **staging-only** sales progressively, then verify real Checkout, signed
snapshot inbox/workflow, paid coverage, both tiers, Connect/funds and the entire
lifecycle matrix. Finish CI/publishable/RAK credentials through secure entry;
population ramp/one-hour soak, production compatibility/migrations/release and
final published PDF remain outstanding. Do not mark the goal complete.

### Latest hosted follow-up — read before the older checkpoint below

The subsequent explicit goal continuation authorized implementation after Ian's
planning-only turn. Latest evidence is in the top follow-up section of
`docs/payments-verification.md`. Dashboard labels/history navigation and reactive
completion/cancellation were finished; a shutdown metrics-loss bug was fixed.
Root unit 105/105, tool tests 43/43, full isolated integration 119/119, guarded
build/types/lint passed; hosted UI suite 10/10 and updated reactive mixed test 1/1.

The 10-account hosted run `9213f7ea-3bd2-413f-9dec-b65f48412f6d` is **completed**,
with no controller owner or live recorded PID; all 614 events delivered, zero
pending mutations. Its journals are retained at
`tools/simulation/.state/community-acceptance/`. It cannot restart; create a new
run for the next probe. Actual crash recovery, restart-while-paused, UI resume,
UI pause, concurrency and pace were verified. Manual UI stop, per-user controls,
full freshness SLA, 253-user ramp, 30-browser limits and hourly soak remain open.

Latest staging deployment is `dpl_B71MMtrc1ZJh1D7E93miobmgFSiG`, **READY**, after
dashboard checkpoint `dpl_F9fvcWsN4yRZvUuR67DPoMA7Q78H`. Fresh hosted terminal
metric retention remains outstanding. Explicit isolated staging project only. Do not push main:
the public production database is still incompatible with these migrations.
No new commit/push/production change was made. Only main exists locally/remotely.

Private helpers: `tmp/community-stage-admin.mjs` (normal synthetic admin login,
host-only bypass, browser controls, identity-verified private cookie reuse),
`tmp/community-state-review.mjs` (guarded read-only stage/journal reconciliation),
`tmp/deploy-verified-staging.mjs` (explicit project/privacy preflight and deployment
ID inspection), `tmp/stripe-auth-status.mjs` (whitelisted identity output only).
They are ignored and may be absent on another checkout. Repeated harness sign-ins
hit the genuine admin limit; don't weaken it, clear its DB record or use another
identity to evade it. Wait for expiry and reuse an ordinary verified session.

Stripe CLI current selected identity was freshly verified as GiveToGive
Development. Application Stripe API keys and webhook secrets remain absent in
stage/CI. Ian asked whether authorization is needed: explain that connector/CLI
login is separate from app credentials; he handles password/MFA and secure key
entry, and the previously exposed Development test key must be rotated first.
Do not copy CLI-managed credentials, expose secret values or use live context.

Next: verify the metrics-fix deployment, fresh-run manual Stop and individual
controls, live dashboard freshness and terminal metric retention; then population
ramp/soak. Generate recurring lifecycle actions only for a fresh immutable run.
Finish secure Stripe/provider setup in parallel when Ian completes those steps.

The goal service reports **active**. Ian clarified the preceding conversational
turn was planning-only; this follow-up work proceeded on the subsequent explicit
goal continuation. Revised simulator work
is local and uncommitted; it is not yet deployed or population-accepted.

- Added a normal-cookie UI API client and real browser action driver, ongoing
  JSONL scheduler/generator, exact cross-user references and SQLite intent/outcome
  journal. Each account has one local controller within the shared state directory.
- New mode is `scripted`: default 253 accounts (250 script + 3 browser), maximum
  280 total and 30 browsers. API and browser concurrency are separate. Legacy
  model/MCP modes retain their 100-account/two-inference limits and explicit
  `legacy:start` / `legacy:preflight` commands.
- Provisioning creates accounts/metadata only in this mode: zero SQL Ask activity,
  zero paid entitlement grants, and no member MCP token records. Generated actions
  create activity through normal member APIs. Target-tier browser selection spans
  the declared cohorts but does not grant paid recognition.
- Server preflight now attests exact run, population, browser count, cohort IDs,
  staging origin/database identity and test/unconfigured Stripe. **The older
  hosted staging deployment cannot yet satisfy this new contract.**
- Admin run creation and queued controls expose the revised mode. Durable local
  telemetry feeds existing simulation history; hosted freshness/control behavior
  has not yet been exercised for this runner. Pending mutations do not auto-replay,
  halted ambiguous actors cannot resume from a control command, and local terminal
  metadata prevents restarting after a lost final telemetry acknowledgement.
- Real isolated CI browser/API test passed: browser owner creates an Ask; a normal
  authenticated script discovers it and pledges; another browser saves/pledges/
  cancels; owner completes the script's exact pledge. Console/page errors fail
  browser actions. Fixed required-field exact-label mismatch and the browse `q`
  query parameter. No fake server caller or member MCP transport used.
- Verification: root unit **102/102**, simulator **40/40**, isolated CI integration
  **118/118**, full CI browser **36 passed / 4 explicit environment/capture skips**,
  root and simulator typecheck, root lint, focused simulator `eslint --no-ignore`,
  staging build, and tracked `git diff --check` passed. Browser probes showed
  meaningful home UI, no framework overlay and no console/page errors.
- Owned CI server at port 3100 was identity-checked and stopped after tests; no
  simulator population/model process started. Main remains the only local/remote
  branch. No production migration/deployment/push was performed.
- Staging and CI application Stripe API key + webhook secret presence rechecked:
  **both absent**, live approval false. A nonblocking secure-setup request was sent
  to Ian. Never paste keys or reuse the previously exposed Development test secret.

### Next actions, not completion claims

1. Continue the new runner's full lifecycle/admission review. Server-side controller
   fencing and a staging-admin recovery dialog/API are now implemented locally:
   one durable owner, action/telemetry journal binding, overlapping-cohort locks,
   no timeout takeover, released-owner duplicate acknowledgements only. Full CI
   integration passed 119/119 including recovery; focused simulation file 9/9,
   simulator 40/40, focused mixed-community/payment/admin browser files 9 passed
   with one staging-only skip, both types and lint clean, updated staging build
   passed. Home visual check had meaningful content/no overlay/browser errors.
   Owned CI server at 3100 was stopped after tests.
   **Protected staging recovery UI/lifecycle is not yet accepted.**
   Current account claims cover both shared local state and a durable server owner;
   crashes with ambiguous intents or undelivered history retain that owner.
   Test interruption/restart
   on real normal-auth actions. Resolve unknown mutation outcomes with authoritative evidence; never
   clear a pending intent solely because the controller timed out. Preserve both
   journals. The recovery dialog requires operator confirmation that the prior
   process stopped and pending actions were reviewed; two minutes without contact
   and exact owner identity are enforced server-side. It leaves the run paused,
   cannot independently prove process death, and never resolves member intents.
2. Deploy this verified application checkpoint to **protected staging**, using
   its separate project and existing isolated DB. Do not push main to trigger the
   production project. Verify the new manifest and admin creation/control views.
3. Create/provision a fresh scripted run; prove actual controller telemetry,
   pause/resume/stop, queued browser admission and dashboard history/freshness.
   Then ramp to 250 scripts + 3 browsers and the hour-long soak; measure capacity
   before claiming 30 concurrent browsers run safely on this laptop.
4. Extend activity scenarios to recurring contribution lifecycle and remaining
   profile/all-type/financial interactions. The generator currently performs Ask
   browsing/creation/nonfinancial contributions; exact programs additionally save,
   cancel and complete. This is not the full paid multi-tier community acceptance.
5. Continue the original real Stripe/provider/clock/financial QA, compatible
   production rollout and all-state PDF requirements below. Full goal remains open.

Read `docs/community-runner.md` for current commands and boundaries; the original
dated sections below retain historical evidence and the production release gate.

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
