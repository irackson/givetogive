# Resume here: payments and simulation checkpoint

## October 8 published checkpoint and genuinely fresh community preparation

Signed `12bb6e7051b292223449824075bef755de57aff7` passed hosted verification
`37808325159`. Exact Git staging deployment `dpl_5Qci3JLvJ5kLPKkv8GrdSMyzwfFb`
is READY and canonical at `https://givetogive-staging.vercel.app`. The deployment
contains the truthful email-capture status, missing-token guidance, and mobile
date-filter repair. Read-only receipt
`tmp/freshness-staging-release-inspection-1791476725427.json` verifies compiled
build/routes/no error markers, unchanged environment metadata during inspection,
staging protection `all`, Node24, normal admin reads and no active controllers.
Production root project link is unchanged. Runtime: sandbox subscriptions on,
Ask/fund gates off, no live payments. Authored Windows source digest:
`96402c8a2286a883196b53d52bac33540ef1fa3bb31b3e259e0debd10f3c0dae`.

Both new published browser regressions passed (missing-token/invalid-link
handling and editable/resettable mobile dates). Published 390x844 list/run/
populated individual-history inspection passed WITHOUT injected CSS; date widths
362px, no overflow and zero console/page/HTTP errors. Actual iPhone Safari and
Ian's owner-authenticated dashboard remain unverified. Receipt/screenshots:
`tmp/mobile-dashboard-inspection-1791476744798/`. All 142 root unit tests passed.

Fresh normal-admin-created run **`8b4d85f5-e07e-42f5-9402-3ffa866ff761`** is
prepared, NOT launched. Setup: `tmp/community-hour253-oct8-setup.mjs`; exclusive
creation intent/result: `tmp/community-stage/create-hour253-oct8.json` and
`tmp/community-stage/run-hour253-oct8.json`. Provisioning created 253 verified
synthetic member credentials plus ONE run-scoped runner token, zero member API
tokens, zero seeded Asks and zero paid grants. Desired tier labels are not paid
entitlements. Independent program preparation verified those conditions and
created 1,115 JSONL rules with run-specific Ask selection namespaces. Original
base/program files are under `.state/runs/<run-id>/`; never regenerate them.
Source/program-file SHA256:
`f88fbc7feda59860511083d5f6803deae3b6d8b807b863e56486243983bdb8ad`.
Setup SHA256: `5bb0f4d56f95df669c27f513582e51d8dea2ff6cce22cc4ed39112bc0e037a22`.
Seed/runner/lock digests match historical tested code, not historical activity.

NEXT: independently recheck fresh run/source bindings; create fresh empty action
and telemetry journals at `.state/community-hour253-oct8`, record canonical Git
runtime digest and actual program/journal provenance, then append ONE reviewed
record to the compiled approval registry without changing the original record.
Registry still contains only the historical approval: launch is NOT admitted.
Sign/test/push that approval, bind a separate five-member hosted rehearsal to
this release, verify it and only then launch the fresh 253-member hour with the
original continuity/freshness/history/drain requirements. No process is running
for this cohort, and no hour/paid acceptance is claimed. Preserve the retired
run and all original receipts. Staging real email delivery is still captured by
default; latest owner replacement was relayed once as described below.

## October 8 mobile date-filter repair

Scoped activity-filter controls now occupy full rows below 600px; the previous
130px flex minimum cramped native date text and the calendar control. Other
simulation filter groups and desktop layouts are unchanged. The actual protected
mobile history preview at 390x844 measured both date inputs at 362px, populated
recorded history, no horizontal overflow and zero console/page/HTTP errors. This
preview injected the authored stylesheet into the existing release: it is NOT
published-CSS acceptance. Receipt/screenshots:
`tmp/mobile-dashboard-inspection-1791476518498/`.
The browser regression verifies width, editable dates, reset, and overflow.
Release this signed checkpoint only after hosted checks, then rerun the mobile
inspection without `--preview-date-layout` and the focused browser regressions.

## October 8 AgentMail verification follow-up

Ian reported opening the delivered message reached the tokenless resend screen.
The exact iPhone/Vercel-protection transition has not been reproduced: a hosted
mobile Chromium request with a token keeps it and renders the verification view;
an invalid token gets the expected invalid/expired error, not another email.
The tokenless view now explains that a complete email link is required and that
verification needs only one link. A browser regression covers both states.

Reused two existing AgentMail inboxes; no new inboxes, paid plans, or provider
configuration changes. Registered isolated staging fixtures using the real UI.
Read encrypted capture links locally and relayed them through the existing Gmail
OAuth sender. AgentMail confirmed receipt of registration and replacement-link
messages; SHA-256 comparisons confirmed the received URLs exactly matched the
captured URLs without printing tokens. Following those links through mobile
Chromium verified both fixtures; normal password authentication reached `/asks`
with genuine sessions. Verification never bypassed the normal API or directly
changed account verification in SQL. Registration initially hit test-harness
label/hydration waits, corrected before the successful runs. Temporary helpers
and credential/link state are ignored under `tmp/`, not committed.

Important: this is controlled operator email relay, NOT evidence of automatic
hosted staging email delivery. Staging still captures all emails by default.
Owner dashboard access still needs Ian to complete verification himself; don't
claim an authenticated owner dashboard test from synthetic fixture success.

At 16:17:35 UTC, relayed Ian's replacement captured link (sink entry 35) once,
using an HTML verification button like the successfully tested AgentMail mail.
Gmail accepted it with HTTP 200; inbox receipt/click by Ian is not yet confirmed.
Expiry: October 9 16:02:54 UTC. This supersedes the earlier entry-33 message below
because Ian requested a replacement after that send. No database writes or
credential copies. The exact token's durable intent prevents duplicate sends.

