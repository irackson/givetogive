# Staging authentication email

Staging captures authentication links by default. To exercise real delivery,
set the **server-only** `AUTH_EMAIL_STAGING_RECIPIENTS` to a comma-separated list
of exact approved email addresses in the separate staging Vercel project.
Configure the existing Gmail sender credentials or Resend sender there too.
Never copy database or payment credentials from another environment.

Only exact case-insensitive recipient matches bypass capture. Reserved test
domains, including `givetogive.invalid`, remain captured even if allowlisted.
The test environment always captures. Production behavior is unchanged.
Registration reports the actual delivery result; resend/reset wording remains
independent of whether the address has an account.

Configuration changes take effect on a new deployment. After deployment, test
registration, resend, expired/consumed verification links, password reset and
ordinary login with existing approved AgentMail inboxes. Verify actual receipt
through AgentMail, not merely an HTTP send response or a manual relay. Never
publish authentication tokens, link URLs, passwords or raw provider responses.

Rollback: remove `AUTH_EMAIL_STAGING_RECIPIENTS` and redeploy the staging project.
This restores capture for all staging recipients without changing account state.

## Observed acceptance — October 9, 2026

An existing approved AgentMail fixture received the actual app-generated
password-reset email at **04:32:33 UTC**. The request exercised the current
`user.requestPasswordReset` router through a loopback HTTP adapter with the
isolated staging database and real configured Gmail sender. It did not manually
generate or relay a token. The normal hosted staging reset page returned 200;
the normal reset API accepted the received token, rejected reuse with
`BAD_REQUEST`, and ordinary credentials login succeeded with the new password.
Only the fixture password changed; the owner's account was not modified.

This proves real delivery plus hosted reset/token-consumption/login, **not**
deployment acceptance of the updated staging request handler or full browser
registration/verification/resend. The canonical staging deployment remains on
older code: the new deployment attempt was rejected by Vercel's daily quota.
A full local Next server attempt was stopped at the memory safety floor; the
lightweight router test is not a substitute for that browser acceptance.

AgentMail's three existing inboxes were reused/inspected. New inbox creation
was rejected by the free-tier quota, and all three original corresponding
staging accounts are already verified. Do not delete or unverify them or upgrade
the plan to force a registration test. A later harmless tagged-address probe
actually arrived in the existing inbox with the tagged recipient intact. This
observed routing, not an assumption about provider aliases, enabled the fresh
registration/resend acceptance below without allocating another inbox.

Verification requires one token-bearing link, not two emails. The resend
procedure intentionally sends only for an unverified password account and
uses an account-independent response. Consequently, an already verified
account receives no second verification email. A tokenless verification URL
shows the resend form; it does not establish that another verification is
required. After publishing, test both the complete emailed URL and tokenless,
expired and consumed links, then verify the owner's ordinary sign-in and
admin access without bypassing authentication.

## Fresh real registration/resend and hosted verification acceptance

On October 9, one fresh tagged address routed to an existing AgentMail inbox
was independently proved with a harmless nonce message. The current actual
`user.register` router over the loopback HTTP adapter created one normal staging
member at **05:59:47 UTC** and delivered the actual app-generated verification
email through the configured Gmail sender. AgentMail confirmed actual receipt
and the complete canonical staging link. `user.resendVerification` at
**06:00:43 UTC** delivered a second real email with a different link; both requests
reported sent rather than captured, and the isolated email sink remained unchanged.
The exact tagged address was allowlisted only in that local test process; it was
not added to production or assumed to be enabled on the older staging deployment.

A real mobile Chromium session on protected hosted staging then confirmed:

- The superseded registration link displayed the invalid/expired-link error.
- The actually received resend link displayed successful email verification;
  independent read-only database observation confirmed the same member verified.
- Reloading the consumed link displayed the error and no second-email request.
- A separate normal browser sign-in with an explicit `/asks` callback succeeded
  at **06:04:44 UTC**, followed by ordinary session readback of that exact member.
  Console/page/HTTP error counts for this sign-in were all zero.

The first verification browser run retained its successful link checks but failed
its subsequent sign-in assertion because the harness expected `/asks` from the
default sign-in flow; the application defaults to `/`. That failed receipt is
preserved, not relabeled successful. The separate explicit-callback login passed
without replaying verification tokens. These are real browser/API observations,
not fixture-issued sessions or direct verification grants. The owner's account
and the original three inbox accounts were not changed. The newly created fixture
and its credentials remain isolated/private for subsequent normal auth testing.

A verified-account resend at **06:05:26 UTC** succeeded with zero verification
tokens before/after, and the bounded independent mailbox observation still showed
only the original registration and resend emails. This is expected behavior:
already verified members do not need another verification email. It does not prove
that the owner's original link arrived intact or establish that incident's cause.

**Still outstanding:** publication of the new staging request handler and ordinary
hosted signup/resend form acceptance against that new release; an actually expired
link; the owner's own authenticated dashboard session; full payment/simulation and
final all-view/modal evidence. The current hosted verification/sign-in procedures
were exercised on the older published staging release, not a new deployment.
No protection setting was disabled, no financial action ran, and auth URLs,
passwords, raw provider responses, DOM dumps and network traces were not published.

## Concurrent token replacement regression fixed (October 9)

An actual isolated CI database test reproduced twelve concurrent replacement
requests leaving **five** active verification tokens for one disposable member.
Token issuance now acquires a transaction-scoped advisory lock keyed by member
and purpose before deleting/inserting tokens. This serializes first issuance and
replacement without introducing a user-row/token-row lock-order inversion with
verification. No schema change or account grant is involved.

The new `tests/integration/auth-token-lifecycle.test.ts` passes all three real
SQL/router checks: one surviving replacement per purpose, one concurrent
verification winner with immutable verified time on reuse, and expired/wrong-purpose
rejection without verification or cross-purpose consumption. Together with existing
email-capture/rate-limit regressions, **six** integration checks passed against the
restricted isolated CI database; disposable members were cleaned up. Constructed
expired CI tokens are not the separate naturally expiring AgentMail fixture.
TypeScript and scoped zero-warning lint also passed. The credential-free hosted
workflow has no database credentials and does not run these SQL integrations.
This is a confirmed race fix, not proof of the owner's original email incident
or final hosted signup/resend acceptance.

## Natural-expiry preparation evidence

On October 9, a second fresh tagged address was independently proved to route
to an existing AgentMail inbox. The normal current registration router sent a
real verification email, and AgentMail confirmed actual receipt. A guarded
read-only transaction at **06:34:04 UTC** confirmed the exact normal member is
unverified/unfrozen and has one matching, unconsumed verification token.
Its database expiration is **October 10 at 06:29:56 UTC**; check after
**06:30:56 UTC** (02:30:56 Eastern). No token was consumed, no timestamp changed,
and no direct verification grant or second inbox was created. This is preparation,
not expired-link acceptance. Keep the ignored private expiry fixture files and
do not resend, replace, or consume this token before its real expiration.

Separately, hosted verification run **37893510093** for main **c58ed5b** finished
successfully. Its anonymous public capture executed all **40 desktop/mobile
views**, with zero attempted mutation requests, no recorded errors, and no
failure phase. Those images remained only on the ephemeral runner: this proves
capture execution, not retained/visually reviewed final PDF inputs, authenticated
views, email delivery, payments, or simulation acceptance. Earlier incomplete
capture receipts remain failed; they were not relabeled by this later success.
