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
was rejected by the free-tier quota, and all three corresponding staging
accounts are already verified. Do not delete or unverify them, upgrade the
plan, or assume unsupported address aliases just to force a registration test.
Fresh registration and verification/resend receipt remain outstanding.

Verification requires one token-bearing link, not two emails. The resend
procedure intentionally sends only for an unverified password account and
uses an account-independent response. Consequently, an already verified
account receives no second verification email. A tokenless verification URL
shows the resend form; it does not establish that another verification is
required. After publishing, test both the complete emailed URL and tokenless,
expired and consumed links, then verify the owner's ordinary sign-in and
admin access without bypassing authentication.