## October 8 owner staging email repair

Ian registered `inasusr@gmail.com` in staging and reported no verification email,
including after resend. Root cause is intentional isolation: `sendAuthEmail`
stores an encrypted link in `givetogive_email_sink` for staging/test and makes
no provider call. It incorrectly returned `delivered: true`; the signup/resend
messages therefore implied inbox delivery. Staging has no Gmail/Resend provider
credentials, while the pre-existing local Gmail sender is configured.

At 16:00:28 UTC the reviewed fixed-recipient local operator sent **one** ordinary
verification message to Ian using the existing local Gmail OAuth connection.
OAuth and Gmail send both returned 200, with a provider message ID. This is
provider acceptance, **not confirmed inbox delivery**. The encrypted latest sink
entry 33 matched the current unexpired auth-token hash for Ian's exact active,
non-synthetic/unverified staging identity. Link expiry: October 9 15:54:50 UTC.
No link/token/credential was printed or committed, no credentials were copied
to Vercel/staging, and zero database writes/verification bypasses occurred.
Ian still must click the delivered link. Do not rerun the exclusive send for
this token: its durable intent and result are retained privately in
`tmp/owner-staging-email-delivery/`. Default operator is read-only.

The source fix distinguishes encrypted capture from actual email delivery,
shows explicit test-inbox guidance at signup and resend, and makes public reset/
resend wording environment-only so nonexistent/verified accounts aren't exposed.
Test capture still performs zero provider requests and exposes no preview links.
142 unit tests passed; new isolated SQL capture/encryption/no-network integration
test passed. All existing 123 integration checks passed separately with zero
skips/failures, and focused lint passed. Publish only after the source
checkpoint, hosted type checks/build and staging browser verification pass.
Ordinary automatic real email delivery on staging is **not** enabled by this
one-time local repair. Future owner sends need explicit, restricted operator
delivery or separately reviewed staging mail configuration; never bulk-email
simulated users or transfer production credentials to test runners.

## October 8 current staging release and mobile dashboard checkpoint

The exact remote Git deployment `dpl_EgBQ5axXnPxCJTEvzrkfr774yZqF` is READY,
from signed/tested commit `3da4c97fe21a3aa51f2ccbe51badb1a9e0fe5794`, and now
owns `givetogive-staging.vercel.app` (automatic alias assignment read back).
Read-only inspection at 15:49:55 UTC verified staging project/team, protection
`all`, Node 24, compiled build/route table/no error markers, normal synthetic
admin cookie authentication/private reads, no active controllers, and stopped
historical 253-member run. Runtime: staging/test Stripe, subscriptions enabled,
Ask/fund gates off, billing management enabled, configured publishable key
matches local without disclosure. Production root link remained unchanged.
Receipt: `tmp/current-staging-release-inspection-1791474595733.json`.

Actual Chromium 390x844 mobile/touch rendering passed simulation list, retained
run detail, and populated individual history (not just its loading state), with
zero console/page/HTTP errors, no page-wide horizontal overflow, no external
requests or browser mutations. Screenshots and receipt are in
`tmp/mobile-dashboard-inspection-1791474938096/`. This is **not** physical iPhone
Safari acceptance or a new hour soak. Visual review found the date filter
controls cramped; improve their mobile layout in the next UI pass and verify
the published CSS. The earlier screenshot-only receipt did not wait for the
activity feed; use the later populated-history receipt above.

Ian asked to view simulations on iPhone: use
`https://givetogive-staging.vercel.app/admin/simulations`, then project-authorized
Vercel login and separate GiveToGive staging login. Exact-owner SELECT-only
inspection found **zero** staging accounts for `inasusr@gmail.com`. Do not claim
his production credentials work here, copy password hashes, mark verified, or
share synthetic credentials. Ordinary staging registration and verification
remain user-owned; this does not block independent simulator work.

Hosted community provenance now supports append-only **reviewed release**
bindings rather than forcing every future run onto the failed historical
deployment. Original approval shape/position/values stay exact; origin/database
identity/name remain fixed; code/runner/seed/lock hashes are validated; a given
deployment ID cannot acquire conflicting source bindings; consumers select the
compiled registry and reject unknown/mixed release/run tuples. No env/file/test
fixture can add an operational approval. Local source verification now uses the
selected release's Windows versus canonical Git digest. Runtime registry still
contains **only the historical approval**: a genuinely fresh cohort, journals,
setup/source evidence, exact reviewed record and signed checkpoint are required
before launching a new full run. No simulation or payment was started.
All 260 local simulation/tool tests and simulation TypeScript passed; the 24
tests in the four pre-existing untracked Checkout files remain included in that
local total, not implied committed/hosted acceptance. Focused 44-test approval,
manifest and observer-parent regression suite passed as well.

## October 8 failed-community retirement — supersedes queued Stop 25 below

The separately reviewed continuation consumed existing Stop **25** successfully
at **15:32:44 UTC**, without enqueuing a new command or replaying activity.
Normal synthetic-admin API and isolated read-only SQL independently verified
the run `3275f37c-213f-48d8-a1e0-50ce35850559` is **stopped**, offline/unowned,
zero queued commands/workers/other controllers/financial records, all 253
participants idle, with 52 Asks and 385 contributions preserved. Original
journals and the prior failed attempt are byte-identical; only two drained
control events were added to a separate copy. Worker exited 0 and acknowledged
controller release. **Do not rerun either retirement helper.** This retires a
failed run; it does not turn it into one-hour acceptance.

