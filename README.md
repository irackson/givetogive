# GiveToGive

GiveToGive is a community mutual-aid application for publishing requests and
connecting people who need help with people who can offer it.

The current application supports Discord and verified email/password
authentication, password reset, creating and filtering typed Asks, private saved
Asks, member profiles, and multiple partial contributions toward each Ask goal.
Contributors and Ask owners can record completion; contributors can cancel
their own pledges. Both changes appear in activity history. PostgreSQL
persistence is handled through Drizzle ORM.
Money Asks record off-platform pledges only: payments, community funds, and
subscriptions are not implemented.

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
| `npm run test:e2e`    | Run the Playwright browser/API suite           |
| `npm run db:generate` | Generate a Drizzle migration                   |
| `npm run db:migrate`  | Apply pending database migrations              |
| `npm run db:push`     | Push the current schema directly               |
| `npm run db:seed`     | Add idempotent sample users and Asks           |
| `npm run db:studio`   | Open Drizzle Studio                            |

`db:seed`, `db:migrate`, and `db:push` modify the database configured in
`.env.local`. Confirm that connection before running them.

## End-to-end tests

`npm test` first runs unit tests, then starts a local Next.js server on port
3100 and runs Chromium tests. Coverage includes public routes, authentication,
typed Ask creation, partial contributions, completion/cancellation, concurrent
pledges, ownership rules, URL filters, private saves, profile editing, history
pagination, and one-time password-reset tokens.

The local test server uses `AUTH_EMAIL_TEST_MODE`, so no real emails are sent
while development-only preview links exercise verification and reset flows.
Production ignores that flag and never exposes those preview links.

To run the release browser/API checks against an existing deployment, set
`PLAYWRIGHT_BASE_URL` to its full URL before `npm run test:e2e`. This disables
the automatic local server and skips the development-preview email tests.
The fixture database in `.env.local` must be the deployment's database. These
tests make real writes: they create synthetic members and Asks, exercise them,
and clean up the exact generated member IDs and related records afterward.
Use a deliberately selected database, never an unrelated production connection.

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
to the published site and `WALKTHROUGH_CAPTURE=1`, then run:

```bash
npx playwright test tests/e2e/walkthrough.spec.ts
python scripts/build-walkthrough.py
```

The PDF builder needs `reportlab` and `Pillow`. It rejects incomplete captures
or captures with reported errors/unfinished cleanup. Intermediate screenshots
stay in ignored `tmp/walkthrough`; the PDF is in `output/pdf`.

## Project links

- [Deployed application](https://givetogive.vercel.app/)
- [Project board](https://github.com/users/irackson/projects/1/views/1)
