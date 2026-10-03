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

Snapshot: protected staging's supporter gate is enabled in test mode; Ask/fund
and production gates remain disabled. Full genuine Stripe sandbox acceptance and live-money
approval remain outstanding. The new code is published as an explicitly dark
production release (latest verified runtime source at signed commit `bfa90f213`): payments,
supporter/fund sales and production simulations remain disabled. Protected staging verification,
the final PDF, deployment identity, and full acceptance results must be recorded
separately in the release handoff and [acceptance contract](payments-implementation-plan.md).

Later October 3 follow-up: signed docs/capture checkpoint `f7447e197` is verified
READY on production (`dpl_EYMH9dGgVSTKd1MTFwNebeJh1kBT`) with the same authored
runtime as the earlier browser-tested release. Production gates remain off.
Individual-member history subsequently passed a separate read-only browser
check; the original combined failure is preserved. A fresh 253-account cohort
and recurring program are provisioned and read-only verified, but **not running**
and not hour-soak or paid-tier acceptance. Ian approved a manual staging-only
GitHub-hosted test runner to address laptop memory limits; implementation is
underway, not yet executed. PDF tooling/explicit open-dialog metadata are static
verification improvements, not a new walkthrough or completed payment flow.

October 3 checkpoint: protected canonical staging deployment
`dpl_9v2tUXxH8AJ7qsaaSn8UfMdCmmZS` is READY on Node 24 with authored runtime
digest `9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f`.
Its source/upload/lock and all-deployment protection were verified. Supporter
test sales alone are enabled; Ask/fund and production gates remain off. This
does not establish a paid member tier or completion of financial acceptance.

October 3, 21:14 UTC follow-up: the same authored runtime is READY on canonical
production deployment `dpl_odip1yeXLq67Ya4FQd9Nzf3PDrZ1`; fresh anonymous smoke
passes 17/17 states with no browser/console/server errors. The ten-minute mixed
28-member regression completed and drained with 799 successes; its dashboard
sample passed 111/111 within five seconds. Individual history verification and
the full253 continuous hour remain open. The latest ordinary Stripe acknowledgment
timed out without card entry/payment submission; actual paid tiers remain unproved.

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
| Live activity publication and cursor catch-up | newly finished | Foreground live-feed polling targets one second; full incremental pages catch up at 250 ms, preserving cursor zero after an initially empty result, de-duplicating IDs and retaining a bounded 500-event display. Archive pages remain non-polling. Controller publication accounts for request time within its one-second period, yields at least 250 ms and backs off to two seconds on failure. These timings are implementation policy, not proof of a five-second action-to-render target. |
| Per-Ask payment pause | brand new | Authorized administrators can pause/resume new payment and fund-allocation reservations with an audited reason and stale-state protection. Existing Checkouts can still settle; refunds and recovery continue. No provider eligibility or environment gate is bypassed. |
| Recovery-case review | brand new | Paginated private operator history with audited acknowledgement/escalation and idempotent retries. Reviewing a case cannot resolve a financial hold, change a payment, or claim money recovered. |
| Analytics definitions | brand new | Giving excludes legacy pledges and supporter subscriptions. Verified net subtracts confirmed recipient refunds/disputes. Supporter MRR requires active, non-canceling, paid-through supporter subscriptions. Request latency is measured, not fabricated; missing observations remain unavailable. |
| Member/admin authorization | brand new | Verified administrator role, current account/freeze/session checks, server-side permissions and session/token revocation. A display name does not grant administration. |
| Financial admin step-up | brand new | Recent authentication and replay-protected TOTP mint a five-minute encrypted, account/session-bound elevation token held only in browser memory. Production financial actions enforce it. Ian's own bootstrap and MFA enrollment are not claimed complete. |
| Concurrent auth throttling | newly finished | The existing database limiter now updates atomically rather than losing simultaneous attempts. |
| Password-reset revocation | newly finished | Resetting an existing account password also invalidates prior session versions/tokens; already-issued sessions are no longer silently retained. |
| Environment isolation | brand new | Separate synthetic-only staging and CI databases/roles, environment identity, protected staging origin, private encrypted staging email sink, independent payment/supporter/fund flags, and explicit production live approval gate. |
| Targeted dependency security hardening | newly finished | Retained the installed graph while patching brace-expansion to 5.0.12/1.1.21 and the scoped Workflow devalue override to 5.9.3; three Buffer-view disclosure regressions pass. Thirteen high audit entries remain from two unpatched braces/http-cache-semantics advisories, six in the production installation. Fresh local traces/bundles contain no observed chain paths/markers; this bounded packaging evidence is not universal unreachability or a zero-vulnerability audit. See the [security checkpoint](dependency-security.md). |