Original receipt:
`tmp/hosted-community-retirement/3275f37c-213f-48d8-a1e0-50ce35850559-1791473561547-4cc56ac141c8/continuation-result.json`.
All 25 offline retirement/continuation/OS guard tests passed. One stale test
assumed no original intent could exist; it now checks that any existing intent
remains byte-identical rather than asking for evidence deletion.

Security cleanup: an overly broad diagnostic read surfaced a staging automation
protection token in tool output. Its value is not repeated here. The Vercel
connector denied token deletion (403); the existing authenticated CLI performed
the same explicitly scoped rotation successfully. Exact staging project
`prj_HvlFV1kKHVsML73nlsJAFQNA7grP`, team `team_TXid48wU77cfhEg28L3EyLpn`,
protection `all`, one replacement token, and old-token absence were read back.
Only the ignored current `tools/simulation/.state/protection.json` was updated;
historical recovery records are deliberately unchanged and their old token is
revoked. Access probes independently confirmed old token -> 302 Vercel login,
replacement token -> 200 JSON application session endpoint. Three Stripe test
destinations were repaired at 15:41:40 UTC using the existing staging test key:
platform snapshot, connected snapshot, and Accounts-v2 thin events. Exact
sandbox `acct_1UKPU8Ded7vKVapt`, test mode and staging paths were verified before
URL-only updates; independent readbacks prove events, versions and enabled
status unchanged. All three protected routes returned 400 JSON for deliberately
invalid signatures. Zero live writes/payment requests. Receipt:
`tmp/staging-protection-rotation/78dbe5e4c254a9b8ad620a71-result.json`.
Do not rerun the exclusive rotation operator; its default is read-only.
Stripe CLI is now 1.53.1 (existing login/config preserved). Preserve all other
credentials and deployment protection; do not weaken it.

Protected staging remote build dispatched from the already signed/tested Git
source `3da4c97fe21a3aa51f2ccbe51badb1a9e0fe5794` to staging project only:
`dpl_EgBQ5axXnPxCJTEvzrkfr774yZqF`. Initial provider state INITIALIZING.
Poll that exact deployment, verify runtime and normal synthetic-admin access,
then explicitly assign/verify the canonical staging alias if needed. Do not
reuse the old release inspection helper: its source/deployment hashes are
historical. Root `.vercel/project.json` still points at production and was not
modified; no environment updates, schema migrations or payment gates changed.

Next: prepare a genuinely new immutable full-community cohort/approval using
current reviewed code and deployment bindings. The historical full-run approval
registry still contains only the failed original run. Do not reuse its journals,
private draft, run UUID, account cohort or spent submission attempts.

## October 8 owner-access and verification checkpoint

Ian authorized continuing independent high-value implementation and test fixes,
and explicitly iceboxed his personal MFA enrollment. The goal controller first
reported paused, then was rechecked after the app resumed it and now reports
**active**. Preserve this existing goal; do not create a replacement.

Dashboard policy now allows only the verified, unfrozen `inasusr@gmail.com` real
account, evaluated from the current database rather than cookie role/email.
Normal synthetic admin accounts are allowed only in staging/test. No agent
backdoor, new credentials, or real-user role bootstrap was created. Financial
actions still require admin role and production step-up. Header and API/layout
authorization share the policy; revoked identities hide navigation without
swallowing infrastructure errors. Actual owner browser login is not yet tested.

Verification: 139 application unit tests, all 123 isolated integration tests and
258 simulation/offline tooling tests passed. An initial integration run caught
a frozen-user UNAUTHORIZED/FORBIDDEN regression; it was fixed and the complete
123-test suite rerun cleanly. Production-policy tests use the isolated CI database,
never production. A root TypeScript attempt with a bounded 768 MB heap ran out
of heap; laptop free RAM subsequently measured 1.13 GiB. No local build/browser
acceptance is claimed. The new read-only hosted verification workflow uses
public placeholders, no secret inputs, no database/provider access and no
deployment steps to remove this laptop bottleneck.

Signed and verified owner-policy commit `ea059e9` is pushed and deployed READY
on the canonical production alias (`dpl_AkCwwYQVYLzK95E8ARcSiKREAVAe`).
Credential-free GitHub verification run **37800451605** passed all application
and simulation type/unit checks. Public HTTP probes returned 200 for `/`,
`/asks`, `/signin`, signed-out `/admin` redirected to sign-in, and the admin API
returned 401. Payment availability retained production mode with Ask payments,
subscriptions and funds all disabled; no live payments were enabled. The
ten-minute runtime error query found no errors. Commit `175f0f9` adds hosted
public Chromium verification (no sign-in or writes); inspect run **37800990394**
which completed successfully. Actual Chromium rendered `/`, `/asks`, `/signin`
and the signed-out `/admin` redirect with zero console/page/HTTP errors. This is
public-route acceptance only, not owner login, paid Checkout or community soak.

Local main is the only local branch. Four fresh remote Dependabot branches/PRs
36–39 now propose SDK, sharp, source-map-js and Next updates. They contain
dependency changes, not product features. Review separately before final branch
cleanup; do not silently change dependencies during the access-policy release.

The previously "pending" actual credential-free CDP fixture is already verified:
GitHub run **37171683178**, attempt 1, completed successfully at source
`8a505bd897cd8afceddffaa518bc22b6b6b17d01`. Its retained original proof shows
actual Chromium/CDP, expected completed-query abort discrimination, genuine
partial-failure retention, no member sign-ins/external requests, and cleanup.
This is **not** authenticated history, one-hour community or paid acceptance.
Receipt: `tmp/hosted-community-operator/browser-8a505bd897cd8afceddffaa518bc22b6b6b17d01/cdp-review-1791081705539.json`.

