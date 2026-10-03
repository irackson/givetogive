# Payments and simulation operator runbook

This is a gated implementation, not authorization to accept live money. Track
completion in [the acceptance contract](payments-implementation-plan.md).
The existing public release and its PDF remain the earlier non-payment baseline
until a verified deployment explicitly replaces them.

## Environments and isolation

| Environment | Database and role | Application |
| --- | --- | --- |
| Production baseline | Existing root `.env.local` connection | `https://givetogive.vercel.app` |
| Synthetic staging | `givetogive_staging_20260926` | Dedicated `givetogive-staging` Vercel project |
| Isolated integration CI | `givetogive_ci_20260926` | Node integration tests/local browser server |

Laptop and Codex Cloud are alternative development machines, not two kinds of
CI. Cloud development uses coherent Development/staging settings; automated
integration suites use the separate CI database. No GitHub Actions workflow is
currently configured. See [Cloud setup](codex-cloud.md) for separate startup and
test environments, including inherited-environment precedence and shared-data
concurrency safeguards.

Staging and CI were created empty, not cloned from real member data. They have
separate credentials, identity markers and non-inheriting roles without role,
database or superuser creation privileges. `node scripts/verify-isolation.mjs`
checks both markers and verifies that their roles cannot read or modify
production application tables; the probe never reads production member rows.

The root `.env.local` remains production-like. Do not use `npm run dev`, default
database scripts or ad-hoc SQL with that file for synthetic testing. Use:

```powershell
npm run dev:staging
# Or verify the actual production build locally:
npm run build:staging
npm run start:staging
```

The wrappers use port 3010 and change only the local server's canonical origin.
Hosted builds retain the staging HTTPS origin. The simulator deliberately rejects
localhost and production as its hosted target; local UI testing is distinct.

Staging uses Vercel access protection for **all deployment URLs**. Standard
protection was insufficient because it excludes the canonical staging alias;
the verified setting is `ssoProtection.deploymentType=all`. An unauthenticated
request must redirect to Vercel sign-in. The automation bypass is in the
ignored `tools/simulation/.state/protection.json`; never put it into chat,
screenshots, personas, source or public URLs. Inject the header only to the
exact staging origin. A Stripe webhook on a protected deployment needs a
secret bypass query configured in Stripe; treat the whole endpoint URL as a
secret and redact it from logs. Do not disable protection as a workaround.

## Credentials and enablement

Authenticate the local Stripe CLI interactively (`npx @stripe/cli login`). Use
distinct Stripe sandboxes for staging simulation and CI. The connected Stripe
chat tool does not automatically provide a usable server-side API key. Store
keys in ignored local environment files and Vercel sensitive environment values,
never in prompts or checked-in JSON.

Historical September 27 checkpoint: the CLI was reauthorized and selected to the
**GiveToGive CI** sandbox; a read-only balance check confirmed test mode and zero
balances. The Development sandbox exists but was not included in that CLI
authorization. The original account is still authorized but is not active.
CLI authorization is not application setup. **October 2 update:** Development's
rotated application test key, catalog/portal mappings and three independent
webhook signing secrets are installed in protected staging. Standard test-key
use does not establish restricted-key acceptance. During Ian's explicit goal
pause, existing Dashboard credentials were retrieved without logging secret
values or creating new keys. Development's publishable test key is now installed
in `.env.staging.local` and as a sensitive variable in the protected staging
project (production/preview scopes of that staging project, not public production).
The October 3 READY protected deployment includes that public test key. CI's existing
standard application test key and matching publishable key are installed only
in `.env.ci.local`; provider account and test-mode balance reads verified its
separate CI sandbox. No gates, production configuration, Cloud
environment, or deployment were changed by this credential setup. Ordinary Cloud
development should continue using the matched Development configuration.
Recheck `stripe whoami --format json` and the selected sandbox before provider
work; never dump CLI configuration or copy CLI-managed credentials into the app.

Required payment configuration includes the test secret/publishable keys,
platform account ID, snapshot and v2 webhook signing secrets, portal configuration,
Supporter/Sustainer price IDs, and explicitly verified processing-fee parameters.
The quote deducts 5% of gross plus the configured processing estimate; actual
Stripe cost variance belongs to the platform. A quote is frozen per payment.

