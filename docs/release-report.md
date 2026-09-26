# GiveToGive integrated release - September 26, 2026

## Published application

- Canonical site: https://givetogive.vercel.app
- Application commit: `762ede565f26e0ba380c6a817730b540182ce0a9` (GitHub verified).
- Feature integration commit: `5e56a933ecd4b75e95bb231b7fb2cf7f6ecf7054` (GitHub verified).
- Vercel application deployment: `dpl_EgjoNFqB5CNVWNNrmT5zFrm5N6Hd`, READY on production.
- Deployment URL: https://givetogive-2i4lvv8j0-iracksons-projects.vercel.app
- Next.js 16.3.6, Node.js 24.x. Vercel project settings confirm Node 24; build logs contain no Node deprecation warning.
- `main` is the only local and remote branch. Detached source worktrees were preserved, not discarded.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm run test:unit` | 16 passed: lifecycle, numeric/reserved slugs, filter parsing, safe callbacks |
| Local browser suite | 16 passed in Chromium, including real signup/verification/reset UI with development email previews |
| Published-site regression | 12 passed in Chromium; 4 development-only email-preview tests deliberately skipped; walkthrough is separate opt-in |
| `npm run build` | Passed; 15 application/API entries including new member, auth-error, and sign-out routes |
| `npm run lint` / `npx tsc --noEmit` | Passed |
| `npm audit` | 0 vulnerabilities reported, including development dependencies |
| Drizzle generation | No schema changes after the integrated migrations |
| Migration rerun | Passed with no pending migration |
| Seed rerun, twice | 0 duplicate users, Asks, or contributions inserted |
| Production data integrity audit | 0 self-contributions, overfilled goals, or stale stored Ask statuses |
| Vercel error and 5xx log scans | No matching entries returned during release verification |

The browser suite checks public routes and missing-page recovery; mobile overflow/navigation;
safe sign-out; URL Apply/Clear/Back filters; private saves; profile edits, privacy and pagination;
five Ask units and money precision; title collisions; self/outsider mutation denial; concurrent
pledge capacity; completion/cancellation terminal states and idempotency; stable owner edits;
private notes; and concurrent single-use password-reset tokens.

Expected 400/401/403/404 responses were deliberately exercised. Local logs show those validation
denials, not unhandled application failures. No test proves the absence of all possible bugs.

## Database safety and cleanup

The connected database is the production database. Local and Vercel production connection
targets were compared without printing credentials. The user explicitly authorized production
writes. Additive migration `0009_community_features` adds profiles, saved Asks, and activity;
`0010_reconcile_contribution_status` corrects status using delivered versus pledged help.
All 11 migrations are recorded as applied. No schema push or destructive migration was used.

Twelve obsolete synthetic signup accounts and their five synthetic Asks from prior test runs
were removed only after checking their exact IDs, known fixture names/email pattern, absence
of OAuth accounts, and absence of contribution relationships to other users. These disposable
test records were not backed up. Real accounts, real activity, and the 12 sample Asks remain.
New tests generate random credentials and clean up their exact synthetic IDs.
Two additional unused legacy slug-collision fixtures (Ask IDs 30 and 33, by
Codex Seed Tester) were removed after verifying their exact titles and lack of
contributions or saves. No member account was removed for this cleanup.

## Meaningful changes

- Ask router/detail and lifecycle helper: integrate completion, cancellation, owner editing,
  activity history, ownership rules, lock order, idempotency, money precision, and note privacy.
- Board, browse helper, saved table: integrate combined shareable filters, type views, saves,
  query recovery, custom-duration values, and correct Back/Clear behavior.
- User router, member pages/editor, profile fields: integrate public profiles and own history,
  20-row pagination, explicit privacy projection, honest trust cues, and unknown legacy join dates.
- Auth router/email/callback helper: atomically consume tokens, reject external callbacks,
  protect real production email delivery, add branded sign-out/error and functional retry UI.
- Slug helper: prevent all-numeric titles from colliding with numeric-ID routing.
- Header/home/styles: preserve the colorful editorial redesign, complete mobile member access,
  link type shortcuts, and distinguish money pledges from actual payments.
- Seed: preserve existing user edits, prevent self/over-capacity sample contributions, and use
  completed totals for completion rather than active pledges.
- Tests, README, tagged feature outline and walkthrough tooling: reproducible release evidence.
- `.vscode/settings.json` was already untracked/ignored and remains so.

## Three referenced tasks

Their feature work is integrated on `main`, with one reconciled migration sequence and combined
local/production verification. The original detached worktrees were retained for recovery.

1. `01a0d11b-f0c4-7582-b1f3-a91d1a8f6f0c`: contribution lifecycle and owner updates.
2. `01a0d11b-ef38-7940-b154-c73f3c93c1cc`: profiles and contribution history.
3. `01a0d11b-d95a-7580-a081-bb6abf3eff7f`: filters, saved Asks, type browsing.

These chats no longer hold unintegrated feature work and are safe to archive. They were not
archived automatically, and their original uncommitted work was not deleted.

## Honest release boundaries

Money Asks are pledges; the application does not move money. Stripe, Connect, subscriptions,
pooled funds, payouts, and refunds remain future work. Live Discord consent and actual inbox
delivery were not automated; local tests exercise verification and password-reset logic, and
production email configuration was checked without sending mail to fake addresses.

Device-wide session revocation after password reset, atomic/global anti-abuse controls,
moderation/reporting, and operational alerting are recommended before broader public promotion.
The current board is bounded to the latest 100 matches. See [feature-outline.md](feature-outline.md)
for the complete inventory, requested provenance tags, and exclusions.

## Walkthrough

`output/pdf/givetogive-published-walkthrough.pdf` contains 71 pages: 62 published-site screenshots,
a cover, and the tagged capability appendix. It includes all actual frontend routes, every Ask
type, public/member/owner states, filtering and saves, creation/edit/contribution dialogs,
completion/cancellation confirmations, authentication/recovery pages, and phone layouts.
There are fewer route files than visual states; these are 62 views, not 62 distinct URLs.

Alex Rivera and Jamie Brooks in the walkthrough are synthetic demonstration members.
Their records and demonstration Asks were removed after capture. No payment was made.
The capture test checks unexpected browser errors/network failures and horizontal overflow.
Rendered PDF pages are visually reviewed before delivery. Runtime database-outage boundaries
are not deliberately induced on production; expected not-found and invalid-token views are.

The captured application version is the commit above. A later documentation-only commit
packages this report, capture tooling, feature outline, and PDF without changing the site UI.