Preserve the four pre-existing untracked hosted-Checkout adapter/transport files;
their offline tests pass but they are not approved runtime acceptance. Preserve
the failed full-community run and existing queued Stop 25: do not replay member
actions, reset history, rerun its retirement helper, or enqueue another Stop.
Reconcile that existing control separately before fresh community acceptance.

**October 1 revision:** Ian authorized continuing with a persistent scripted
community (250 users) alongside three browser agents initially, configurable up
to 30. All member actions use the existing UI APIs and independent normal auth
sessions. This replaces the 100-model-agent completion requirement. Read the
updated simulation section in the implementation contract before resuming older
model/ramp work below; historical measurements remain evidence, not new requirements.

## October 2 resumed-goal checkpoint — supersedes old local test counts

### October 3 active-goal checkpoint — supersedes paused/live handles below

**October 4, 02:24 UTC retirement attempt (supersedes queued-zero below):**
root reviewed the control-only helper and passed its 15 offline regression tests,
then invoked it once. Ordinary synthetic-admin Stop **25** was queued at
02:23:41 UTC. The isolated child exited 1, with zero stderr, before writing its
worker intent or acquiring ownership. The global exclusive intent and original
files remain preserved. **Do not rerun the helper or enqueue another Stop.**
Investigate its pre-intent guard read-only, reconcile the existing command and
actual controller state, then separately review any control-only continuation.
No member replay, financial request, history reset or acceptance is authorized
by this failed retirement. Operational directory:
`tmp/hosted-community-retirement/3275f37c-213f-48d8-a1e0-50ce35850559-1791080621477-135f10b545f6`.

The repaired observer now retains raw requests as well as strictly proven
completed-query cancellations. The credential-free Chromium fixture must prove
one completed-response abort and retain one genuine truncated-response failure,
under the exact sanitized child environment. **Actual Chromium execution is
still pending.** Root's complete simulation suite passed **228/228**, with no
skips; tools TypeScript passed. Checkout policy/protocol's **24/24** offline
tests passed, but an executable hosted Checkout adapter and paid settlement
remain unfinished. These tool changes do not change the deployed application,
schema, lockfiles or eight core-runner fingerprints. The goal remains active.

**02:33 UTC diagnosis:** a credential-free inert IPC probe reproduced exactly
eight Windows system defaults added by Node 24.19.0/libuv 1.52.1. Strict removal
of only those observed defaults before the frozen worker import passes the
original environment guard; unknown/case-changed/secret keys still fail closed.
Input, original copied bytes, SELECT-only journals and current runner manifest
verify. Stop 25 remains the only admitted command; a new, separately reviewed
continuation must consume that command, never enqueue another. The historical
full-run approval now has an immutable exact-tuple selector; no new UUID is
approved by that architectural change. Simulation suite **234/234** passes.

**October 4, 01:43 UTC — current hosted-test state:** signed `7f0b1205`
is published READY at `dpl_7bkFWYECxNZqSE7pnWfBhgb5dZM4`; production remains
dark, Node 24, with unchanged application/lock/environment bindings. Its
credential-free run `37167396403` and authenticated run `37167670642` passed.
Sixth five-member cohort `2ae6c4bd-9b48-428f-86cd-a493b1fe7bd7` completed 95
successes and 12 waits, with no rejected or ambiguous outcomes. Independent
isolated SQL and normal-admin API review verified 10 Asks, 23 contributions,
both cross-driver directions, clean completed/offline/unowned shutdown, and
zero financial records. Minimum participation: 17 successes and nine actual
mutation intents. Original ownership receipt ends `1791077778718.json`.

The previously untouched 253-member cohort **has now run and failed**, not
passed or remained unlaunched. Exact run `3275f37c-213f-48d8-a1e0-50ce35850559`,
GitHub run `37168575277`, job `111336643641`, private draft `402773012`.
All 253 passed warmup; original journals retained 2,090 successes, 783 waits,
13 rejections, zero ambiguous outcomes, and only 88 continuous post-warmup
seconds. The full-population dashboard window genuinely measured 665/665
actions within 2,043 ms, but the observer failed in individual history.
Its recorded request/body/console diagnostics remain failures to investigate,
not waived. Browser/API closure is confirmed; local pending/outbox/claims are
zero. Independent 01:56 UTC isolated SELECT review additionally verified
52 Asks and 385 contributions against original journal entities, including
16 API-to-browser and three browser-to-API contributions. All 253 are idle;
the failed run is paused/offline with acknowledged controller release, zero
active/queued workers, commands, financial records or other active controllers.
It is not completed. Receipt: `tmp/community-stage/hosted-full-failure-review-3275f37c-213f-48d8-a1e0-50ce35850559-1791078965692.json`.
Use a reviewed normal-admin Stop and control-only checkpoint to retire this
already-released paused run; never fabricate a server recovery acknowledgment.

Original recovery is preserved at
`tmp/hosted-community-recovered/3275f37c-213f-48d8-a1e0-50ce35850559-20261004T014308Z-10bce781f0db`.
Original pack proofs are readiness `1791077922556.json` and release
`1791077905946.json`. Preserve its private assets, program, journals, and
historical receipts: **do not reset, reseed, resume or rerun this failed history**.
Next: independently review failed-state cleanup, repair and test exact creator
prefetch/JSONL transport/history observation, then explicitly prepare a new
reviewed cohort after confirming no live controller. No one-hour, paid-tier,
financial-lifecycle or final-PDF acceptance is claimed. The goal remains active.