`PAYMENTS_ENABLED`, `SUPPORTERS_ENABLED` and `FUNDS_ENABLED` are independent.
Only protected staging's test-mode `SUPPORTERS_ENABLED` is currently true;
Ask and fund sales remain false. Public production gates remain disabled.
Production additionally requires live credentials and
`STRIPE_LIVE_APPROVED=true`; test credentials fail closed there. Never treat
these flags as a replacement for business eligibility, Connect verification,
tax review, operational readiness, or explicit approval to go live.

The initial offering is USD/US recipients, Neighbor free, Supporter $5/month,
Sustainer $15/month. No real-money test purchases. No claim of charitable tax
deductibility. No wallets, escrow, lending, cross-border or annual plans.

## Administrator identity and authentication

The seeded staging administrator is explicitly synthetic and is not Ian.
Do not grant Ian access by guessing an email or interpreting a display name.
Bootstrap only an unambiguously selected, verified existing account, record the
administrative role change, and enroll Ian's own authenticator through the UI.
No real administrator bootstrap or MFA enrollment has been claimed complete.

Production financial administration requires a recent sign-in/password check
and a fresh, single-use TOTP to mint elevation. The resulting authorization token
can authorize multiple actions for five minutes; it is kept in browser
memory only, and is invalidated by session-version rotation. Enrollment secrets
are encrypted server-side, excluded from audits, and never included in a PDF.
Freezing an account and revoking sessions/tokens must be verified separately.

Staging/test email always goes to an encrypted private sink. It never sends
external mail or exposes reset/verification links publicly, even if unrelated
mail-provider settings happen to exist in the parent environment.

## Migration and deployment procedure

Migrations 0011-0018 are additive: operational/security/payment storage,
immutable balanced journals, badge preference, bounded request telemetry,
paid entitlement coverage, reversible dispute capacity holds, supporter changes
and immutable application evidence. See [the migration review](payments-migration-review.md)
for observed production metadata, line-ending checksum differences and remaining
backup/rehearsal/deployment gates. Production has not been migrated.

```powershell
node --env-file=.env.ci.local scripts/migrate-isolated.mjs
node --env-file=.env.staging.local scripts/migrate-isolated.mjs
npm run test:unit
npm run test:integration
npm run lint
npm run build:staging
```

The isolated migrator rejects production and verifies the exact role/database.
Production migration is a separate reviewed operation: take a recoverable
snapshot/backup, verify the migration history and deployment SHA, apply additive
changes before deploying code that queries new columns, and retain all payment
flags disabled. Do not run `db:push` or drop payment/audit records to resolve a
migration issue. Rolling code back does not justify deleting the ledger.

For staging, explicitly select Vercel project
`prj_HvlFV1kKHVsML73nlsJAFQNA7grP`; the repository's `.vercel/project.json`
continues to reference production. Inspect `vercel deploy --dry --json --project
<staging-project-id>` before upload. `.vercelignore` excludes environment files,
local models, credentials, browser artifacts and unrelated generated files.
`--prod` with this explicit staging project means its canonical staging alias,
not the GiveToGive production project.

Verification must include protected hosted pages, authentication, MCP/telemetry,
webhooks and durable workflow execution, not merely a READY deployment status.
Do not push a main commit that auto-deploys incompatible database code.

## Recovery and financial truth

Only authoritative Stripe state can complete a payment. Redirects, model claims,
seed labels and manual pledge updates are not payment evidence. Legacy money
pledges stay separate. Reservations and open-dispute holds prevent Ask overfill.
Supporter recognition requires verified paid coverage and an explicit public
badge preference; tier labels never imply aid priority or identity verification.

Webhook intake verifies signatures and stores a durable inbox before processing.
Payment operations use stable IDs and idempotency keys; ambiguous outcomes remain
reserved/recoverable. Database transactions do not span Stripe network calls.
Every ledger journal balances in integer cents, is immutable, and uses
compensating entries for reversals. Application-fee, recipient and processing
amounts are separate. Fund intake is fee-bearing; allocations do not charge the
giving fee a second time.

Hosted Vercel Workflows handle immediate events, refunds and allocations. The
reservation workflow checks after 36 minutes and again a day later. The current
Hobby-compatible fallback cron runs daily at 07:00 UTC. This is **not** a
five-minute sweep SLA; persistently failed work remains visible to operators.
Review production hosting eligibility and required recovery frequency before
live launch. No paid plan upgrade is performed automatically.

Each fallback execution drains up to 20 bounded batches with fair retry ordering;
one poisoned oldest batch cannot permanently starve later eligible work.

