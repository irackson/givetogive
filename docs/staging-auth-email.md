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