**October 4, 00:58 UTC follow-up:** signed `754aa09d` is published READY at `dpl_23N6VRDAdbSBZvB5Nkv83qhkofFN`; canonical production, Node 24 and all five gates off remain verified. Credential-free hosted run `37166015279` and authenticated run `37166109716` passed. Fifth cohort `8aff9046-0977-47ce-bf69-19ba8d2950dd`: 90 successes/17 waits, no rejected/ambiguous/backoff outcomes; minimum 16 successes/nine actual mutation intents. Original recovery and independent isolated SQL/normal-admin API review verify 10 nonmonetary Asks, 21 contributions, eight API-to-browser and ten browser-to-API interactions, clean completed/offline/unowned termination, zero pending work/workers and zero financial records. Private recovery: `tmp/hosted-community-recovered/8aff9046-0977-47ce-bf69-19ba8d2950dd-20261004T005709Z-37efe7dbd2f0`; ownership receipt ends `1791075499961.json`. A public multi-MiB full-scale fixture exposed Base64-regex stack overflow; bounded canonical decoding repairs it with unchanged transport/file limits. Simulation suite 169/169, full-hour recovery fixtures 24/24 and independent full ownership fixtures 17/17 pass. The prepared 253-member run is still untouched/unlaunched. Preserve original fifth receipts and journals; publish the minimal decoder repair and obtain fresh same-commit hosted smoke before full dispatch. Full-run capacity audit, actual hour/dashboard proof, paid Stripe lifecycles and fresh final PDF remain pending. The goal is active; no hour/paid/full completion is claimed.

**October 4, 00:43 UTC follow-up:** signed `a892df81` is published and both hosted runs passed: credential-free `37164919849`, authenticated `37165056980`. The fourth five-member cohort `550327d4-3e5f-4638-961a-f2a75b25787a` completed with 95 successes, 12 waits, no rejected/ambiguous/backoff results, and at least 17 successes/nine actual mutation intents per member. Original recovery and independent isolated SQL/normal-admin API review verify 10 nonmonetary Asks, 23 contributions, eight API-to-browser and ten browser-to-API interactions; completed/offline/unowned, no remaining workers or pending work, and zero financial records. Recovery: `tmp/hosted-community-recovered/550327d4-3e5f-4638-961a-f2a75b25787a-20261004T004223Z-3f83a884f532`; ownership receipt ends `1791074597212.json`. The separate full observer's Playwright filepath import was reproduced as exposing Chromium only through its CommonJS default; the minimal loader repair has a real installed-package regression test. All 167 simulation tests, strict tools TypeScript and zero-warning changed-file lint pass. Bind fresh hosted checks to the repaired signed commit before full-hour launch. The 253-member cohort is still untouched; Stripe lifecycle acceptance and the fresh final PDF remain unfinished. No hour or paid-tier pass is claimed.

**Reviewed hosted-observer implementation checkpoint:** 166/166 simulation tests and 28/28 private read-only recovery/ownership regression tests pass; strict tools TypeScript, explicit zero-warning lint on every changed tools file, and diff checks pass. The wrapper now separates worker exit from original receipt-backed browser/API closure, private stdin is bounded/cancellable and clears partial buffers, and the observer correctly decodes the site's negotiated JSONL query transport. No app/schema/core-runner/seed/lock changes or new runtime acceptance are implied. Sign/push this checkpoint, then bind a fresh credential-free and separate five-member rehearsal to that exact commit before full-hour admission. The fourth setup helper is prepared locally (`tmp/community-hosted-smoke-setup4.mjs`); its cohort has not yet been created. Do not reuse the completed third cohort or infer the new server-assigned UUID in advance.

**23:56 UTC hosted acceptance checkpoint — newest evidence:** signed `2c682123` credential-free run `37162207433` and authenticated run `37162614570` passed. Third five-member cohort `a76aa0a5-05ff-4959-9c05-123d87ab3c6f` finished naturally with 95 successes/12 waits/zero rejected, ambiguous or backoff results; minimum 17 successes and nine actual mutation intents per member. Original encrypted checkpoints 00/01/final were recovered and reconciled against restricted staging SQL plus normal synthetic-admin API: 10 Asks, 23 contributions, eight API-to-browser and ten browser-to-API contributions; completed/offline/unowned, zero workers/pending/outbox/claims and all eight financial counters zero. All five are Neighbor, not paid fixtures. Successful original recovery: `tmp/hosted-community-recovered/a76aa0a5-05ff-4959-9c05-123d87ab3c6f-20261003T235509Z-66ea68d2fe15`; ownership proof: `tmp/community-stage/hosted-smoke-owned-record-review-a76aa0a5-05ff-4959-9c05-123d87ab3c6f-1791071817004.json`. Failed local recovery directories remain preserved; fixes use Windows namespaced SQLite paths and recognize already-saved observation no-ops without counting them as actual mutations. No member phase was retried.

Actual production `2c682123` is READY at `dpl_DLmDhdQjdNFuycwLmHuZ84Lrda3a`, canonical, Node 24, all five gates off, unchanged authored source/lock/env metadata. Proof: `tmp/dark-production-publication-preflight-1791071064187.json`. Current new observer modules/wrapper are being reviewed/tested locally, not yet accepted at runtime. Finish independent integration review, signed source and fresh smoke binding, then implement reviewed full-hour dispatch and late synthetic-admin transfer/recovery before launching exact untouched `3275f37c-213f-48d8-a1e0-50ce35850559`. Do not reset/reseed/regenerate its 253-account program or journals. Paid Stripe lifecycles and final fresh PDF still remain; no financial/browser/PDF acceptance is inferred from this small smoke. The goal remains active.