Giving is not a bank-payout metric. Daily giving groups current net values by the
original UTC payment date, not a historical cash-flow reconstruction. Simulation
events and model statements are never authoritative financial success.

## MCP and local multi-agent simulation

**October 1 accepted revision:** the required community is 250 ongoing scripted
users and three browser users initially, configurable to 30 browsers. Scripts
and browsers use normal independent member sessions and the same UI APIs. The
Strands/local-model machinery below remains optional exploration, not the
required member transport or a replacement for the mixed-community soak.

| Capability | Tag | Implemented behavior and boundary |
| --- | --- | --- |
| Versioned member MCP API | brand new | Official SDK transport, strict schemas, scoped staging per-user tokens, revocation and shared authorized domain services. Tools browse Asks/profiles/funds/history and create/edit/save/contribute/complete/cancel as the authenticated member. |
| Retry and identity protection | brand new | Caller-supplied user IDs do not grant identity; stable correlation IDs bind mutation retries. Atomic domain writes and persisted operation results prevent duplicate effects; ambiguous external Checkout outcomes require reconciliation. |
| Checkout handoff tool | brand new | A gated test-mode Checkout preparation tool, not arbitrary card charging. No model access to Stripe secret keys or financial-administrator powers. |
| Controlled sandbox checkout lane | brand new | Separate serial, fixed-scenario browser harness with server-attested owned test Checkout, finite persistent budgets, secret-isolated fixed test-card entry, and reconciliation-only handling after ambiguous submission. Local policy/driver tests pass; actual Stripe-hosted DOM/3DS/provider outcomes remain unverified. |
| Tiny subscription-clock cohort | brand new | Explicit scoped operator endpoint creates/reads/advances one named test clock for a deterministic cohort of at most three synthetic members. Own-account binding occurs before first Checkout. The fresh staging cohort now has a ready actual clock, three verified Accounts-v2 customer mappings and immutable canonical bindings. Clock controls are not model tools; the 100-agent baseline has no clock scope. App-linked paid renewals/cancellations remain unverified. |
| Independent agents | brand new | Up to 100 Strands TypeScript agent instances with distinct synthetic accounts, personas, goals, budgets, memory and checkpoints. They share bounded local inference capacity, not one conversation or 100 loaded model copies. |
| Ongoing scripted and browser community | brand new | Up to 280 independent normal-auth accounts, with 1–30 browser accounts and bounded browser/API pools. JSONL recurring rules react to current records and browser-created activity; exact references preserve returned IDs. No SQL activity, impersonation, privileged member token or fabricated entitlement. |
| Cross-machine controller fencing | newly finished | One server-owned controller binds the cohort, program and both durable journals. Stale heartbeats never permit automatic takeover; reviewed recovery leaves the run paused and retains unresolved actions. |
| Browser Ask identity and terminal connection state | newly finished | Save uses the exact canonical entity link even with duplicate titles. A completed/stopped runner is offline regardless of a recent heartbeat; terminal history remains available. |
| Script/browser concurrency race handling | newly finished | An authoritative pre-admission target change waits for a new selection. A submitted or uncertain action still pauses rather than replaying; a real hosted stale-target regression proved zero browser POSTs. |
| Browser streaming response verification | newly finished | Decodes the actual UI request-negotiated tRPC stream, including HTTP-200 application rejection. Captures the single response before success navigation discards it; forwarding disables retries/redirects, and entity/UI readback remains required. |
| Safe browser phase and intent diagnostics | newly finished | Error telemetry carries only a fixed phase vocabulary, admitted/sent intent flags and bounded page/console-error counts, never raw DOM, credentials or provider bodies. Post-response but unverified actions remain fail-closed; errors are not hidden to manufacture a retry or success. |
| Pre-submit contribution control recovery | newly finished | A freshly API-eligible contribution target with a missing UI control gets at most two read-only reload/observations before any intent. Admission, sent/uncertain mutations, page/console errors and post-response verification failures forbid this retry. Deterministic tests prove the boundaries; no natural-run recovery or fresh soak success is inferred. |
| Full-community continuity evidence | brand new | All-participant warmup, least-recently-active endpoint, per-participant five-minute windows and action-gap checks distinguish an ongoing community from process uptime or a stopped browser. The first 253-member run retained 39,591 successes but failed at 3,509 seconds after warmup. A second retained 29,216 successes/199 rejections but a halted browser limited coverage to 1,799 seconds; its partial dashboard measurement also failed the five-second target. Both were safely stopped with history preserved. A fresh hour run remains required. |
| Observation versus mutation recovery | newly finished | Failed allowlisted GETs before intent get three bounded retries and fresh selection. Unknown POSTs, admitted writes, auth errors and generic browser faults never replay. The first full-population read halt was preserved as a failed soak, not rewritten as success. |
| Whole-history release check and isolated migration rehearsal | newly finished | Exact-old/current builds, real old→current→old auth/session/Ask browser compatibility and final 36-case CI browser regression pass. A fresh ready no-compute backup precedes actual production 0011–0018 migration: nineteen migrations, legacy data/unrelated schema preserved and safe member defaults. Signed new-code dark release is published; anonymous browser/runtime checks pass. All production money/simulation gates stay off, with genuine paid acceptance still unfinished. |
| Offline Stop checkpoint and claim cleanup | newly finished | A fresh normal-admin recovery receipt permits control-only application of one reviewed queued Stop, without member authentication/activity. Terminal cleanup requires empty mutation/outbox state and dead recorded controllers; historical outcomes remain unchanged. Actual stranded 253-member recovery verified. |
| Durable local supervision | newly finished | Fsynced start/progress/terminal milestones survive stdout loss; strict parent IPC requests the ordinary admission-stop/drain path rather than Windows force-kill signals. A detached child survived launcher exit in a measured probe. Hard OS termination still requires explicit recovery; this is not hour-soak acceptance. |
| Local models/runtime | brand new | Native Windows llama.cpp with pinned/hash-checked Qwen3.5-4B and Gemma 4 E2B candidates, loopback-only model endpoint, bounded contexts/output, memory headroom guards and benchmark reports. No paid inference fallback or termination of Ian's apps. |
| Execution and recovery | brand new | Local SQLite checkpoints/outbox, one mutation at a time per agent, scoped browser contexts, authenticated outbound telemetry, command cursors, finite retries/budgets and offline detection. No shell/SQL/unrestricted-HTTP tools for agents. |
| Simulation control room | brand new | Create a run; inspect roster, individual agent and historical activity; start/pause/resume/stop; per-agent controls, activity/concurrency settings, freshness/connection states and completed-run replay boundaries. |
| Deterministic versus autonomous modes | brand new | Explicitly distinct modes. Deterministic regression activity does not establish model-selected behavior, and a successful model tool selection does not establish successful site execution. |

