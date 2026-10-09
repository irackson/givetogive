# Local community simulation

## Viewing hosted runs from a phone

Open [the staging simulation dashboard](https://givetogive-staging.vercel.app/admin/simulations).
It is hosted independently of the ROG: recorded runs and individual action
histories remain viewable when the laptop/runner is off. New live actions require
an active runner; a stopped run is history, not a live simulation.

Staging keeps Vercel deployment protection. Sign into a Vercel account authorized
for the project, then your **separate GiveToGive staging account**. Dashboard
access requires the verified, unfrozen, non-synthetic `inasusr@gmail.com` account;
production cookies/accounts do not automatically carry across the isolated
database. Read-only inspection on October 9 at 06:11 UTC confirmed that this
staging account exists, is verified, unfrozen and non-synthetic. Sign in normally;
an already verified account does not need another verification email. If sign-in
fails, use your staging password/recovery flow, not shared bot credentials or a
copied production password. The owner's actual iPhone login remains unverified.
See [staging email evidence and boundaries](staging-auth-email.md). Personal MFA
enrollment is iceboxed; financial operator
permissions and production step-up are still separate requirements.

Select a run, then an individual member to inspect its recorded actions. The
foreground dashboard refreshes every two seconds; background polling is disabled.
The four currently approved full-hour run IDs were independently read on October
9 at 06:12 UTC: all are stopped with no controller held. The latest full-hour
GitHub job is terminal failure; these are historical experiments, not a currently
live fleet or a passed hour. Do not restart a stopped run or reset its journals.
Fresh-cohort approval and full-hour acceptance remain required after staging
release/source verification. Read [the current handoff](AGENT-HANDOFF.md) before
starting or recovering any controller.

Mobile Chromium 390x844 rendering of the list, stopped-run detail and populated
individual history passed without page-wide overflow or browser errors. Physical
iPhone Safari and Ian's authenticated staging flow remain unverified.

**Historical runner:** the accepted scripted/browser community is documented in
`community-runner.md`. The model/MCP runner below now uses
`npm run legacy:preflight` and `npm run legacy:start`; plain `npm start` starts
the revised normal-UI-auth runner.

The simulator is a separate Node 24 package in `tools/simulation`. It creates 100 independent Strands `Agent` instances with isolated private memories and application identities. A shared, local-only llama.cpp inference server supplies decisions; it does **not** load 100 copies of a model. Browser contexts are short-lived and isolated per account. No cloud-model fallback exists.

## Installation and models

From `tools/simulation`:

```powershell
npm ci
npm run setup:models
npx playwright install chromium
npm run model:start -- -Model qwen -Parallel 2
```

PowerShell 7 (`pwsh`) and `uv` are used by setup. The HF CLI runs through an isolated uv environment. If that environment cannot initialize, setup explicitly reports it and downloads the same pinned public Hugging Face file over HTTPS. Both paths verify the same publisher-provided SHA256. Downloads remain in ignored `.runtime/`; no global CUDA installation or driver change is made.

| Artifact | Pinned version/revision | SHA256 |
|---|---|---|
| llama.cpp Windows CUDA 12.4 | b11146 | `3c806a6ceccc3dae1c743ceb1a1fb2cce5b76f40bfbd4c6b7b8afb6ef45a5807` |
| CUDA runtime archive | b11146 | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` |
| Qwen3.5-4B Q4_K_M | e87f176479d0855a907a41277aca2f8ee7a09523 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| Gemma 4 E2B QAT Q4_0 | 675cff42a74c774d6cb76f76d8eacb49b48c9b93 | `fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634` |

The model server binds only to loopback, requires a generated local API key, and allocates 4096 context tokens per slot. The key stays in ignored `.runtime/server-key.txt`. Each model start prints its PID and log path; stop only that owned process after verifying its executable path. Do not start a second model on the same port or run both models together on this laptop.

Startup requires 2 GiB free system RAM with no-mmap GPU loading. The scheduler stops admitting new work below its configurable free-RAM floor; benchmarks cancel below 0.75 GiB. Neither closes other applications. Queueing, idle time, and memory backoff are visible states, not disguised as simultaneous inference.

## Credentials and hosted contract

The staging fixture provisioner supplies an ignored, run-specific credential file:

```json
{
  "runId": "provisioned-run-id",
  "mode": "autonomous",
  "origin": "https://givetogive-staging.vercel.app",
  "databaseIdentity": "exact-staging-identity-from-provisioner",
  "runnerToken": "REDACTED",
  "agents": [{
    "id": "neighbor-001",
    "userId": "real-staging-user-id",
    "token": "REDACTED",
    "email": "synthetic-account@example.invalid",
    "password": "REDACTED"
  }]
}
```

Every agent ID, user ID, and token must be unique. Credentials are passed to transport/browser code only, never to model prompts, memories, or uploaded logs. Tokens should be scoped, revocable, and short-lived. Existing browser storage can be supplied via `storageStatePath`; it is verified against `/api/auth/session` before use. If unavailable, the browser signs in normally with the fixture credentials. Synthetic fixtures must have genuinely established test subscriptions; persona tier labels alone do not set entitlements.

Contracts are defined in `tools/simulation/src/protocol.ts`:

- `GET /api/simulation/manifest`: runner bearer token; must attest protocol v1, `environment=staging`, exact origin and database identity, `stripeMode=test|unconfigured`, truthful `paymentsConfigured`, `simulationEnabled=true`, and `/mcp` path. An unconfigured Stripe environment permits only nonfinancial feasibility runs: checkout tools are hidden. Full financial acceptance requires configured test Stripe. Live mode always fails closed.
- `POST /api/simulation/events`: runner token; `{runId,events}`. Returns `{acceptedIds}`. Each event has globally unique ID, monotonic sequence, actor, state, time, correlation ID, summary, and sanitized data. The server deduplicates IDs. Unacknowledged events remain in the SQLite outbox.
- `GET /api/simulation/control?runId=…&after=…`: runner token; `{cursor,commands}`. Commands are pause, resume, stop, set_concurrency (1–2), set_rate (0.1–5), pause_agent, and resume_agent. Applied command IDs survive restart. The standalone benchmark can probe four slots if resource-safe; the site simulation itself is capped at two inference slots and two browser contexts.
- `/mcp`: independent bearer token per member, standard Streamable HTTP. `get_me` must return structured `id` or `user.id` matching the fixture. Tools are discovered, then intersected with a hardcoded member-only allowlist.
- Mutation calls carry `_meta["givetogive/correlationId"]`. The server must persist actor-scoped idempotency outcomes. `get_operation_status({correlationId})` returns `completed`/`succeeded` plus `result`, `failed`, or an unresolved status. An unresolved mutation pauses its member instead of replaying a potentially successful write.

An HTTPS hostname explicitly identifying staging/simulation/sandbox is mandatory; production GiveToGive is rejected regardless of credentials. Cloud inference endpoints, cross-origin MCP redirects, browser administrator routes, and model-supplied identity/privilege fields are rejected.

The host uses the official MCP SDK Web Standard Streamable HTTP transport in stateless JSON mode. Per-member scopes are `member:read`, `asks:write`, `contributions:write`, and `payments:prepare`. Runner tokens grant only `simulation:read` and `simulation:events`; token kinds cannot substitute for one another. Tokens are SHA256-hashed server-side, expire, and are bound to a run, a verified active account, and its current session version. Runner accounts must be the run's administrator/creator. Every request checks the isolated database marker as well as the declared environment.

For Vercel-protected deployments, put `{"vercelProtectionBypass":"REDACTED"}` in an ignored JSON file and set `SIM_PROTECTION_BYPASS_FILE` to its absolute path. The transport attaches `x-vercel-protection-bypass` only to the exact staging origin, including browser requests. Do not put this value in personas, prompts, checked-in configuration, or logs.

## Run, pause, resume, and inspect

Create a run in the staging admin dashboard first, choosing its mode and population. Creation does not start any local process. From the repository root provision that existing run:

```powershell
node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id <runId>
```

The provisioner verifies the isolated staging database, its role and identity marker, the run creator's active administrator account, and the run's population/mode. It writes `tools/simulation/.state/runs/<runId>/credentials.json`, creates distinct synthetic members/tokens and a small Ask fixture spanning all five types for a ten-member run, and grants **zero** paid entitlements. Target tiers are persona goals only. The original baseline file `.state/staging-credentials.json` is preserved. Repeating the command validates/reuses identical credentials without changing existing passwords or extending/reviving tokens. It refuses terminal runs, mismatched accounts, and new members after a run starts. Missing/expired/revoked credentials require a fresh run; no automatic credential rotation occurs.

Then, from `tools/simulation`:

```powershell
$env:SIM_CREDENTIALS = '.state/runs/<runId>/credentials.json'
$env:SIM_PROTECTION_BYPASS_FILE = '.state/protection.json'
$env:SIM_DURATION_SECONDS = '600'
$env:SIM_MAX_CYCLES_PER_AGENT = '3' # Optional acceptance cap; 0 means duration-only.
npm run preflight
npm start
npm run report
```

Use separately provisioned run IDs and matching run-scoped credentials for 10, 25, and 100-user acceptance runs. Run ID, mode and population default to that credential file; changing environment variables does not create another hosted run. Use a 100-member run with `SIM_DURATION_SECONDS=3600` for the one-hour soak. Changing population, seed, or mode requires a new run ID. `Ctrl+C` stops admission, cancels model generation, waits for already-started application calls, checkpoints and marks the run paused; restarting that same interrupted run resumes persisted state. Crashes retain stale-running status and can resume. Administrator Stop and duration completion are terminal: create a fresh run for another experiment. Both the manifest preflight and event ingestion reject reopening a terminal run. Neither stopping nor interrupting the runner kills the shared model server.

The dashboard can pause/resume the entire scheduler or individual members, tune rates, and stop a run. The laptop polls controls and posts durable events; it never exposes an inbound public port. When disconnected, the hosted dashboard must show stale/offline status. A paused or failed member with an unresolved mutation stays blocked until the server reconciles the operation; resuming it checks status before allowing another mutation.

`SIM_MODE=deterministic` runs labeled repeatable read/browser scenarios without local inference. `SIM_MODE=autonomous` uses actual model-selected decisions. A model result is validated before execution. Each cycle executes at most one action; users remain independently scheduled and compete fairly for bounded shared resources. Budget checks reserve the requested amount of prepared Checkouts; they do not falsely claim payment success. Payment completion and financial totals come from hosted Stripe-backed state, not simulator telemetry.

Each member persists its own compact memories, observation, counters, schedule, budget reservation, and pending action in SQLite. Raw hidden reasoning is neither saved nor uploaded. Browser screenshots remain in ignored `.state/screenshots/`; financial/browser regression evidence is separate from model intent traces.

Shutdown drains all telemetry batches, including the final lifecycle event. If the network is unavailable, `npm run sync` delivers the retained outbox without restarting members or reopening a finished experiment. Revoking credentials before syncing prevents that delivery, so sync before retirement. Optional `SIM_MAX_CYCLES_PER_AGENT` caps each member's successful cycles; all reaching the cap completes the run.

## Benchmark and acceptance

```powershell
$env:SIM_MODEL = 'qwen'
$env:SIM_INFERENCE_CONCURRENCY = '2'
$env:SIM_BENCHMARK_ITERATIONS = '12'
npm run benchmark
npm run typecheck
npm test
```

Benchmark with concurrency 1, 2, and 4 only when RAM/VRAM headroom permits. Stop the owned Qwen server before starting Gemma with `npm run model:start -- -Model gemma`. Set `SIM_MODEL=gemma` for its benchmark. Reports under `.state/benchmarks/` record exact configuration, valid structured decisions, task correctness, prompt-injection probes, latency, throughput, CPU, RAM, and GPU. They are not site-interaction tests and must not be described as such.

The first observed Qwen c2 run was **unsuccessful**: all twelve requests timed out at 60 seconds while free RAM reached 0.25 GiB. This exposed resource pressure; the runtime now limits CPU/batch settings, avoids model mmap, and enforces admission headroom. Neither installed models nor this failed run proves the 100-user target. A successful follow-up benchmark and hosted soak must be recorded before claiming readiness.

Follow-up Qwen c1 had adequate initial headroom (4.01 GiB before model startup; over 2 GiB during generation) but all three cases still timed out at 60 seconds, roughly 2 generated tokens/second. A concise Gemma c1 test generated about 3.5 tokens/second but produced no valid structured decision; a further attempt aborted under the memory floor. Read-only diagnostics found AC power, full battery, Turbo power plan, GPU 53°C, software power cap active and only 210 MHz GPU core clock at high utilization. Its reported 590 W power draw is implausible for this laptop; this suggests a driver/sensor/power-state issue but is not a diagnosis. No drivers, power settings or user processes were changed. These are failed feasibility results, not evidence that 100 autonomous agents are ready.

After correcting native tool selection to the installed llama server's supported `tool_choice: "required"`, Gemma produced one correct real `save_ask(42, true)` structured decision in **49.79 seconds** (1/1 valid, approximately 1.2 decisions/minute, 2.56 GiB free RAM). This establishes a narrow actual-inference success, not adequate 100-member throughput or adversarial quality. The server was stopped afterward; no background model is left consuming resources.

A subsequent read-only log/telemetry review found that this successful decision
included two generation rounds (72 + 73 output tokens, about 3.57 tokens/second),
which together explain nearly all 49.79 seconds. The exact first-round validation
failure was not retained; retry overhead is an inference, not a diagnosed cause.
The launcher requests GPU offload, but saved logs do not establish exact tensor
placement. `--load-mode none` means no special loading/mmap, not CPU-only mode.
Idle telemetry also reports the implausible 590 W value with no model loaded, so
that sensor alone cannot establish inference throttling. During browser checks
RAM headroom was only 1.74-2.09 GiB with about 84% commit. No hardware setting or
user application was changed.

That bounded follow-up ran on **2026-09-27 at 21:31 UTC**, with 4.09 GiB free
before loading Gemma. `node scripts/raw-model-probe.mjs gemma` answered a short
arithmetic prompt correctly in **1.64 seconds** (21 input / 2 output tokens,
3.44 output tokens/second). Free RAM stayed above 1.81 GiB during that probe.
The subsequent single community-profile Strands benchmark produced one valid,
correct `save_ask` decision in **49.90 seconds**, again about 1.2 decisions/minute.
It required two model generations (71 + 72 tokens), and free RAM fell to
**0.91 GiB**. The owned model process was stopped; free RAM recovered to 3.31 GiB.
No unrelated process or hardware setting was changed. These two tests confirm
basic local inference and one structured decision, not multi-agent throughput,
prompt-injection resistance, or an autonomous site run. Do not increase
concurrency or attempt the 100-user soak without sufficient headroom and useful
measured throughput. Raw probe results and benchmark JSON remain in ignored
`.state/benchmarks/`.

Follow-up instrumentation now records only assistant-turn counts, schema-failure
counts and allowlisted invalid field names, so the next probe can distinguish
validation retries without retaining prompts, model arguments or hidden reasoning.
Raw agent transcripts are cleared immediately after each decision, including
failures. A streamed SDK fixture verifies the retry counters and redaction; this
does not retrospectively establish why the two measured Gemma calls needed retries.
The installed server's `--list-devices` reports CUDA0 as the RTX 4070 Laptop GPU;
that confirms backend availability, not the tensor placement of an earlier run.

Completion evidence requires 100 accounts, every account performing at least three valid observe/decide/act cycles and one authenticated action, a one-hour autonomous run, tier-crossing interactions, all Ask types, all three money flows, browser-console/server checks, pause/resume and restart tests, no credential/account leaks, and reconciled financial invariants. This package's deterministic tests verify orchestration safety only; hosted payment/browser tests remain mandatory.

### Verified protected-staging smoke (2026-09-27 UTC)

Run `sim-smoke-deterministic-20260926-b` completed cleanly in 49.1 seconds: ten independently authenticated synthetic members, three deterministic cycles each (`get_me`, `search_asks`, authenticated `/asks` browser visit), 30 completed actions, zero member failures, and all 200 telemetry records acknowledged. Browser concurrency peaked at two; every browser visit waited for the noticeboard to finish loading and rejected browser-console/page errors. Final hosted status was completed with 30 cycles/actions and a final heartbeat at `02:32:23.311Z`. Inference was disabled for this test. All eleven run-scoped tokens were revoked/expired after evidence sync, retaining immutable history.

Earlier run `sim-smoke-deterministic-20260926-a` found and reproduced null-session and strict-label browser issues; both were fixed. Its interrupted processes resumed from two saved cycles/member, received ten resume-member commands, and ultimately reached three cycles each. Failed-attempt history was retained, not erased. A separate authenticated MCP probe on that same run verified duplicate same-correlation save requests produced exactly one authoritative completed `save_ask` audit; a second member could not read that operation and a forged actor field was rejected. Financial tools remained unavailable. That run's eleven tokens were also revoked/expired.

Local package typecheck and 28 tests pass, including actual Strands/MCP protocol fixtures, redacted retry diagnostics and transcript disposal, account-state isolation, target/configuration guards, provisioning identity validation, null-session regression, bounded concurrency, a 205-event multibatch shutdown flush, fixed sandbox scenario contracts, private-tool filtering, durable payment budgets, and explicit clock-cohort opt-in. The new Checkout tests use injected drivers/provider outcomes, not actual Stripe pages. These results are not the still-required 100-member autonomous soak, supporter-tier sandbox interactions, or payment acceptance.

## Controlled Stripe sandbox browser lane

The ordinary member browser remains same-origin. `sandbox:checkout` is a **separate, serial operator harness**, not an autonomous model tool and not a provider load test. It requires the exact protected `https://givetogive-staging.vercel.app` origin, matching isolated database marker, active run-scoped synthetic credentials, a deployment-protection secret, and configured **test** payments. The server independently retrieves each Checkout session and verifies its real `livemode=false`, customer-account ownership, operation/run binding, amount, currency and exact return URLs before releasing its private hosted URL. Success requires the actual provider PaymentIntent, a processed signed webhook, a paid database row and ledger evidence. A redirect or simulator claim never grants entitlement.

Only these fixed scenarios exist: `success`, `decline`, `three_ds_success`, `three_ds_failure`, and `cancel`. Card values are fixed official public Stripe test fixtures inside the dedicated driver; there is no arbitrary PAN, URL or card input in plans or model context. No payment browser screenshots, traces, videos, HARs, console bodies or raw provider errors are recorded. Playwright debug modes are refused. The protection bypass is sent only to the exact staging origin, never Stripe. The driver restricts top-level navigation to the verified Checkout and its own return page and blocks unrelated hosts.

Create a local ignored `.state/sandbox-plan.json` using the template below. Replace the run/agent IDs with the provisioned fixture, and generate a **stable, unique UUID per logical operation**. Set explicit amount caps and run/member budgets in cents. Do not place credentials in this plan. Supporter is $5/month and Sustainer $15/month in the current specification; the server still verifies actual provider/catalog amounts.

```json
{
  "runId": "YOUR_ACTIVE_RUN_ID",
  "runBudgetCents": 3000,
  "actorBudgetCents": 2000,
  "steps": [
    {
      "operationId": "11111111-1111-4111-8111-111111111111",
      "agentId": "YOUR_SUPPORTER_AGENT_ID",
      "scenario": "success",
      "maximumAmountCents": 500,
      "expectedTier": "supporter",
      "checkout": { "kind": "supporter", "tier": "supporter" }
    },
    {
      "operationId": "22222222-2222-4222-8222-222222222222",
      "agentId": "YOUR_SUSTAINER_AGENT_ID",
      "scenario": "three_ds_success",
      "maximumAmountCents": 1500,
      "expectedTier": "sustainer",
      "checkout": { "kind": "supporter", "tier": "sustainer" }
    }
  ]
}
```

Ask steps use `{"kind":"ask","askId":123,"grossAmount":500}`; fund steps use `{"kind":"fund","fundId":"UUID","grossAmount":500,"recurring":false}` (or true for recurring). Recipients/catalogs must first be genuinely configured in the sandbox. Provisioning does not manufacture paid tiers or pretend recipient readiness. Keep one Neighbor unpaid; verify Supporter and Sustainer only after signed events. Then run all five fixed browser outcomes across independently authenticated accounts, direct Asks and one-time/recurring funds, followed by authenticated cross-tier member interactions using the normal runtime. Run financial browser scenarios serially; do not drive all 100 actors through Stripe simultaneously.

From `tools/simulation`, with the same `SIM_CREDENTIALS` and `SIM_PROTECTION_BYPASS_FILE` setup as above:

```powershell
npm run sandbox:checkout -- --plan .state/sandbox-plan.json # local validation only; no provider contact
$env:SIM_SANDBOX_CHECKOUT_ENABLED = '1'
npm run sandbox:checkout -- --plan .state/sandbox-plan.json --execute
# Read-only provider reconciliation after an ambiguous browser result; never clicks Pay again:
npm run sandbox:checkout -- --plan .state/sandbox-plan.json --reconcile
```

`sandbox-checkout.sqlite` durably reserves every admitted amount, including declined, canceled and ambiguous attempts. Crashes after admission never authorize a second submit. Execution refuses any previously admitted operation; reconcile it, then remove completed steps from the next reviewed plan while preserving this ledger. Budgets continue counting prior reservations. Never delete the ledger or invent a new operation merely because a provider response was ambiguous. Cancellation proves only an unpaid/abandoned Checkout, not immediate reservation release or a refund; hosted expiry/reconciliation handles release separately.

**Verification boundary:** 27 local tests and four server policy tests pass; the eight dedicated-CI MCP database tests still pass, including denial of clock scope to ordinary runner tokens. Actual Stripe Checkout DOM selectors (especially the 3DS challenge), real decline/error mappings, subscription initial-invoice handling, signed-webhook convergence, provider test clocks and tier-crossing paid interactions remain **unverified until sandbox credentials are supplied and these commands actually run**. No card was submitted and no provider object was created while implementing this lane.

## Small billing-clock cohorts

Test clocks are opt-in, separate experiments of **one to three deterministic synthetic members**, never the 100-user baseline. Create a fresh small run in the admin dashboard, then provision from the repository root:

```powershell
node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id <tinyRunId> --clock-cohort
```

This explicitly grants only that new runner `simulation:clock`, retains an audit of the grant, and writes `clockControl:true` in its ignored credential file. Existing normal credentials cannot be upgraded or repurposed with this flag. Member tokens retain their ordinary `payments:prepare` scope; they can only bind their **own** synthetic account to their run's already-created named clock. Creation and advancement are runner-only HTTP controls and are not model tools.

Set `SIM_CREDENTIALS` to the tiny run's file and `SIM_SANDBOX_CHECKOUT_ENABLED=1`, then:

```powershell
npm run sandbox:clock -- create
npm run sandbox:clock -- bind
npm run sandbox:clock -- read
# After initial real test Checkouts succeed, advance to a reviewed future timestamp:
npm run sandbox:clock -- advance --operation-id <stable-UUID> --to 2026-10-28T00:00:00Z
```

The clock is named exactly `givetogive:<runId>`. Accounts v2 customer configuration binds `test_clock` **at creation**; an already-created unbound or differently bound account is rejected, never silently replaced. Prepare initial Checkouts only after binding. Advance by at most 32 days per operation and 366 days per cohort; wait for provider `ready`, then separately verify signed invoice events and paid-through entitlement. A ready clock is not a successful renewal assertion. Stable operation records and Stripe idempotency protect retries; ambiguous requests older than the safe provider retry window require operator reconciliation. Automatic clock deletion is deliberately absent because Stripe deletes associated customer/subscription history. Retain named cohorts for diagnosis, and explicitly review their later retirement.

Clock acceptance still needs real-provider runs for renewal, failed renewal, recovery, upgrade/downgrade and period-end cancellation. Some billing transitions require the site's own billing UI/API or a deliberate Stripe Dashboard sandbox operation; this harness does not fabricate them by editing entitlement rows. Check tax obligations/registrations before enabling automatic tax or live billing; the harness does not alter tax configuration.

## Hosted safety verification

From the repository root, after provisioning the dedicated CI database:

```powershell
node --test tests/unit/simulation-policy.test.ts tests/unit/mcp-transport.test.ts tests/unit/simulation-checkout.test.ts
node --env-file=.env.ci.local --import ./tests/integration/server-context.mjs --import tsx --test tests/integration/simulation-database.test.ts
```

The database suite hard-checks `APP_ENV=test`, the URL database name, `current_database()`, and `current_user` against the dedicated CI database. Its eight tests cover origin/kind/scope checks, token expiry and revocation, account freezing/session rotation, five concurrent retries producing one committed domain effect, rollback with a durable failure result, actor-owned reconciliation, transaction-time permission changes, telemetry deduplication/ordering/redaction, terminal lifecycle, strict tool schemas, and actual Ask ownership through the MCP transport. Five concurrent `create_ask` requests exercise the real tRPC business logic and its transaction-aware authorization without exhausting the five-connection pool. Its test loader only neutralizes Next's `server-only` bundler marker in Node; application/environment/auth guards stay enabled.

Concurrent transaction tests necessarily commit CI-only synthetic fixtures. Immutable operational history is never disabled or deleted: after each suite, its exact tokens are revoked/expired, its exact synthetic users frozen/session-rotated, and its run marked completed. Audit records remain in CI. The initial failed fixture `ci-mcp-5b178b9f-e6a5-4f0f-8608-dce6b9adf02b` was retired using the same policy. No production or staging rows are touched by this suite.

Sources: [Strands OpenAI-compatible provider](https://strandsagents.com/docs/user-guide/sdk/model-providers/openai/), [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [Qwen GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF), [Gemma QAT GGUF](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf).

Payment harness sources: [Stripe test fixtures and testing limits](https://docs.stripe.com/testing), [retrieving authoritative Checkout sessions](https://docs.stripe.com/api/checkout/sessions/retrieve), [billing test clocks](https://docs.stripe.com/billing/testing/test-clocks), [test-clock advanced usage](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage).