**Hosted execution follow-up (supersedes the earlier preparation wording):**
the guarded workflow was signed/pushed as `d9c184ab`, and actual credential-free
cloud smoke `37160298140` passed. The new AES test secret is configured through
CLI stdin; its local key copy is CurrentUser-DPAPI protected. No Stripe, DB,
production or admin credentials were supplied to the community job.
Authenticated attempts `37160782200` and `37161630172` failed **before member
admission**, respectively during input wait and private materialization.
Preserve their original ignored receipts, private drafts and unused inputs.
The local operator now sends explicit binary Content-Length, and the tracked
wrapper normalizes its module root, handles ordinary read-only SQLite SHM
without permitting nonempty WAL, and emits only fixed safe failure phases.
Root reran all **109/109** simulation tests (zero skips) and tools TypeScript:
pass. These are repairs, not authenticated/paid/hour acceptance.
Next: signed fresh source, credential-free smoke, then a separate five-member
cohort under `tmp/community-hosted-smoke-setup3.mjs`; this helper is a reviewed
five-path substitution of the preserved second helper. Do not consume or
regenerate the untouched 253-user program. See the hosted guide for the actual
failure run/cohort bindings. Production `d9c184ab` was observed READY on
`dpl_E4iasMMtXfJeRgmaGtfiggyBjj9k`; application and lock fingerprints remain
unchanged. No new paid transaction or PDF authoring run has occurred.

**Hosted-test preparation follow-up:** Ian approved a manual, staging-only
GitHub Actions runner using synthetic-account and limited staging credentials,
with no production credentials, live payments or paid runner. Implementation
is underway; no hosted community workflow has been dispatched and no credentials
have been installed for it yet. Private state must remain encrypted and private,
not be placed in public Actions artifacts. The standard public-repository runner
is an alternative to laptop RAM, not proof of laptop/browser capacity.

**22:50 UTC hosted-runner implementation checkpoint:** the manual three-phase
workflow and private encrypted transport/recovery broker are implemented and
reviewed, with 107/107 simulation tests and tools TypeScript passing. No workflow
dispatch, secret installation or cloud activity result is claimed at this
checkpoint. First run credential-free Linux browser smoke, then a separate
five-member authenticated smoke (two API, three browser), before using the
unchanged prepared 253-person program/journals. See
[the hosted testing guide](hosted-staging-tests.md). Staging identity is marker
UUID `d5e4408d-c2fa-404d-81c5-ef4336dd8cd7`, not its database name. Fresh input
must prove zero persisted member tokens; only unused legacy placeholders are
removed from the transport copy, never from original local credentials.
The owned controller drains on ambiguous/halted activity; no automatic mutation
rerun, public artifact, cache, production/Stripe/DB secret or paid runner is used.
`.github/` is now excluded from Vercel application uploads.

Signed `4194c0e41` is READY on production deployment
`dpl_HJ7ZYhumGJQmKbZ6Re6PBSzEKJBm`. Actual 22:50 UTC read-only publication
verification confirms all five financial/simulation gates off, unchanged
production environment metadata/root link, and authored runtime/lock unchanged.
The dry-upload comparison explicitly accounts for the signed offline PDF
tooling changes and the new workflow exclusion; no private files are eligible.
No fresh production browser capture or PDF is implied by this metadata check.

Fresh run `3275f37c-213f-48d8-a1e0-50ce35850559` was created and provisioned
once: 250 scripted members, three browser members, one limited runner credential,
no member API tokens or paid grants. The 1,115-rule program and two fresh journals
are prepared. Actual read-only readiness at 21:56:51 UTC verified all 253 password
hashes, mappings and zero activity/payments/queues/claims/controllers. It remains
created/unowned; it has **not** run. Preserve these exact immutable paths and IDs:
`tmp/community-stage/run-hour253-regression2.json` and
`tools/simulation/.state/community-hour253regression2/`.
Readiness receipt:
`tmp/community-stage/hour253-readiness-3275f37c-213f-48d8-a1e0-50ce35850559-1791064611046.json`.
At 22:06:29 UTC RAM was 1.587 GiB, with no owned browsers/controllers. No launch
was attempted below the unchanged 2.5 GiB admission threshold.

Latest independently verified published checkpoint is signed `f7447e197`, READY
production deployment `dpl_EYMH9dGgVSTKd1MTFwNebeJh1kBT`, authored runtime
`9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f`.
All five production financial/simulation gates remain off; staging is still
`dpl_9v2tUXxH8AJ7qsaaSn8UfMdCmmZS`, with Supporter test sales only. The latest
tooling changes have not received a new capture or PDF authoring run. Offline
PDF-input tests pass 17/17; dialog metadata is explicitly allowlisted and only
attached to genuinely open-dialog screenshot calls. Missing views remain in the
29-route/four-alias/21-dialog denominator. Root independently reran all 136 unit
tests, 11 focused capture tests, four-file lint and strict scoped TypeScript:
all pass. App/runtime and lockfile are unchanged.

The separate expired-only pointer observation failed at 21:44 UTC before useful
panel evidence; its exclusive failure receipt is preserved. It does not explain
the original acknowledgment timeout or establish a provider ban. The unused
Sustainer operation `284c4f9d-6aec-4910-bbb2-ef7b1a9d2ff7` still has no prepared
Checkout; its separately bound future read-only observer passed ten offline
tests, not provider acceptance. Do not reset budgets, replay either expired $5
intent, install Link CLI, or count target-tier labels as paid recognition.

