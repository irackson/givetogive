# Payments release migration review

October 2, 2026. This is a review checkpoint, **not** approval or evidence of a
completed production rollout. No production migration or member-data query was
performed during this review.

## Observed production metadata

A PostgreSQL repeatable-read, read-only transaction confirmed the existing
`verceldb` target and eleven recorded migrations. Its highest migration timestamp
corresponds to 0010. Migrations 0011–0018 remain pending. The new user columns
`role`, `session_version`, `frozen_at`, `is_synthetic` and
`show_supporter_badge` are absent. New application code must not auto-deploy
before the compatible schema is installed.

Three raw checksums differ: 0000, 0001 and 0002. Each matches the same local file
after changing **only LF/CRLF line endings**. The checkout has `core.autocrlf=true`.
This establishes a formatting difference rather than different SQL for those
three files; it does not authorize rewriting historical migration records.
Keep the recorded hashes intact. Verify this again immediately before rollout.

The production database is shared: metadata shows ten GiveToGive tables and
27 unrelated public tables. Do not reset this database or restore its entire
branch over production as a routine application rollback. A rehearsal copy
must remain private, inaccessible to simulation agents, and preserve the other
applications. No unrelated table contents were read.

## Repeatable read-only checks

`scripts/review-payment-migrations.ts` verifies the **entire ordered prefix**,
not just the latest timestamp. It rejects missing, duplicate, reordered or
unknown migrations and changed SQL, reports LF/CRLF-only matches, and computes
a line-ending-stable digest of every migration's timestamp, tag and SQL.
It uses a direct connection, startup read-only mode plus a repeatable-read
read-only transaction, a 15-second statement timeout and three-second lock
timeout. It queries only schema/history metadata; errors never print URLs.

```powershell
node --env-file=.env.local scripts/review-payment-migrations.ts --production-read-only
node --env-file=.env.staging.local scripts/review-payment-migrations.ts --isolated-read-only
node --env-file=.env.ci.local scripts/review-payment-migrations.ts --isolated-read-only
```

October 2 at 14:06–14:14 UTC: production had eleven applied migrations and
0011–0018 pending; staging and CI each had nineteen applied, no pending entries
and all five new user columns. All three verified the same migration-chain
digest `0b9f5566ccb0d90e3ca51d3390a4830587eb4a9a63d033ca5463a9025cdc51f5`.
GiveToGive schema counts: production 10 tables/34 constraints/no custom triggers;
staging and CI 34 tables/116 constraints/ten custom triggers. Counts alone are
not constraint correctness or application compatibility evidence.

Five regression tests cover history gaps/duplicates/order, changed SQL, explicit
format-only matches, unsafe timestamps and invalid manifest paths. The isolated
migration launcher now checks existing history before invoking Drizzle. No
production migration was performed.

## October 2 isolated backup/recovery rehearsal

Read-only `neon.project_id` / `neon.branch_id` settings resolved the project
without needing Ian's credentials. Provider metadata independently matched the
production endpoint, project `muddy-truth-80467726`, root branch
`br-holy-lake-a48597y6`, Free plan and available branch capacity. No plan upgrade
or billable snapshot was initiated.

- Frozen backup branch `br-wild-credit-a4jo07ea`, named
  `givetogive-pre-payments-20261002`, created 14:21:52 UTC from production at
  LSN `0/71466740`. It is ready, nondefault and has **no compute endpoint**.
  Preserve it; no existing branch was reset/restored/renamed or deleted.
- Recovery/rehearsal branch `br-dawn-lab-a4mm36bg`, named
  `givetogive-payments-rehearsal-20261002`, was created from that backup at the
  same LSN. Its own endpoint `ep-bitter-bread-a4uv2cgt` is bounded to 0.25 CU.
  Provider rejected a custom suspend timeout; readback proved that failed
  request created nothing, then creation without that unsupported option worked.
  This is a **database** branch, not a Git branch; Git remains main-only.
- The private one-target helper verifies the exact live project/branch/database
  before any DDL, rechecks the full eleven-entry prefix and exact SQL-chain
  digest, and applies 0011–0018 through the installed Drizzle migrator with a
  three-second lock timeout. The migrator applies the pending chain in a
  transaction. At 14:26:29 UTC it finished in 4,171 ms with nineteen history rows.
- All ten original GiveToGive tables retained their row counts and aggregate
  legacy-column fingerprints. Raw user, session or password values never left
  Postgres. Existing member defaults were member/version-zero/unfrozen/
  nonsynthetic/no-badge. Ten financial/history triggers were present. Unrelated
  schema columns, constraints and indexes had the same digest; unrelated table
  contents were not queried. No application or simulation is bound to this copy.
- The first private preflight helper stalled by using the outer one-connection
  pool inside its reserved transaction. Only that owned helper was stopped,
  before migration admission. Passing the transaction connection fixed it;
  the subsequent rehearsal passed. No user applications were terminated.
- Production readback at 14:27:18 UTC still had eleven migrations, no new user
  columns and unchanged GiveToGive schema counts. No production writes occurred.

Evidence is retained in ignored `tmp/payments-migration-rehearsal-*.json` and
the pinned private helper. Browser/auth compatibility remains **unverified**;
schema/data preservation does not substitute for those release tests. Refresh
the backup immediately before a later production migration because other
applications and staging continue writing to the original branch. Never restore
the whole shared branch over production as a routine code rollback.

## Source review

- 0011 creates payment, ledger, webhook, security, telemetry, simulation and fund
  tables. Its changes to the existing user table are additive: member role,
  session version zero, no freeze, and nonsynthetic defaults. It does not alter
  existing Ask/contribution quantities or convert legacy monetary pledges.
- 0012 adds balancing and append-only triggers to the new ledger/audit tables.
- 0013 defaults optional supporter badges to false; 0014 creates request metrics.
- 0015 adds nullable paid-period evidence; 0016 defaults dispute capacity holds
  to zero. Neither backfills unpaid transactions as paid.
- 0017 creates supporter change/coverage storage and adds subscription state.
- 0018 creates immutable provider application evidence and coverage provenance
  guards. Legacy coverage item IDs remain nullable until a verified replay.

New foreign keys intentionally preserve financial history rather than cascading
away payment evidence. Constraints/triggers must remain present after deployment.
New-table indexes do not rebuild existing Ask tables. Additive user columns can
still acquire table locks: use a bounded lock timeout and a recoverable procedure.
Schema additions alone do not prove browser/auth backward compatibility.

## Remaining release gates

1. Take and verify a recoverable production backup/snapshot. Rehearse restoration
   and this exact migration chain on an isolated copy without exposing real data
   to simulation agents. Record the snapshot identity and exact source SHA.
2. Recheck migration history, pending files and existing schema immediately before
   the operation. Do not use `db:push`, silently skip mismatches, or edit history.
3. Rehearse old application compatibility with the additive schema, then current
   application authentication/Ask workflows with all live sales gates off.
4. Apply reviewed additive migrations **before** pushing code that auto-deploys
   queries for new columns. Verify schema, constraints, triggers and history.
5. Push a verified signed commit; inspect the actual production deployment and
   smoke-test public, account and admin paths. All live sales remain disabled
   until the separate business, administrator/MFA and provider acceptance gates.

Rollback is application rollback with the additive schema retained. Never drop
financial/audit tables or attempt to delete the ledger to roll code back. A
snapshot restoration is a separately reviewed recovery action, not an automatic
response to a failed payment test.
