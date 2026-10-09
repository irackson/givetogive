# GiveToGive

GiveToGive is a community mutual-aid application for publishing requests and
connecting people who need help with people who can offer it.

The current application supports Discord and verified email/password
authentication, password reset, creating and filtering typed Asks, private saved
Asks, member profiles, and multiple partial contributions toward each Ask goal.
Contributors and Ask owners can record completion; contributors can cancel
their own pledges. Both changes appear in activity history. PostgreSQL
persistence is handled through Drizzle ORM.
The published baseline records off-platform money pledges. The current working
implementation adds gated Stripe payments, supporter billing, community funds,
administration, and a local multi-agent simulator. It is **not a completed
live-money release**: sandbox end-to-end validation and operator prerequisites
are still required. Legacy pledges are never presented as processed payments.
See [the implementation contract](docs/payments-implementation-plan.md) and
[the payments runbook](docs/payments-runbook.md) for acceptance and live gates.

## Requirements

- Node.js 24.x (the repo currently pins 24.19.0 in `.nvmrc`)
- npm 10.8.3
- A PostgreSQL database
- Discord OAuth credentials

## Local setup

1. Install the locked dependencies:

    ```bash
    npm ci
    ```

2. Create `.env.local` with the variables validated in `src/env.ts`:

    ```dotenv
    DATABASE_DATABASE=
    DATABASE_USER=
    DATABASE_PASSWORD=
    DATABASE_HOST=
    DATABASE_URL=
    NEXTAUTH_SECRET=
    NEXTAUTH_URL=http://localhost:3000
    DISCORD_CLIENT_ID=
    DISCORD_CLIENT_SECRET=

    # Gmail OAuth is the primary verification/reset email transport.
    GOOGLE_CLIENT_ID=
    GOOGLE_CLIENT_SECRET=
    GOOGLE_REFRESH_TOKEN=
    GMAIL_SENDER="GiveToGive <hello@example.com>"

    # Optional Resend fallback when Gmail OAuth is not configured.
    # Without either transport, development displays one-time preview links.
    RESEND_API_KEY=
    AUTH_EMAIL_FROM="GiveToGive <hello@example.com>"
    ```

3. Start the development server:

    ```bash
    npm run dev
    ```

