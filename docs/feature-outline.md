# GiveToGive capability outline

This inventory compares the integrated release with `main` at `1ecb2ee`, the
starting point for this release. It distinguishes working baseline features
from unmerged work in the three referenced task worktrees. It describes
application behavior, not a guarantee that every future need is implemented.

"Existed before" means before this integration pass, not necessarily before
the broader revival. For example, the visual redesign was created earlier in
the revival at `bb600ca`, and typed contributions/runtime updates at `979a793`.

## Tags

- **existed before** — working code was already on baseline `main`.
- **partly implemented before** — code existed in an unmerged task worktree,
  but was not a finished, integrated feature on baseline `main`.
- **brand new** — behavior or release coverage added during this integration.
- **newly finished** — incomplete work integrated, corrected, and made ready
  for the release. The verification record is recorded separately below.

## Public experience

| Capability                       | Provenance                                 | Current behavior                                                                                                                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colorful editorial design        | existed before                             | Warm paper backgrounds, cobalt/coral accents, expressive typography, illustrations, responsive home, board, Ask detail, and authentication views. |
| Home and navigation              | existed before                             | Introduces mutual aid and links to browsing, account access, and posting.                                                                         |
| Home type shortcuts              | brand new                                  | Time, item, and money-pledge shortcuts open the corresponding board filter; copy distinguishes pledges from real payments.                        |
| Public Ask board                 | existed before                             | Latest 100 Asks, type, title, description, difficulty, estimated time, goal, status, and contribution progress.                                   |
| Type browsing                    | partly implemented before → newly finished | Tabs for time, task, item, money, resource, and all types.                                                                                        |
| Combined filters                 | partly implemented before → newly finished | Keyword search over title/description, status, maximum difficulty, and maximum estimated minutes combine with type and saved filters.             |
| Shareable filter state           | partly implemented before → newly finished | Filters live in the URL and survive reload, links, Back, and Forward. Apply and Clear update both results and form values.                        |
| Arbitrary valid duration links   | brand new                                  | A link such as `?minutes=45` displays the correct selected value rather than silently looking unfiltered.                                         |
| Loading, empty, and retry states | newly finished                             | Board loading, no results, no saves, signed-out saves, save failure, and query failure have explicit feedback and recovery.                       |
| Page recovery                    | brand new                                  | Branded missing-page and runtime-error screens, plus member-specific missing/error states.                                                        |

## Accounts and access

| Capability                      | Provenance                      | Current behavior                                                                                                                                                                            |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password accounts         | existed before                  | Register a name/email/password, verify the email, and sign in with email/password. There is no separate username-login system.                                                              |
| Discord sign-in                 | existed before                  | Auth.js OAuth entry point and account persistence. Completing OAuth still requires the member's Discord authorization.                                                                      |
| Email verification              | existed before                  | Expiring links and resend flow, including recovery guidance for an unverified sign-in.                                                                                                      |
| Password reset                  | existed before                  | Generic reset request response and expiring token-based replacement password.                                                                                                               |
| Authentication email            | existed before                  | Gmail OAuth delivery, optional Resend fallback, and development-only preview links/test mode.                                                                                               |
| Password storage and throttling | existed before                  | Password hashing and database-backed account/address authentication attempt limits.                                                                                                         |
| Single-use token races          | brand new                       | Verification and reset consume a valid token atomically within the transaction, preventing concurrent successful reuse.                                                                     |
| Callback protection             | brand new                       | Sign-in callbacks accept safe local paths and reject external/protocol-relative/control-character destinations.                                                                             |
| Branded sign-out and auth recovery | brand new | Sign-out confirmation and cancellation, actual session removal, signed-out state, and generic authentication error recovery use the site's visual language. |
| Production email safety         | brand new                       | The test-email flag cannot suppress real delivery in production.                                                                                                                            |
| Protected actions               | existed before / newly finished | Posting and contributing already required a session. Saving, profile editing, owner edits, and contribution transitions now enforce the corresponding member/owner permissions server-side. |

## Asks and contribution lifecycle