**21:36 UTC follow-up:** the read-only individual-member history browser check
passed, with explicit receipts for the owned agent link, ordinary click, exact
URL, both headings and 25 correctly `entityId`-filtered records. Page/console/
HTTP/mutation errors were zero; minimum RAM was 2.781 GiB. Browser/API closed,
and independent process inventory found no owned Playwright Chrome processes.
The original failed combined sample and later pre-admission rejection remain
preserved; this does not reconstruct the original failing href or prove an hour.

Replacement operation `51033cb7-0087-4b98-9a56-62e2cd35d477` expired unpaid at
21:29:27 UTC. Independent 21:33:50 provider/app/normal-member readback verifies
matching expired status and processed signed expiry event
`evt_1UMaUlDed7vKVaptcwc0BW9W`. Both cohort operations remain intact; there are
zero subscriptions, paid coverage, ledger entries or financial submissions.
All three members remain Neighbor. Never replay either expired Checkout.

The latest docs-only signed main checkpoint `0cf39acf1` is READY on production,
deployment `dpl_4bKtKdb6cvecLWqGARhfzb9oeCB3`; its authored runtime/lock match
the tested `bfa90f213` release. Financial/simulation gates remain off. The
17-state browser smoke below tested that same runtime, not a new browser run
against the docs-only deployment.

Capture safeguards now require fresh UUID-suffixed namespaces and explicit
host-only, unexpired staging bootstrap cookies; production/loopback contexts
receive empty state. Eight offline capture tests and all 133 root unit tests
pass, with focused lint/type checks. Capture browsers and PDF generation have
not run. The fresh253 setup/read-only readiness reader remains preparation-only;
28 offline readiness tests pass, but no new cohort or controller exists.
Capture manifests/captions distinguish the actual origin and gates. Simulation
captures require an explicit `WALKTHROUGH_SIMULATION_RUN_ID` present in the
normal admin run list; no arbitrary historical run is substituted. For the
reviewed completed short run, pin `b611f721-18fc-47f3-aa42-7bb12b361116`.

Latest history receipt:
`tmp/community-stage/history-only-b611f721-18fc-47f3-aa42-7bb12b361116-1791063363211.json`.
Latest expiry receipt:
`tmp/stripe-test-acceptance-manual/1aa24b5b-c467-4063-a62a-cd6df957b393/supporter-replacement-expiry-final-2026-10-03.json`.

**21:01 UTC follow-up:** signed verified `bfa90f213` is pushed to `main` and
READY on the canonical production alias, deployment
`dpl_odip1yeXLq67Ya4FQd9Nzf3PDrZ1`, Node 24. All five production financial/
simulation gates remain off; environment metadata is unchanged. Exact build
and short runtime log review passed; fresh anonymous browser smoke is pending.
Only `main` remains locally/remotely, synchronized. No live purchase is authorized.

Independent short28 terminal readback now verifies completed/offline/unowned,
zero workers/pending/outbox/claims and 32 Asks/169 contributions owned by the
actual journal actors. The earlier history diagnostic did not retain explicit
per-heading success receipts: its heading claim below was inferred, not proved.
The original failing href was not retained, so the helper's run-level first-link
selection is an established ambiguity, not a reconstructed exact failure.
A separate exact-member, read-only history proof is being prepared.

The new, once-prepared $5 sandbox replacement operation
`51033cb7-0087-4b98-9a56-62e2cd35d477` remains unsubmitted. The ordinary visible
acknowledgment attempt timed out at 20:56:46 UTC; the panel remained, the checkbox
was unchecked, and no card was entered or payment submitted. Original and new
write-once intent/uncertainty records remain intact. Do not blindly replay either
acknowledgment or financial preparation. Replacement expiry is 21:29:27 UTC;
current provider/app reconciliation and safe diagnostics must precede any next
action. Unknown provider-console errors are not waived. Link CLI stays iceboxed.

**20:52 UTC short-run follow-up:** the actual ten-minute supervisor finished
at 20:50:53.992 UTC, exit 0: 799 successes, five authoritative rejections, zero
paused/backoff outcomes. Independent local review finds all 28 with at least
21 successes, all browsers with real UI mutations, zero pending/outbox/claims,
and both recorded processes dead. Hosted terminal/ownership review is pending.
The 90-second dashboard window passed all 111/111 actions, maximum 2,086 ms,
zero late/missing/unpublished events or browser errors. Its subsequent history
assertion failed; the helper could select a run-level link as a member link.
The follow-up's heading-success claim was later found to be inferred, not an
explicit recorded assertion (see the 21:01 UTC correction above).
Retain the original failed combined attempt; the helper selector is corrected,
and independent scoped history readback is still being completed. This remains
a short regression, not the required full-population hour.

**20:43 UTC short-run follow-up:** fresh run
`b611f721-18fc-47f3-aa42-7bb12b361116` is now running, not terminal acceptance.
Detached start at 20:40:52.900 UTC is fsynced: supervisor 10456, child 19260,
creation dates/parent verified after launch shell exited. Independent review
finds all 28 members with at least six successes (231 total), all three browser
members with real UI mutations, zero pending/outbox/halted participants. Two
authoritative script rejections are retained, not counted as success. One
90-second dashboard freshness/history measurement is in progress. Do not start
another controller, reuse its program/journals or claim the hour requirement.

