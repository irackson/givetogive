# Codex Cloud setup for givetogive

Use **npm 10.8.3** and **Node.js 24.19.0**, matching `package.json` and
`.nvmrc`. Run all commands from the repository root. Cloud runs Linux, so the
install commands below use Bash.

## Environment

Codex Cloud is an alternative **development machine**, not inherently a CI
service. Use **`.env.staging.local`** for the current shared development setup,
with the same Development Stripe sandbox as the laptop and hosted staging.
GitHub Actions would be a separate automated CI service; none is configured yet.
The existing README classifies root `.env.local` as production-like; do not
import it for Cloud development.

Enter Development/staging values through Cloud's Environment variables settings
or Personal vault, then have setup prepare ignored `.env.staging.local` with
permissions `0600`. Do not put credentials in the install script, start skill,
chat or Git. Match the sandbox key, platform account, prices and portal settings
as one configuration; copying only a key into the old CI configuration fails.
Next.js does not automatically load this file; explicitly load it as below.

Required development configuration includes `APP_ENV=staging`,
`DATABASE_DATABASE=givetogive_staging_20260926`,
`DATABASE_USER=givetogive_staging_20260926`, matching `DATABASE_URL` and
`DATABASE_URL_UNPOOLED`, `DATABASE_HOST`, `DATABASE_PASSWORD`, and the existing
`DATABASE_IDENTITY`. Also supply the authentication settings validated in
`src/env.ts`, `ADMIN_ENCRYPTION_KEY` for the private test email sink, and
`AUTH_EMAIL_TEST_MODE=true`. Keep `APP_URL=https://givetogive-staging.vercel.app`
in the source file so the isolation preflight can verify canonical identity.
The launcher overrides the runtime origin for its local preview. Use only
sandbox credentials and `STRIPE_LIVE_APPROVED=false`.
The isolated database must already be provisioned with its matching identity
marker and schema; startup must not migrate or seed it automatically.

Keep all three sale gates off for the Cloud-local preview unless its own callback
origin and signed webhook delivery have been deliberately configured and tested.
Use the hosted protected staging site for the current payment/simulator tests.
Cloud containers isolate code, **not shared remote databases or Stripe records**.
Concurrent tasks must use disjoint synthetic accounts/records and must not alter
each other's scenarios, subscription schedules, migrations or controller claims.
Do not run integration-test cleanup against the shared staging database.

For destructive integration tests, separately supply `.env.ci.local` with the
existing `APP_ENV=test`, CI database/role/identity and **matching CI** sandbox
configuration. `npm run test:integration` expects that file. Tests can be run on
any machine; that does not make all development on that machine CI. Serialize
shared CI database suites or provision per-task isolation before running them
concurrently. A CI Stripe key is not required just to start Cloud development.

PostgreSQL credentials must be direct environment values, not HTTPS network
secret placeholders. Verify that the Cloud environment can reach the database;
local connectivity does not establish Cloud connectivity.

## Package manager field

```text
npm
```

## Install script field

Select Node.js 24.19.0 in the environment runtime configuration first.

```bash
set -euo pipefail
node -e 'if (process.versions.node !== "24.19.0") throw new Error("Select Node.js 24.19.0 for this environment")'
npm install --global npm@10.8.3
npm ci
npx playwright install --with-deps chromium
```

## Start skill field

Paste these instructions into the Start skill field:

```text
Work from the givetogive repository root using Node.js 24.19.0 and npm 10.8.3.
Require the ignored .env.staging.local file containing coherent Development
configuration. If missing, prepare it from supplied development values with file
permissions 0600, without printing credentials. If values are missing, report
which variable names are required and stop startup.

Before starting the app, run this read-only database isolation check:
node --env-file=.env.staging.local --input-type=module -e 'import postgres from "postgres"; import { isolatedConfiguration, verifyIsolatedTarget } from "./scripts/isolated-environment.ts"; const config = isolatedConfiguration(process.env, "staging"); const sql = postgres(config.pooledUrl, { max: 1, onnotice: () => {} }); try { await verifyIsolatedTarget(sql, config); } finally { await sql.end(); }'

If the check fails, stop and report the failure with credentials redacted.
Do not run migrations or seeds automatically.

Start the following command in a persistent terminal session:
PAYMENTS_ENABLED=false SUPPORTERS_ENABLED=false FUNDS_ENABLED=false STRIPE_LIVE_APPROVED=false AUTH_EMAIL_TEST_MODE=true PORT=3000 node --env-file=.env.staging.local scripts/run-local-staging.mjs dev

Wait up to 120 seconds for http://127.0.0.1:3000 and /signin to return HTTP 200.
Check the server logs for startup errors. Report the preview URL only once both
checks pass, and keep the server running. Do not print environment values.

For validation, run npm run lint, npm run typecheck and npm run test:unit.
Run npm run test:integration and npm run test:e2e only with independently
configured CI credentials, without inherited staging DATABASE_* / APP_ENV
values. Environment values override --env-file values, so a separate shell
with the CI configuration is required. Playwright starts its own CI server on
port 3100; leave PLAYWRIGHT_BASE_URL unset for local tests. Never aim the test
harness at production or the shared staging development database.
```

For intentional staging previews, use `npm run dev:staging` with the matching
`.env.staging.local`; that command performs its own isolation check and uses
port 3010.

## Verification and references

These instructions were checked against `package.json`, `.nvmrc`, `src/env.ts`,
`playwright.config.ts`, `scripts/isolated-environment.ts`, the staging launcher,
and the installed Next.js environment-variable guide. They have not been run
inside a Codex Cloud VM; runtime installation, database access, and preview
readiness still need verification during environment setup before publishing.

Official Cloud documentation describes Install script and Start skill fields,
direct environment values, and network secret placeholders:
https://learn.chatgpt.com/docs/environments/cloud-environments