The requested approximately 60% Neighbor / 25% Supporter / 15% Sustainer mix, recipient cohort and
cross-tier money interactions remain an acceptance target. Paid tiers must be
earned through genuine Stripe test flows. Provisioned accounts alone do not
prove the target. Scripted accounts remain active alongside browsers; optional
model agents share inference capacity rather than requiring one model per user.

## New and changed views

| Routes | Views/actions |
| --- | --- |
| Existing `/`, `/asks`, `/asks/[slugOrId]`, `/members/[id]` | Expanded navigation; payment-aware Ask progress and owner enrollment confirmation; Checkout quote dialog; optional supporter badge/preference. Existing non-monetary/legacy views remain. |
| `/support` | Free/paid plan comparison, sign-in/gated configuration states, subscription Checkout or billing management. |
| `/giving`, `/giving/[id]` | Private impact/history, payment detail, pending/failure/refund states, receipt link and Checkout cancellation confirmation. |
| `/account/billing` | Own subscription/tier overview, paid-through/time-verification state, change preview/confirmation/history, pending invoice handoff, cancel/resume/undo and provider portal. `/account` and `/billing` redirect here. Provider-dependent states require genuine owned records and enabled feature/policy gates; configured credentials alone do not establish paid membership. |
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

October 2 follow-up: root unit 106/106, tools 50/50 and isolated integration
121/121 passed; types/lint/guarded build passed. A real ten-member, three-browser
mixed run completed 137 successes with no failures and clean journals. Three
normal-member Checkout preparations, unpaid abandonment/cancellation and genuine
signed expiry delivery were verified. No paid subscription or main money path
is established by that expiry. Larger ramps/freshness results are maintained in
the [verification record](payments-verification.md), not inferred from fixtures.