**20:38 UTC follow-up:** current-source protected hosted and isolated CI E2E
each pass 36/40 cases, four explicit environment/capture skips, zero failures
or retries. Disabled-payment coverage passed in CI; simulation-record coverage
passed on staging. Exact hosted test-window logs have zero 5xx/error/fatal
records; CI has zero server-500/auth/global-error markers. Owned browsers,
servers and listener 3100 are gone; no current-run fixture users remain. Three
September 27 CI fixtures were preserved. Read `payments-verification.md` and
the exact private receipts before treating these differently gated suites as
financial, screenshot or soak acceptance.

**20:31 UTC follow-up:** the original $5 test Checkout's 20:24:36 expiry
deadline passed without card entry or payment submission. The ordinary visible
agent-acknowledgment attempt had an uncertain result; its write-once intent and
uncertainty receipt are preserved. A separate nonfinancial recovery was prepared
but never invoked before expiry. Do not replay either financial preparation or
the expired browser handoff. Read-only reconciliation verifies provider/app/UI
expired and unpaid, matching processed signed expiry event, zero subscriptions,
paid coverage and ledger entries. All three members remain Neighbor. Any
replacement needs a fresh reviewed operation and retains this failed history.
No paid member tier or settled financial acceptance is claimed. Link CLI is in
the icebox at Ian's request, not installed/authenticated by this work.

**19:55 UTC staging follow-up:** new protected canonical staging deployment
`dpl_9v2tUXxH8AJ7qsaaSn8UfMdCmmZS` is READY with authored runtime digest
`9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f`;
production remains the earlier disabled-gate release. Staging source/upload/lock,
Node 24, all-deployment protection, existing env metadata and Supporter-only test
gates are independently verified. Unit 125/125, isolated integration 121/121,
simulator 86/86, types, full lint and guarded build pass. Fresh CI E2E and repaired
mixed-run/freshness acceptance remain open; hosted E2E cannot replace the
disabled-payment CI case. See `dependency-security.md` for residual advisories
and the bounded fresh NFT/server-bundle scan.

Fresh short-regression run `b611f721-18fc-47f3-aa42-7bb12b361116` is prepared,
not launched: 28 independent synthetic accounts, 25 scripts/three browsers,
126 namespaced JSONL lines, clean unowned journals, no SQL Ask activity or paid
grants. Read `tmp/community-short28-plan.md` and `tmp/community-short-review.mjs`.
Root approval and measured startup headroom are required before detached launch;
never reuse old failed UUIDs, source files, journals or supervision logs.

The three clock-bound normal members passed nine unpaid browser route checks.
Only the first Supporter was prepared once: operation
`f827ab6e-ae5e-477c-935e-4e5c66b91636`, $5 test Checkout, `checkout_open`, expires
20:24:36 UTC. Its immutable manifest/admission and private provider handoff are
under `tmp/stripe-test-acceptance-manual/1aa24b5b-c467-4063-a62a-cd6df957b393/`.
Do not recreate/replay that preparation, pay a different operation, or use its
expired URL. Actual provider inspection found conditional Link CLI guidance and
a visible agent acknowledgment, not an explicit universal test-card prohibition.
Root is reviewing the ordinary supported acknowledgment before any card entry;
new restrictions must still fail closed. No card, submit, paid tier, signed paid
settlement or lifecycle acceptance exists at this checkpoint.

**19:30 UTC follow-up, superseding the live-run handles below:** run
`2ba5c5e4-f339-4b19-88a2-013c7ed447f1` failed the continuous-hour requirement.
A browser participant halted at 19:01:46; least-active post-warmup coverage
stopped at 1,799 seconds. Normal admin Stop command 24 drained it at
19:15:39.722 UTC, exit 0. Independent review verifies stopped/offline/unowned,
zero pending mutations/outbox/claims/live processes, 29,216 preserved successes
and 199 authoritative rejections. Ownership matches 776 Asks and 5,892
contributions. Do not restart this terminal run or alter its failed history.
The partial 45-second dashboard measurement also failed: 32 actions exceeded
five seconds, maximum 5,583 ms, and four were not rendered. New local browser
observation/phase diagnostics and publication/polling fixes are under verification;
they are not yet a successful replacement hour or a deployed acceptance result.

The three-member staging cohort `1aa24b5b-c467-4063-a62a-cd6df957b393` has
actual ready clock `clock_1UMYQiDed7vKVaptsuDlwk2V` and three provider-verified
Accounts-v2 customer mappings with immutable canonical bindings. Root executed
each setup stage exactly once; readback at 19:17:48 UTC verifies zero owned
Asks/payments/subscriptions/paid coverage/ledger entries. Setup receipt directory:
`tmp/stripe-test-acceptance-clock-setup/<run-id>/`; final read-only evidence:
`tmp/stripe-test-acceptance-clock-inspection.json`. Never rerun its clock/customer
setup. Desired persona labels are not paid tiers. Ordinary member UI verification
is still in progress, not passed. Revalidate actual Checkout controls before
asserting a human-only test-card blocker: current installed Stripe guidance has
no blanket sandbox-card automation prohibition, and the older blocking panel
text was not retained. Never bypass a restriction if the actual provider displays it.

Targeted dependency security fixes are local, not yet pushed: brace-expansion
5.0.12/1.1.21 and an @workflow/core-only devalue 5.9.3 override. Original dependency
graph is retained; no major upgrade, peer pruning, or broad npm audit fix. Final
`npm ci --legacy-peer-deps` passes. Three Buffer serialization regressions failed
on 5.9.2 and pass on 5.9.3. Thirteen high dependency-path audit findings remain,
rooted in currently unpatched braces/http-cache-semantics; exposure review is
in progress. Do not claim a zero-vulnerability audit or finished release checks.

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
supporter/simulation gates remain disabled. Public dark code publication is
verified above; financial feature activation remains separate.
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