| Capability                          | Provenance                                 | Current behavior                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five Ask types                      | existed before                             | `time`, `task`, `item`, `money`, `resource`; positive goals measured in minutes, tasks, items, currency, or resource units.                                                             |
| Create-Ask modal                    | existed before                             | Title, description, type, goal, difficulty 1–5, estimated minutes, and currency for money Asks.                                                                                         |
| Stable collision-safe URLs          | existed before / newly finished            | Unique slugs avoid title collisions; numeric-ID links also work. Owner title edits now retain the original slug.                                                                        |
| Multiple partial offers             | existed before                             | More than one member can offer a partial amount toward an Ask. No self-contributions or over-goal contributions.                                                                        |
| Goal precision                      | newly finished                             | Whole-number non-money units; monetary inputs have at most two decimal places and are stored as integer minor units.                                                                    |
| Reserved versus delivered help      | partly implemented before → newly finished | Pledged and completed amounts reserve the goal; only completed amounts count toward completion. A fully pledged Ask remains in progress until delivery is recorded.                     |
| Completion and cancellation         | partly implemented before → newly finished | The contributor or owner can mark a pledge completed; only the contributor can cancel it. Both actions use confirmation dialogs. Cancellation releases capacity.                        |
| Terminal and idempotent transitions | brand new                                  | Completed/cancelled records cannot switch terminal states. Repeating the same authorized action succeeds without duplicate activity.                                                    |
| Concurrency controls                | newly finished                             | Writes lock the Ask consistently before updating contributions, preventing competing offers from overfilling capacity.                                                                  |
| Owner edits                         | partly implemented before → newly finished | Update title, description, difficulty, time estimate, and goal. Cannot lower the goal below active offers. Raising the goal can reopen a completed Ask. Type and currency remain fixed. |
| Activity timeline                   | partly implemented before → newly finished | Ask creation/edits and contribution offer/completion/cancellation records, attributed to actors. Dates render consistently in UTC.                                                      |
| Contributor/owner profile links     | newly finished                             | Ask detail connects people to public profiles rather than leaving names as dead ends.                                                                                                   |
| Contribution notes                  | existed before / newly finished            | Optional notes accompany offers; privacy is restricted to the Ask owner and the note's contributor. Public totals and participation remain visible.                                     |
| Existing status reconciliation      | brand new                                  | Migration recalculates stored Ask statuses using completed rather than merely pledged amounts.                                                                                          |

Money entries are **off-platform records**, not charges, transfers, receipts,
escrow balances, or proof that a payment settled. “Completed” records what a
member or owner marked; it is not independent verification.

## Saved Asks and member profiles

| Capability                   | Provenance                                 | Current behavior                                                                                                                                                    |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private saved list           | partly implemented before → newly finished | Signed-in members bookmark/unbookmark board cards and browse `?saved=1`, optionally combined with other filters.                                                    |
| Idempotent saves             | newly finished                             | Composite member/Ask keys and conflict-safe writes prevent duplicate saves; removing an absent save is harmless.                                                    |
| Saved-list privacy           | newly finished                             | Results are scoped to the current member. Guests see a sign-in prompt, not another member's data.                                                                   |
| Public profiles              | partly implemented before → newly finished | Name, optional bio/location, completed contribution history, completed count, and Asks-posted count.                                                                |
| Own-profile editing          | partly implemented before → newly finished | Edit name, bio, and location; Cancel discards unsaved edits. The API can only update the signed-in member.                                                          |
| Private contribution history | newly finished                             | The profile owner sees their pledged/completed/cancelled offers. Other visitors see completed entries only. History excludes private notes and account credentials. |
| History pagination           | brand new                                  | Twenty records per page with navigation and total counts.                                                                                                           |
| Lightweight trust context    | partly implemented before → newly finished | “Email confirmed” explicitly does not imply identity verification. Joined month/year appears only when known; legacy accounts do not get an invented age.           |
| Responsive profile access    | newly finished                             | Authenticated navigation exposes My profile, including narrow layouts.                                                                                              |

Profile privacy does not make participation anonymous: an Ask's public detail
and activity timeline still show contribution identities, amounts, and statuses.
Location is a self-written profile field, not geolocation or geographic matching.

## Route and view inventory

