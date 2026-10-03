# Ongoing scripted community and browser users

Accepted October 1, 2026. This replaces the requirement for 100 independent
local-model agents. Start with 250 scripted accounts and three browser accounts;
configure one through 30 browser accounts and browser slots. Every account has
one controller, normal authentication, private cookies, and an independent schedule.

Accounts are provisioned before a run. Community actions occur continuously
while browser users click/type; scripted users do not disappear after initialization.
Exact action lines produce stable references; recurring rules select current
records, including records created by browser users, through the real UI API.
Only the server decides whether a concurrent action is permitted/successful.

Member transport is `/api/auth/*` and the existing `/api/trpc` member procedures.
No MCP simulation token, direct DB activity, server-caller bypass or fabricated
payment is permitted. Normal credentials remain in ignored files. A run-level
controller may handle telemetry/control/isolation attestations separately; it
cannot perform member activity with its own privileges.

Each line has a stable ID, account alias and action. Optional `everySeconds`
repeats a rule throughout the run. An `ask` target can be an explicit ID, an exact
reference from an earlier line, or a `match` filter evaluated at execution time.
References store returned entity IDs, not private API responses or auth cookies.
Server rejection is recorded; an ambiguous network mutation pauses the account
and is not replayed merely because no response arrived.

Failed allowlisted read-only observations **before** any durable mutation intent
receive at most three retries, with one/two/four-second backoff and fresh
selection. They are reported as `observation_backoff`, not successes or uncertain
writes. An admitted mutation, generic browser failure, auth rejection or exhausted
read retry budget still pauses the account; the transport never retries a POST.
The first 253-user soak exposed this distinction and was stopped, preserved and
not accepted as an hour-long success. New transport/policy tests also prove that
a read failure after an admitted write cannot enable replay.

The required rollout is normal-auth smoke, exact cross-user scenario, mixed
browser/script interaction, population ramp, then an hour of concurrent community
activity with measured dashboard freshness. Financial acceptance still requires
actual Stripe sandbox Checkout, signed events, paid tiers and ledger verification.
Optional local-model exploration does not block these requirements.

For hour acceptance, allow warmup in addition to the measured hour (the prepared
fresh 253-user run uses `SIM_DURATION_SECONDS=4500`). Warmup ends only when every
participant has three successful actions. `community-evidence.ts` conservatively
ends measurement at the least recently active account, requires successful
activity in every complete five-minute window and rejects action gaps over three
minutes. Count successful authenticated mutations separately from browsing.
Process uptime, queued attempts, persona labels and a busy scripted subset are
not proof that all browser/script participants stayed active.

Implementation status is recorded in the verification document. The older
`simulation.md` describes the legacy MCP/model runner and its historical probes.

## Starting a run

Create a **Scripted + browser community** run in the isolated staging admin
dashboard. The default 253 accounts include three browser accounts; the other
250 use recurring scripts. Configure the browser population before provisioning.
The runner selects across declared Neighbor/Supporter/Sustainer cohorts. These
are target labels only: paid recognition still requires actual sandbox billing.

From the repository root, provision that existing run:

```powershell
node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id <run-id>
```

This mode provisions verified, clearly synthetic accounts and run metadata.
It creates **no SQL Ask activity and no member MCP API tokens**. Its run-level
token is limited to the existing simulation control and telemetry endpoints.
Then, in `tools/simulation`:

```powershell
$env:SIM_CREDENTIALS = '.state/runs/<run-id>/credentials.json'
$env:SIM_STATE_DIRECTORY = '.state/community-<fresh-run-tag>'
$env:SIM_ACTIVITY_FILE = '.state/runs/<run-id>/activity.jsonl'
$env:SIM_PROTECTION_BYPASS_FILE = '.state/protection.json'
$env:SIM_BROWSER_USERS = '3'
$env:SIM_BROWSER_CONCURRENCY = '3'
$env:SIM_API_CONCURRENCY = '4'
$env:SIM_DURATION_SECONDS = '4500'
$env:SIM_MIN_FREE_GIB = '1'
npm run community:generate
npm run community -- validate
npm run preflight
npm start
```

