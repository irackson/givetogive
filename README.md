# GiveToGive

GiveToGive is a community mutual-aid application for publishing requests and
connecting people who need help with people who can offer it.

The current application supports Discord and email/password authentication,
creating and browsing Asks, and PostgreSQL persistence through Drizzle ORM. Broader Ask types,
multiple contributors, payments, community funds, and subscriptions are planned
but are not implemented yet.

## Requirements

- Node.js 20.9 or newer
- npm 10
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
| `npm run db:generate` | Generate a Drizzle migration             |
| `npm run db:migrate`  | Apply pending database migrations        |
| `npm run db:push`     | Push the current schema directly         |
| `npm run db:seed`     | Add idempotent sample users and Asks     |
| `npm run db:studio`   | Open Drizzle Studio                      |

`db:seed`, `db:migrate`, and `db:push` modify the database configured in
`.env.local`. Confirm that connection before running them.

## Current routes

- `/` — authentication entry point
- `/signup` — create an email/password account
- `/asks` — browse Asks and open the creation form
- `/asks/[slugOrId]` — view one Ask by slug or numeric ID
- `/api/auth/[...nextauth]` — Auth.js handlers
- `/api/trpc/[trpc]` — tRPC API handler

## Project links

- [Deployed application](https://givetogive.vercel.app/)
- [Project board](https://github.com/users/irackson/projects/1/views/1)
