# Codex Cloud setup for givetogive

Use **npm 10.8.3** and **Node.js 24.19.0**, matching `package.json` and
`.nvmrc`. Run all commands from the repository root. Cloud runs Linux, so the
install commands below use Bash.

## Environment

Use the isolated **`.env.ci.local`** configuration for development and tests in
Cloud. Use `.env.staging.local` only for intentional staging work. The existing
README classifies root `.env.local` as production-like; do not import it for
Cloud development.

Enter CI values through Cloud's Environment variables settings or Personal
vault, then have the setup create the ignored `.env.ci.local` file with those
same values and permissions `0600`. Do not put credentials in the install
script, start skill, chat, or Git. This file is required by the existing
integration-test script even when direct environment variables are configured.
Next.js does not automatically load `.env.ci.local`; explicitly load it as below.

Required isolated configuration includes `APP_ENV=test`,
`DATABASE_DATABASE=givetogive_ci_20260926`,
`DATABASE_USER=givetogive_ci_20260926`, matching `DATABASE_URL` and
`DATABASE_URL_UNPOOLED`, `DATABASE_HOST`, `DATABASE_PASSWORD`, and the existing
`DATABASE_IDENTITY`. Also supply the authentication settings validated in
`src/env.ts`, `ADMIN_ENCRYPTION_KEY` for the private test email sink, and
`AUTH_EMAIL_TEST_MODE=true`. Set `APP_URL` and `NEXTAUTH_URL` to
`http://127.0.0.1:3000`. Use sandbox credentials for enabled payment features.
The isolated database must already be provisioned with its matching identity
marker and schema; startup must not migrate or seed it automatically.

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
Require the ignored .env.ci.local file containing the isolated CI configuration.
If it is missing, prepare it from the supplied CI environment values with file
permissions 0600, without printing credentials. If values are missing, report
which variable names are required and stop startup.

Before starting the app, run this read-only database isolation check:
node --env-file=.env.ci.local --input-type=module -e 'import postgres from "postgres"; import { isolatedConfiguration, verifyIsolatedTarget } from "./scripts/isolated-environment.ts"; const config = isolatedConfiguration(process.env, "test"); const sql = postgres(config.pooledUrl, { max: 1, onnotice: () => {} }); try { await verifyIsolatedTarget(sql, config); } finally { await sql.end(); }'

If the check fails, stop and report the failure with credentials redacted.
Do not run migrations or seeds automatically.

Start the following command in a persistent terminal session:
APP_URL=http://127.0.0.1:3000 NEXTAUTH_URL=http://127.0.0.1:3000 AUTH_EMAIL_TEST_MODE=true node --env-file=.env.ci.local node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 3000

Wait up to 120 seconds for http://127.0.0.1:3000 and /signin to return HTTP 200.
Check the server logs for startup errors. Report the preview URL only once both
checks pass, and keep the server running. Do not print environment values.

For validation, run npm run lint, npm run typecheck, npm run test:unit,
npm run test:integration, and npm run test:e2e as appropriate to the task.
Playwright starts its own server on port 3100; leave PLAYWRIGHT_BASE_URL unset
for local tests. Never aim the test harness at production.
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