Use the browser population configured on the server, not a different local
population. `SIM_BROWSER_CONCURRENCY` controls simultaneous browser actions,
bounded by that population and 30. `SIM_API_CONCURRENCY` defaults to four and
does not cap the separate browser pool. `SIM_DURATION_SECONDS` defaults to 3600,
which does not include an extra hour after warmup. Use a fresh private journal
directory for each new run; restore that run's **original** directory on recovery.
The generator refuses to overwrite an existing program. Keep credentials,
protection bypass, cookie jars, generated programs and SQLite state ignored.

`validate` checks local configuration; `preflight` additionally requires an
authenticated server attestation of staging identity, test/unconfigured Stripe,
the exact run, population and account IDs. Older hosted deployments must be
updated before they can provide this attestation. Do not bypass its rejection.

`npm start` now starts the revised runner. Historical model/MCP runs use
`npm run legacy:preflight` and `npm run legacy:start` instead.

## Exact and reactive action examples

Each physical JSONL line is an action or recurring rule. For example, with the
actual provisioned aliases substituted for `alice` and `ben`:

```jsonl
{"id":"post","user":"alice","action":"create_ask","ref":"moving","input":{"title":"Moving help","description":"Help carry two boxes upstairs please.","type":"task","goalAmount":2}}
{"id":"offer","user":"ben","action":"contribute","ask":{"ref":"moving"},"amount":1,"ref":"ben-pledge"}
{"id":"finish","user":"alice","action":"set_contribution_status","contribution":{"ref":"ben-pledge"},"status":"completed"}
{"id":"keep-helping","user":"ben","action":"contribute","ask":{"match":{"type":"task","maxDifficulty":3}},"amount":1,"everySeconds":60}
```

The owner can complete the referenced contribution; only its contributor can
cancel it. These are application permissions, not special simulator privileges.
References wait for real returned IDs. Recurring references are rejected to
prevent overwriting an earlier result. No eligible record means **waiting**, not
invented activity. Current supported actions are Ask browsing (`/asks`), creation,
saving, nonfinancial contributions, and exact completion/cancellation. Money
Checkout, fund and supporter scenarios remain separate acceptance work.

Recurring lifecycle lines can instead select a current pledge. Owner completion
uses the server's existing creator filter; cancellation selects only the current
account's own pledge. The selector re-reads details, excludes monetary and
payment-backed Asks, and inspects at most 20 candidates per execution. It does
not promise to traverse all historical contributions. No match means waiting.

```jsonl
{"id":"deliver-current","user":"alice","action":"set_contribution_status","contribution":{"match":{"as":"owner","ask":{"match":{"type":"task"}}}},"status":"completed","everySeconds":90}
{"id":"cancel-my-current","user":"ben","action":"set_contribution_status","contribution":{"match":{"as":"contributor","ask":{"match":{"type":"task"}}}},"status":"cancelled","everySeconds":150}
```

The generator now includes saved Asks, owner delivery and a subset of contributor
cancellation rules alongside browsing/creation/help. Regenerate only for a fresh
run; an existing program/journal binding cannot be rewritten. Real hosted browser
regression verified dynamic pledge selection followed by exact status readback.

## Recovery and controls

The local `activity.sqlite` stores intent before a mutation is sent, returned
entity references, and terminal outcomes. A pending mutation after a crash does
not replay automatically. Review the real site/history and implement a proven
resolution before that account can proceed; a dashboard Resume command cannot
clear ambiguity. Terminal results cannot be overwritten.

Account claims prevent two live local controllers using the **same shared state
directory**. A durable server claim additionally fences the full cohort across
directories/hosts and overlapping runs. It binds the action journal's identity,
the telemetry journal and the immutable program. A stale heartbeat never grants
automatic takeover. All claims are acquired before sign-in; shutdown drains work,
closes browser/session resources and acknowledges history before releasing the
server claim. Pending mutations, unacknowledged telemetry or failed browser
cleanup retain that claim for review. These paths have isolated CI database
coverage; hosted lifecycle and population acceptance remain outstanding.

