# GiveToGive controlled releases

Checkpoint commits still go to `main` and run read-only GitHub verification.
`vercel.json` disables Git-triggered deployment creation **for this repository
only**. This prevents documentation, tests and simulation-tool checkpoints from
spending a deployment slot. Other Ian projects are unchanged. An Ignored Build
Step is not used: canceled builds still count toward Vercel deployment limits.

Publish deliberately after a verified application/configuration milestone, not
after every checkpoint. Use the existing authenticated Vercel CLI 59.5.0 and
GitHub CLI; no new token or production credentials are uploaded to GitHub.

```powershell
# Set to the installed vercel package's dist/vc.js; not a token or secret.
$env:VERCEL_CLI_PATH = '<installed-vercel-package>/dist/vc.js'
node scripts/controlled-release.ts --inspect --target staging
node scripts/controlled-release.ts --deploy --target staging
node scripts/controlled-release.ts --reconcile
# After staging acceptance, deliberately publish the same reviewed main.
node scripts/controlled-release.ts --inspect --target production
node scripts/controlled-release.ts --deploy --target production
node scripts/controlled-release.ts --reconcile
```

The operator requires Node 24, clean signed `main`, exact GitHub main and a
successful first-attempt `verify.yml` run for that SHA. It validates the existing
project/team/alias/Node/protection settings, checks deployment-relevant changes,
refuses another active GiveToGive release, verifies test-only/dark runtime gates,
and checks that dry-upload inputs exclude private material. Tooling-only changes
return `deploymentNeeded=false` without submission. Generated Workflow files are
not authored release changes. Both project IDs are fixed; no relinking occurs.

One shared ignored lease serializes local release operators. Per-SHA/target
intents are exclusive and preserved. Submission returns without waiting;
`--reconcile` reads provider truth, verifies READY canonical source metadata and
releases the lease only at a terminal state. It never retries. A rejected or
uncertain submission retains its lease/intent: inspect exact provider state
before any separately reviewed recovery. Never delete a lease to evade a quota,
force an automatic retry, reset payment journals, or bypass release protection.

This is a deployment gate, not payment or migration approval. It performs no
migrations, environment changes, member actions or payments. Live payment gates
stay off. Financial operators retain their separate source/budget/identity
approval. Continue independent tests and batch later fixes before another release.

Rollback: preserve the current production deployment; if automatic Git deployment
is intentionally desired again, remove `git.deploymentEnabled=false` in a signed,
reviewed configuration commit. Do not change unrelated project settings.

References: https://vercel.com/docs/project-configuration/git-configuration
and https://vercel.com/docs/project-configuration/project-settings.

## Source provenance

Controlled uploads retain the authored application, lockfile and exact uploaded
file-manifest digests in provider metadata as well as the local submission
receipt. Terminal reconciliation requires all of them to match. This preserves
the separate native Checkout source review; a successful release is not financial
admission, and previously reviewed payment attempts are never automatically
replayed after publication.
