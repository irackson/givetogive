# GiveToGive

GiveToGive is a community mutual-aid application for publishing requests and
connecting people who need help with people who can offer it.

The current application supports Discord and verified email/password
authentication, password reset, creating and browsing typed Asks, and multiple
partial contributions toward each Ask goal. PostgreSQL persistence is handled
through Drizzle ORM. Payments, community funds, and subscriptions are planned
but are not implemented yet.

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

| Command               | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Start the Next.js development server     |
| `npm run build`       | Create and type-check a production build |
| `npm run lint`        | Run ESLint                               |
| `npm test`            | Run the Playwright end-to-end suite      |
| `npm run db:generate` | Generate a Drizzle migration             |
| `npm run db:migrate`  | Apply pending database migrations        |
| `npm run db:push`     | Push the current schema directly         |
| `npm run db:seed`     | Add idempotent sample users and Asks     |
| `npm run db:studio`   | Open Drizzle Studio                      |

`db:seed`, `db:migrate`, and `db:push` modify the database configured in
`.env.local`. Confirm that connection before running them.

## End-to-end tests

`npm test` starts an isolated local Next.js server on port 3100 and runs the
browser suite in Chromium. It covers the public routes, the unverified-account
recovery path, email verification, password reset, sign-in, Ask creation, and
a second member's contribution. The test server uses `AUTH_EMAIL_TEST_MODE`, so
no real emails are sent while the application still returns development links
for the complete verification and reset flows.

## Current routes

- `/` - home and authentication status
- `/signin` - email/password and Discord sign-in
- `/signup` - create an email/password account
- `/forgot-password` - request a password reset
- `/reset-password` - finish a password reset from a tokenized link
- `/verify-email` - verify an email or request a replacement link
- `/asks` - browse typed Asks and open the creation form
- `/asks/[slugOrId]` - view an Ask, its progress, and its contributors
- `/api/auth/[...nextauth]` - Auth.js handlers
- `/api/trpc/[trpc]` - tRPC API handler

## Ask and contribution model

Every Ask has a type (`time`, `task`, `item`, `money`, or `resource`), a
positive goal, a difficulty from 1 to 5, and an estimated completion time.
Monetary amounts are stored as integer minor units (for example, cents).

Contributions belong to one Ask and one authenticated user. Multiple people
can pledge partial amounts, and an Ask moves from `not_started` to
`in_progress` and then `complete` as its active contribution total reaches the
goal. The legacy single `fulfilled_by` column remains only for migration
compatibility and is no longer used by the application workflow.

## Project links

- [Deployed application](https://givetogive.vercel.app/)
- [Project board](https://github.com/users/irackson/projects/1/views/1)