If a controller crashes, stop it on every machine, retain both journals, sync its
outbox with `npm run community -- sync`, and review pending actions against the
actual site records. After at least two minutes without heartbeat/acquisition
contact, an authenticated staging admin can select **Review controller recovery**
and type the explicit stopped-process/pending-action confirmation. The server
checks the exact observed owner and appends one recovery audit plus a pause
command. Recovery leaves the run paused, retains program/journal binding, and
does **not** clear a local pending intent or fabricate a payment result. Start
the replacement with the original journals; explicitly resume only after review.
If history is lost, create a fresh run with fresh accounts instead. The dashboard
cannot independently prove that another machine's process has stopped.

Run pause/resume, individual pause/resume, browser concurrency and pacing use the
existing admin control queue. A control is not applied merely because it was
queued. Local metadata retains applied controls, and acknowledged telemetry
provides dashboard history. Control/telemetry outages stop new admission after
15 seconds; remaining events stay in the durable outbox. Sync them with:

```powershell
npm run community -- sync
```

Ctrl+C pauses/checkpoints; a requested Stop or elapsed run duration makes that run
terminal. A stopped run cannot resume even if its final event is still local.
RAM admission never closes Ian's other applications. Resource measurements and
telemetry freshness still need the hosted ramp and one-hour soak.

## Durable supervision and measured acceptance

The acceptance default is **250 scripts and three real browser users**, three
browser slots and four separate API slots. Every user must keep acting; accounts
provisioned once are not live participants. Check at least three successful
cycles and one authenticated mutation per participant against real application
records. The generated program covers four nonfinancial Ask types, not actual
paid tiers, monetary Asks, funds or supporter lifecycle acceptance.

After normal-auth smoke, exact cross-user/browser regressions and population
ramps, allow 75 minutes for warmup and the measured hour. Acceptance needs at
least 3,600 seconds from the last participant's third success to the least
recently active participant's final success, no activity gap over 180 seconds,
and successful activity by every user in every complete five-minute window.
Measure live dashboard freshness too. Shutdown must drain mutations, telemetry
and controller claims. If resource pressure, a halted browser or process loss
breaks these conditions, preserve the failed run and try a fresh run/accounts/
program/journals. Do not rewrite or extend its recorded history to fill a gap.

Configuration up to 30 browsers does not promise this laptop can run 30 at once.
A separate 280-account experiment can measure browser-slot ramps at 3, 5, 10, 20
and 30 with 250 ongoing scripts, only while measured headroom permits. Report the
actual tested ceiling and pressure/backoff. Never close Ian's applications,
claim an unmeasured 30-browser result, or run heavy builds/browser suites beside
the measured hour.

Use the tracked `community:supervised` entry point for long runs. It requires exact
run-scoped credential/program paths, a private `community-*` journal directory,
an isolated staging origin and a fresh supervision log inside that run directory.
It rejects linked state paths, unknown scheduled accounts and a missing account
schedule. The child receives only OS/runtime paths and validated simulation
options, not database, Stripe, authentication or runtime-injection secrets.

From `tools/simulation`, set the exact `SIM_*` values in the startup example:

```powershell
npm run preflight
npm run community:supervised -- inspect
npm run community:supervised
```

`inspect` validates locally and prints only safe configuration, without starting
a child or creating a supervision log. `run` requires at least 2.5 GiB free RAM
and at least one GiB above the configured admission floor. The child retains its
own ongoing resource/control admission guards. The default log is
`.state/runs/<run-id>/supervision.jsonl`; exclusive creation prevents accidental
duplicate launches or overwritten evidence. After independently reviewed paused
recovery, a new `SIM_SUPERVISION_LOG` may name
`.state/runs/<same-run-id>/supervision-<new-launch-uuid>.jsonl`. This changes only
the observer log, **not** the original action/telemetry journals or program.

For a Windows process independent of the launching tool, start from the repository
root with the same `SIM_*` values (those paths stay relative to `tools/simulation`):

```powershell
$communityNode = (Get-Command node).Source
$communityRunId = '<run-id>'
$communityRepo = (Get-Location).Path
$communityObserver = "$communityRepo/tmp/community-stage/observer-$communityRunId.log"
$communityErrors = "$communityRepo/tmp/community-stage/supervisor-errors-$communityRunId.log"
if ((Test-Path -LiteralPath $communityObserver) -or
    (Test-Path -LiteralPath $communityErrors)) {
    throw 'Review existing evidence/processes instead of launching a duplicate.'
}
$communitySupervisor = Start-Process -FilePath $communityNode `
    -ArgumentList @('--experimental-strip-types', 'tools/simulation/src/community-supervisor.ts') `
    -WorkingDirectory $communityRepo -WindowStyle Hidden `
    -RedirectStandardOutput $communityObserver -RedirectStandardError $communityErrors `
    -PassThru
$communitySupervisor.Id
```