To inspect a staging workflow from this production-linked checkout, set
`WORKFLOW_VERCEL_PROJECT_NAME=givetogive-staging` and pass both the staging
project ID and team ID to `workflow inspect run ... --backend vercel --project
prj_HvlFV1kKHVsML73nlsJAFQNA7grP --team team_TXid48wU77cfhEg28L3EyLpn --env
production --json`. The installed Workflow CLI otherwise re-infers the linked
production project when its project-name environment value is missing, even
with an explicit project argument. Do not relink the checkout to work around it.
`tests/e2e/hosted-recovery.spec.ts` encapsulates this metadata-only inspection;
enable it with `HOSTED_RECOVERY_SMOKE=1` only while staging financial queues are
genuinely empty. It proves hosted execution, not a Stripe payment lifecycle.

Check the operations section of `/admin/payments`, payment histories, Stripe IDs and ledger journals
before retrying. An allocation whose source is refunded/disputed mid-flight may
remain `recovery_required` rather than claiming a successful transfer. A settled
destination payment with no verified recipient transfer is an explicit recovery
case, not delivered help. Resolve these against actual Stripe records; never
manually mark them paid to clear a queue.

Partial Supporter refunds retain remaining verified paid coverage; full refunds
or disputes revoke it. A zero-paid credit invoice is not sufficient evidence to
grant a higher tier automatically. Cancellation preserves already paid-through
recognition while removing the subscription from forward-looking active MRR.

### Supporter coverage backfill and cutover preflight

`scripts/supporter-coverage-preflight.ts` is an operator-shell command, **not** an
HTTP/MCP endpoint or a request-time history scan. Run it before recognition
cutover for existing paid subscriptions. It defaults to a read-only audit and
rejects production even in dry-run. Both modes verify the exact isolated
database/role/identity, test credentials, the key's actual platform account,
and an explicitly selected verified, unfrozen synthetic administrator. Keep
application keys in ignored environment files; a read-only restricted key is
sufficient for its Stripe calls.

```powershell
# Default: at most 10 local subscriptions, 12 paid invoices per subscription.
node --env-file=.env.staging.local --conditions=react-server --import tsx scripts/supporter-coverage-preflight.ts --operator synthetic-stage-admin

# Apply only after reviewing dry-run; use the exact identity from your private env.
node --env-file=.env.staging.local --conditions=react-server --import tsx scripts/supporter-coverage-preflight.ts --operator synthetic-stage-admin --apply --confirm-identity <DATABASE_IDENTITY>

# Resume an explicitly reported bounded scope. These are partial audits, not all-clear.
node --env-file=.env.staging.local --conditions=react-server --import tsx scripts/supporter-coverage-preflight.ts --operator synthetic-stage-admin --after-subscription <nextSubscriptionCursor>
node --env-file=.env.staging.local --conditions=react-server --import tsx scripts/supporter-coverage-preflight.ts --operator synthetic-stage-admin --subscription <subscriptionId> --invoice-after <nextInvoiceCursor>
```

Optional `--subscriptions` is capped at 20; `--invoices` at 50. Every invoice
is limited to one page of 100 lines, two invoice-payment records and one
PaymentIntent/expanded charge. No autopagination occurs. The run has a 400-read
and ten-minute provider budget, five-second requests, and no automatic network
retries. Authoritative time may additionally perform the two bounded reads for
an already-bound tiny test-clock member. Unresolved/truncated pages retain
their IDs/cursors for review; never increase a limit by editing the code.

The audit follows actual subscription/account/invoice/payment/charge IDs and
requires an already-settled local payment with its immutable settlement journal.
It does not create payment, journal, subscription or customer records. Missing
local settlement must first be handled by normal financial reconciliation.
Positive actual invoice lines supply the historical price and exact start/end;
today's subscription tier and the legacy paid-through summary are not proof.
Every historical proration needs stored, authenticated applied-event evidence.
Missing evidence remains `unresolved_missing_application_evidence`; this tool
does not search arbitrary events, manufacture proof, or retroactively grant a
higher tier. Zero-credit/split-payment/unknown-price shapes remain unresolved.
Refund drift requires normal reconciliation; full refunds/disputes are excluded.

Apply writes only verified eligible coverage, the derived paid-through summary
and an operator audit entry, with local eligibility/ownership rechecked inside
the transaction. It never changes Stripe or directly edits a member's tier.
Retries are idempotent; conflicting provenance rolls back. Partial valid work
can be applied while other invoices remain explicitly unresolved.