4. Open [http://localhost:3000](http://localhost:3000).

## Useful commands

| Command               | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Start the Next.js development server           |
| `npm run build`       | Create and type-check a production build       |
| `npm run lint`        | Run ESLint                                     |
| `npm test`            | Run unit tests and Playwright end-to-end tests |
| `npm run test:unit`   | Run filter, callback and lifecycle unit tests  |
| `npm run test:integration` | Run database/concurrency tests against isolated CI only |
| `npm run dev:staging` | Develop against the isolated synthetic stage on port 3010 |
| `npm run build:staging` | Build using isolated stage settings |
| `npm run start:staging` | Serve that production build locally on port 3010 |
| `npm run test:e2e`    | Run the Playwright browser/API suite           |
| `npm run db:generate` | Generate a Drizzle migration                   |
| `npm run db:migrate`  | Apply pending database migrations              |
| `npm run db:push`     | Push the current schema directly               |
| `npm run db:seed`     | Add idempotent sample users and Asks           |
| `npm run db:studio`   | Open Drizzle Studio                            |

`db:seed`, `db:migrate`, and `db:push` modify the database configured in
`.env.local`. Confirm that connection before running them.

`npm run test:integration` loads `.env.ci.local`, verifies the exact restricted
CI database/role and environment marker, and runs files serially. Its CI-only
preload blocks `fetch` and Node HTTP/HTTPS clients; provider interactions in
these database tests must be stubbed. This is application regression coverage,
not actual Stripe sandbox or email-delivery acceptance. Do not import that
preload into the separate real-provider/mailbox acceptance tools.

## End-to-end tests

`npm test` first runs unit tests, then starts a local Next.js server on port
3100 and runs Chromium tests. Coverage includes public routes, authentication,
typed Ask creation, partial contributions, completion/cancellation, concurrent
pledges, ownership rules, URL filters, private saves, profile editing, history
pagination, and one-time password-reset tokens.

Browser tests require `.env.ci.local` or explicitly loaded `.env.staging.local`.
They reject the root production-like connection, verify the exact isolated
database/role/marker, and never fall back to `.env.local`. Staging/test emails
are encrypted in a private sink; only the trusted test runner decrypts their
one-time verification/reset links. These URLs are not exposed to browsers or
public APIs, including when testing a production build.

To run the release browser/API checks against an existing deployment, set
`PLAYWRIGHT_BASE_URL` to the **isolated staging** URL. This disables the automatic
local server. Explicitly load its matching environment before Playwright:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3010'
node --env-file=.env.staging.local node_modules/@playwright/test/cli.js test
```

These tests make real synthetic writes and clean up their exact generated
identities. Financial and MCP integration audit records are immutable: their
CI fixtures are retired, not erased. Raw browser traces/videos are disabled
because they could retain passwords, authentication links, and TOTP secrets.
Never aim this harness at the production site.

## Current routes

- `/` - home and authentication status
- `/signin` - email/password and Discord sign-in
- `/signout` - branded confirmation, cancellation, and signed-out state
- `/auth-error` - generic authentication recovery
- `/signup` - create an email/password account
- `/forgot-password` - request a password reset
- `/reset-password` - finish a password reset from a tokenized link
- `/verify-email` - verify an email or request a replacement link
- `/asks` - browse/search/filter typed Asks, save them, and open creation
- `/asks?saved=1` - the signed-in member's private saved list
- `/asks/[slugOrId]` - view progress/activity, offer help, and manage contributions
- `/members` - redirect to the signed-in member's profile, or sign-in
- `/members/[id]` - public profile, owner editing, and paginated contribution history
- `/api/auth/[...nextauth]` - Auth.js handlers
- `/api/trpc/[trpc]` - tRPC API handler
- `/giving`, `/giving/[id]` - own verified gifts, pending states, receipts
- `/support`, `/account/billing` - supporter plans and recurring commitments
- `/funds`, `/funds/[slug]` - community fund information and public allocations
- `/account/receiving` - recipient readiness and gated Stripe onboarding
- `/account/security` - authenticator setup, sensitive-action elevation, session revocation
- `/admin/*` - role-protected analytics, activity, members, payments, funds, operations and simulations
- `/mcp` - versioned, scoped, staging-only member tools
- `/api/simulation/*` - authenticated runner manifest, telemetry and control
- `/api/stripe/*` - webhook intake and authenticated recovery

## Ask and contribution model

Every Ask has a type (`time`, `task`, `item`, `money`, or `resource`), a
positive goal, a difficulty from 1 to 5, and an estimated completion time.
Monetary amounts are stored as integer minor units (for example, cents).

Contributions belong to one Ask and one authenticated user. Owners cannot
contribute to their own Ask. Multiple people can pledge partial amounts, with
database locking preventing concurrent pledges from overfilling the goal.

A pledge reserves capacity but does not mean help has been delivered:

- `not_started`: no active contributions.
- `in_progress`: at least one active contribution, but completed help is below the goal.
- `complete`: completed contributions reach the goal.

Either the contributor or the Ask owner can mark a pledge completed; only the
contributor can cancel their own pledge. Cancellation releases capacity;
completed and cancelled entries are terminal records. Owners can update the title, description, difficulty, time
estimate, and goal; the URL stays stable, and a goal cannot be lowered below
active contributions. Raising a fulfilled goal reopens the Ask. Activity records
capture creation, edits, offers, completion, and cancellation.

Profiles show completed contributions publicly and all statuses to their owner.
Email confirmation is an account signal, not identity verification. Unknown
legacy join dates are left blank. The legacy single `fulfilled_by` column
remains only for migration compatibility and is not used by the workflow.

See [the capability outline](docs/feature-outline.md) for the release's
feature-by-feature provenance, routes, and intentional limits.

## Release walkthrough

See [the release report](docs/release-report.md) for verification evidence and
the current production deployment. The published-site PDF is generated from
real browser captures, including mobile views and open dialogs.

With the target database deliberately selected, set `PLAYWRIGHT_BASE_URL`
to the isolated staging site and `WALKTHROUGH_CAPTURE=1`, then run:

```bash
npx playwright test tests/e2e/walkthrough.spec.ts
python scripts/build-walkthrough.py
```

The existing PDF describes the earlier published baseline, not proof that new
Stripe flows passed. Updated payment screenshots must be labeled with their
actual environment and distinguish unconfigured, sandbox and live behavior.

For the current payments work, read [measured verification](docs/payments-verification.md),
[feature provenance](docs/payments-feature-outline.md), and the
[acceptance checklist](docs/payments-implementation-plan.md). These distinguish
implemented code, genuine hosted checks, provider-stub tests, and unfinished
Stripe/autonomous-simulation acceptance.

Generate the separate, explicitly partial staging walkthrough with the isolated
staging environment loaded, `PLAYWRIGHT_BASE_URL` set to the protected staging
origin, and `PAYMENTS_WALKTHROUGH_CAPTURE=1`:

```powershell
node --env-file=.env.staging.local node_modules/@playwright/test/cli.js test tests/e2e/payments-walkthrough.spec.ts
python scripts/build-payments-walkthrough.py
```

The output is `output/pdf/givetogive-payments-staging-walkthrough.pdf`. It does
not overwrite or claim to supersede the prior published-site guide.

## Simulated community

See [the simulation guide](docs/simulation.md). One local model serves 100
independently scheduled Strands agents with separate accounts and checkpoints;
100 agents do not mean 100 model copies or simultaneous GPU generations.
Benchmarks and the hosted 100-agent soak are separate acceptance gates. No paid
model fallback, production targeting, or fabricated paid tiers is permitted.

The PDF builder needs `reportlab` and `Pillow`. It rejects incomplete captures
or captures with reported errors/unfinished cleanup. Intermediate screenshots
stay in ignored `tmp/walkthrough`; the PDF is in `output/pdf`.

## Project links

- [Deployed application](https://givetogive.vercel.app/)
- [Project board](https://github.com/users/irackson/projects/1/views/1)