Supervision logs safe fixed categories and exact known aliases, not raw stderr,
arbitrary error text, credentials, private responses or payment links. Timestamped
start/progress/terminal milestones are flushed to disk independently of stdout.
The first record identifies supervisor and owned runner PIDs. Verify actual
processes on launch and after observation failures: a stale log/state file is
not proof of liveness. Never restart merely because a tool wait timed out.

Losing the observing stdout pipe is not a stop request. The supervisor requests
a graceful drain through strict parent/child IPC; it does not force-kill a Windows
child with `child.kill('SIGINT')`. No finalizer survives OS termination, shutdown
or power loss: retained journals, hosted offline detection and reviewed recovery
handle those failures. Financial correctness never depends on this laptop. A
credential-free 15-second hidden-process probe on October 3 continued after its
launching tool exited and recorded its own terminal state; laptop shutdown
survival was not tested.

## Reviewed checkpoint and terminal cleanup

For a dead/recovered controller, **Stop & checkpoint** queues a command but does
not itself establish terminal state. The explicit `checkpoint` path applies only
the reviewed stop, without member sign-in, browser work, member loops or domain
mutations:

1. Prove the controller absent on every host, retain both original journals,
   review pending mutations against real records and synchronize retained
   telemetry with `npm run community -- sync`. Never erase an unresolved intent.
2. Use normal staging-admin controller recovery, then request Stop in the normal
   admin UI. Recovery stays paused and does not resolve any local mutation.
3. Obtain a fresh normal-admin read receipt containing the exact `runId`, retained
   `priorControllerId`, matching `recoveredControllerId`, `status: "paused"`,
   `controllerId: null`, `online: false`, specific queued `stopCommandId` and
   `observedAt`. It contains no credentials and expires after two minutes. The
   local acceptance helper's `checkpoint-review` creates this only from reviewed
   exact journals and actual normal-admin API state.
4. Keep the original run's credential/program/journal configuration and use:

   ```powershell
   $env:SIM_CHECKPOINT_REVIEW_FILE = '../../tmp/community-stage/checkpoint-review-<run-id>.json'
   npm run community -- checkpoint
   npm run community -- cleanup
   ```

Checkpoint requires the exact paused hosted cohort, retained controller identity,
zero unresolved mutations/outbound events, and no live or ambiguous recorded PID.
It acquires the supported run-control fence, applies the exact queued stop and
uses shared drained finalization. Missing stop or uncertain acquisition never
starts member work or fabricates completion; retain its recovery evidence.

`cleanup` additionally requires an attested terminal run, empty pending journals,
proven-dead/cohort-matching claims and acknowledged release of the same hosted
program/journal binding. It removes only local control claims and marks local
control metadata terminal. Steps, references, program/journal identity and
historical telemetry are never rewritten. Live/unknown PIDs, foreign accounts,
pending writes, unsent events and unknown hosted state fail closed.

For an approved paused-run continuation instead, restore the original journals,
complete reviewed recovery, run `npm run community -- run`, then explicitly request
Resume in the admin UI. A stopped/completed run cannot resume: provision a fresh
run and accounts. A new supervision log for the same paused run is permitted;
empty replacement mutation/telemetry journals are not.

The interrupted October 2 run `a90697e2-be08-42a4-b88c-f2f176fbed0a` was safely
recovered/stopped October 3 at 17:48:43 UTC. Its 39,591 successes, 290 rejections
and 3,509-second all-user post-warmup interval remain **failed hour acceptance**.
All 39,881 historical step rows and before/after journal hashes were preserved.
Final pending/outbox/active/queued/controller counts were zero; exact external
termination cause remains unproven. Prepared fresh run
`2ba5c5e4-f339-4b19-88a2-013c7ed447f1` is separate; preparation establishes neither
an hour of activity nor actual paid entitlement.