Exit 1 means setup/authorization failed safely; exit 2 means work is unresolved,
backfill is required or the scan is partial; exit 0 means only that this complete
isolated local scope passed at the reported observation time. `selectedPageReady`
never means the remaining pages are ready. `cutoverReady` requires an initial,
unfiltered, untruncated scan with no unresolved/backfill-required result. After
working through cursors, repeat an initial complete audit (or review all bounded
reports for a larger cohort); a partial audit cannot certify the whole cohort.
Neither exit 0 nor this test-only command authorizes production deployment or
live payments. Review subscription tax treatment and active registration before
live Billing; automatic tax is still disabled.

### Operator reviews and payment pauses

`/admin/payments` exposes per-Ask pause/resume and recovery-case review dialogs.
Both require current verified administrator authority (plus live elevation in
production), a private reason/note, and a stable operation ID. Ask controls use
the same row lock as new payment/allocation reservations and reject stale state.
Pausing does not expire a Checkout that was already open and cannot stop its
eventual settlement. Refunds, disputes and authoritative recovery continue.

Case acknowledgement/escalation is append-only operator context. It never clears
`resolved_at`, releases money or marks a payment paid. Operators must reconcile
against provider records; there is deliberately no manual financial-success
button. Private histories retain pagination and redact sensitive note content.

### Explicit customer-portal policy

`STRIPE_PORTAL_CONFIGURATION_ID` must identify an active configuration in the
current mode. The server verifies it before creating a portal session: invoice
history and payment-method updates enabled, cancellation at period end with no
proration, and subscription updates disabled. No default-config fallback is
allowed. An incompatible policy fails closed before customer creation.

Supporter and Sustainer are separate products. Stripe's portal same-product
period-end downgrade option cannot enforce this cross-product requirement.
Dedicated paid-upgrade, scheduled-downgrade, cancel/resume and undo services are
implemented and pass isolated PostgreSQL/provider-stub regressions. Actual paid
sandbox lifecycle acceptance remains outstanding. Keep portal plan changes off:
the dedicated services, not that portal policy, enforce the product requirement.
Review applicable subscription tax treatment/registration before live billing;
automatic tax remains disabled and is not represented as configured.

### Controlled payment and clock test lanes

The local sandbox harness is separate from model tools and general browsing.
It accepts only server-attested owned test sessions for the exact protected
staging origin, reserves finite budgets durably, runs serially, and never
resubmits an ambiguous payment attempt. Its reconciliation command only reads
authoritative outcomes. Success requires the provider result and processed
signed webhook/ledger evidence, not the return page.

An explicitly provisioned deterministic cohort of one to three members may
receive a narrowly scoped clock runner token. Clock creation/read/advance uses
durable IDs, strict run ownership, bounded forward jumps and no delete action.
Members bind their own fresh Accounts v2 customer identity before Checkout;
existing customers cannot be silently moved to a clock. The normal 100-agent
cohort has no clock-control scope. See [the simulation guide](simulation.md) for
commands and pending real-provider acceptance; passing policy tests is not a
successful Stripe purchase or renewal.

## Analytics definitions

- Giving excludes supporter subscriptions and legacy pledges. Net verified gifts
  deduct confirmed recipient refunds and disputed value, not merely requested
  refunds. This is not a platform cash-balance or recipient bank-payout metric.
- Supporter MRR uses active, paid-through, non-canceling supporter subscriptions
  only. Community-fund subscriptions do not inflate it.
- The daily giving series groups current net values by original payment date in
  UTC; it is not a historical cash-flow ledger.
- Checkout conversion retains its created-session denominator and time bounds.
  A zero denominator is shown as unavailable, not a fabricated percentage.
- Request latency measures actual top-level tRPC duration, excluding metrics
  writes, admin polling, Auth.js and internal MCP transactions. Missing latency
  is null, not zero. Aggregate telemetry contains no request payloads or secrets.
- Simulation telemetry describes attempts and states. Financial totals always
  come from authoritative payment records, never agent-reported success.

## Required next validation

Complete actual sandbox onboarding, each Checkout tier/path, 3DS/decline/abandon,
renewal and test-clock cases, duplicate/out-of-order webhook delivery, transfer
and payout failures, partial/full refunds, disputes and crash reconciliation.
Mocked adapters, synthetic signed events and database race tests must be reported
separately from genuine Stripe sandbox tests.

Run the local model benchmarks and then the 10/25/100-agent progression described
in [the simulation guide](simulation.md). An installed model or 100 provisioned
accounts does not prove 100-agent autonomous acceptance. Preserve the user's
applications; never kill them to manufacture a successful benchmark.

Sources: [Vercel automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