| Path                      | Views and states                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                       | Public/authenticated home, type shortcuts, responsive header/footer.                                                                                               |
| `/asks`                   | All types, each type tab, combined filters, loading/error/empty results, signed-out posting prompt, create-Ask modal and its type-specific fields.                 |
| `/asks?saved=1`           | Private saved board, empty saved board, filtered saves, and sign-in gate.                                                                                          |
| `/asks/[slugOrId]`        | Public/member/owner detail; goal progress; contributor list; offer modal; owner edit modal; completion/cancellation confirmations; activity timeline; missing Ask. |
| `/members`                | Redirect to own profile or sign-in.                                                                                                                                |
| `/members/[id]`           | Public or own profile, edit modal, empty/populated/paginated history, missing member and error recovery.                                                           |
| `/signin`                 | Email/password form, Discord entry, incorrect/unverified sign-in recovery, callback return.                                                                        |
| `/signout`                | Confirmation, cancellation, and already-signed-out state. |
| `/auth-error`             | Branded generic authentication recovery without provider internals. |
| `/signup`                 | Registration, validation, verification guidance.                                                                                                                   |
| `/forgot-password`        | Reset request form and generic confirmation.                                                                                                                       |
| `/reset-password`         | Token-based form, missing/invalid/expired link, completion.                                                                                                        |
| `/verify-email`           | Verify valid token, missing/invalid/expired token, resend form and confirmation.                                                                                   |
| `/api/auth/[...nextauth]` | Session, provider callbacks, CSRF/authentication and sign-out handlers.                                                                                            |
| `/api/trpc/[trpc]`        | Typed Ask and user API operations, server-side validation/authorization.                                                                                           |
| Unknown paths             | Branded not-found view and route recovery.                                                                                                                         |

## Architecture and operations

- **existed before:** Next.js App Router and React, TypeScript, Material UI,
  custom CSS, tRPC with TanStack Query/SuperJSON, Auth.js JWT sessions and
  Drizzle adapter, PostgreSQL through Drizzle, Vercel hosting, Node 24 runtime.
- **newly finished:** additive saved-Ask/activity/profile migration integrated
  with the existing migration sequence; contribution status reconciliation.
- **brand new:** focused unit tests and combined browser/API coverage for
  ownership, privacy, terminal states, pledge/token races, callback safety, filters and history.
  Synthetic test records are scoped to exact generated member IDs for cleanup.
- **existed before:** `.vscode/settings.json` was already removed from Git
  tracking and ignored at this release's starting baseline.

## Resolved task boundaries

| Referenced task                                                                               | Integrated outcome                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contribution completion, cancellation, owner updates (`01a0d11b-f0c4-7582-b1f3-a91d1a8f6f0c`) | Lifecycle router/UI, activity schema, safe state rules and race coverage.                      |
| Member profiles, contribution history (`01a0d11b-ef38-7940-b154-c73f3c93c1cc`)                | Profiles/editor, private versus public history, honest trust cues, pagination.                 |
| Filters, saved Asks, type browsing (`01a0d11b-d95a-7580-a081-bb6abf3eff7f`)                   | URL-driven board, all type tabs, private saves, clear/back synchronization and query recovery. |

Original task worktrees are preserved; no unrelated local edits are discarded.
The release report records final production verification and archive readiness.

## Intentional limits / next work

Not implemented: Stripe Checkout/Connect or other payment processing, recurring
supporter subscriptions, pooled community funds, financial payout/refund
workflows, private messaging, notification subscriptions, geographic discovery,
attachments, moderation/reporting tools, ratings, identity checks, Ask deletion
or archival, and a full searchable member directory.

The board currently shows at most the latest 100 matching Asks, not an infinite
directory. Owner edits cannot change an Ask's type/currency once created.
Session revocation across already-signed-in devices and broader anti-abuse
controls remain separate security work. No automated browser test substitutes
for an end-to-end member-authorized Discord OAuth flow or real email-delivery
monitoring.

## Verification record

| Check | Verified result |
| --- | --- |
| Unit tests | 16 passed |
| Local browser tests | 16 passed, including signup, email verification and password reset via development preview links |
| Production browser/API regression | 12 passed; development email-preview tests intentionally skipped |
| Production walkthrough | 62 desktop/mobile views and dialog states, zero unexpected browser/network errors, synthetic records cleaned up |
| Build / TypeScript / ESLint | Passed |
| Dependency audit | 0 vulnerabilities reported |
| Database | 11 migrations applied; seed rerun without duplicates; no self-contributions, overfilled goals or stale statuses |

See `docs/release-report.md` for deployment identity, archive readiness,
cleanup details, and honest validation limits. The PDF captures the application
release; subsequent documentation-only commits do not change its UI.