October 3 follow-up: unit 125/125, isolated integration 121/121, simulator
86/86, types, full lint and guarded build passed at the protected-staging
checkpoint above. Hosted E2E ran at 20:28-20:32 UTC: 36 passed, four explicit
skips, zero failures; fresh isolated CI E2E at 20:33-20:37 UTC also passed
36 tests with four explicit skips and no retries. Hosted results do not replace
its isolated CI coverage. The fresh 28-account short regression is prepared
with zero member activity, paid grants or controller ownership, not launched.
The repaired short run, full-population hour and fresh action-to-render/history
acceptance have not yet executed.

20:43 UTC follow-up: the prepared 28-member short run started under detached
supervision. Independent review finds every member with at least six genuine
successes and all three browser members with real UI mutations, no halted or
pending actions. Its dashboard measurement and terminal drain are still in
progress; this is not a passed short regression or the required mixed hour.

Application test credentials and the fresh canonical clock/customer bindings
are configured; they are no longer blanket setup blockers. The original fresh
$5 Checkout expired unpaid, and its actual signed expiry was processed; the
expired handoff/uncertain acknowledgment history is retained, not replayed or
counted as settlement. Provider restrictions must be assessed on the actual
current surface and obeyed if displayed, not asserted as a universal manual-only
test-card rule. No new paid tier, settled member payment or financial lifecycle
acceptance is claimed.

These are scoped results, not a replacement for the root release verification
record. A protected ten-member deterministic smoke completed 30 real nonfinancial
actions with 200 acknowledged telemetry records. No successful 100-agent autonomous soak or real Stripe
payment/subscription/test-clock lifecycle is claimed here.

Outstanding acceptance includes recipient onboarding, paid completion of every
Checkout path, declines/3DS/async flows, signed paid settlement delivery,
renewals/plan changes/test clocks, refunds/disputes/payout failures, crash recovery,
and the measured 10 -> 25 -> 100 -> 253 ongoing scripted/browser progression,
one-hour mixed soak and cross-tier actions.
Live launch additionally needs Ian's verified admin/MFA setup, business and tax
decisions, hosting/recovery readiness, reviewed production migration/deployment,
and explicit approval. See the [operator runbook](payments-runbook.md),
[simulation guide](simulation.md), and [payment invariants](../src/server/payments/README.md).
