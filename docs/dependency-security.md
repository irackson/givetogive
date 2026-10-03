# Dependency security checkpoint

Observed October 3, 2026. This is a bounded review, not a zero-risk claim.

## Targeted patches

The existing dependency graph was retained, with three patch-level changes:

- Root `brace-expansion` 5.0.9 → 5.0.12.
- `eslint-config-next`'s nested `brace-expansion` 1.1.18 → 1.1.21.
- Workflow's `devalue` 5.9.2 → 5.9.3 through the existing scoped
  `@workflow/core` override. Three regression tests verify that synchronous,
  asynchronous, and `uneval` serialization preserve only the two visible bytes
  of a Buffer view, not its unrelated 64-byte backing allocation.

These address the [brace-expansion quadratic expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
the older [brace-expansion recursion advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
and the [devalue shared-memory serialization advisory](https://github.com/advisories/GHSA-j22f-vq7h-c4qm).
`brace-expansion` and `braces` are different packages; fixing the former does
not fix the latter.

## Remaining audit findings

`npm audit --json` reports **13 high-severity package entries**, propagating
from **two underlying unpatched advisories**, not 13 independent vulnerabilities.
`npm audit --omit=dev --json` still reports six high entries. Registry checks
returned latest `braces` 3.0.3 and `http-cache-semantics` 4.2.0; both advisory
pages list no patched version as of this checkpoint.

| Underlying advisory | Installed paths producing audit entries |
| --- | --- |
| [braces nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `braces@3.0.3` | Seven entries: `braces`, `micromatch@4.0.8`, `chokidar@3.6.0`, `fast-glob@3.3.1` / Tailwind's `fast-glob@3.3.3` (one audit entry, two installed nodes), `@next/eslint-plugin-next@16.3.6`, `eslint-config-next@16.3.6`, `tailwindcss@3.4.19`. |
| [http-cache-semantics cross-user stale cache disclosure](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), `http-cache-semantics@4.2.0` | Six entries: `http-cache-semantics`, `cacheable-request@13.0.19`, `got@14.6.6`, `@xhmikosr/downloader@16.3.1`, `@xhmikosr/bin-wrapper@14.5.1`, `workflow/node_modules/@swc/cli@0.8.1`. Installed via `workflow@4.8.9` → `workflow/node_modules/@workflow/nest@4.0.25` → its optional SWC CLI peer. |

The first chain operates on project/configuration glob patterns: Tailwind's
`lib/lib/content.js` uses fast-glob/micromatch; its CLI watcher uses chokidar.
`postcss.config.cjs` activates Tailwind, and `tailwind.config.ts` currently uses
the literal `./src/**/*.tsx` content pattern. Next's ESLint plugin uses fast-glob
in `dist/utils/get-root-dirs.js` only when a configured `settings.next.rootDir`
glob is supplied. Current ESLint configuration has no such override. These are
build/lint inputs, not an identified route taking an Ask's text as a glob.
Untrusted source/configuration or future user-controlled glob features remain
meaningful prerequisites for exploitation; dev dependencies are not harmless.

The second chain remains in the production dependency installation because the
Workflow meta-package includes Nest integration and its peer compiler. The
application currently imports `workflow`, `workflow/api`, and `workflow/next`,
not `workflow/nest` or SWC CLI. Their inspected exports lead to
`@workflow/core`, `@workflow/core/runtime`, and `@workflow/next`. The Next
builder's `apply-swc-transform.js` uses `@swc/core`, not `@swc/cli`.
SWC CLI's separate `lib/swcx/index.js` uses bin-wrapper; bin-wrapper's downloader
call supplies extraction/hash options but no Got cache option. Installed Got
defaults `cache` to `undefined` and selects its cached request path only when
`options.cache` is enabled. This does not establish that every possible future
or upstream consumer is safe.

## Build boundary and follow-up gate

At 19:31:51 UTC, the **existing local build artifact** had 48 `.next/server`
`.nft.json` traces. None listed files from braces, micromatch, fast-glob,
chokidar, the Nest/SWC CLI/downloader chain, or http-cache-semantics. A separate
server-JavaScript search found no Nest/SWC CLI/cacheable-request/http-cache-
semantics package markers. This was an old artifact, **not** proof about the
fresh build or a deployed function. Negative string searches alone cannot prove
unreachability of bundled/minified code.

Before release, rescan the fresh build/function traces and their actual entry
imports; retain the distinction between installed, traced, and observed runtime
use. A newly traced consumer must be reviewed rather than automatically waived.

The fresh guarded build completed at 19:46:25 UTC (`.next/BUILD_ID` modification
time; build ID `2E186-Da6AWgV6Rk3HT_9`). Its independent 19:48:30 UTC rescan
found **53 NFT traces**: 51 under `.next/server`, plus
`.next/next-server.js.nft.json` and `.next/next-minimal-server.js.nft.json`.
Across all 53 trace file lists, there were zero paths for `braces`,
`micromatch`, `fast-glob`, `chokidar`, `http-cache-semantics`, `cacheable-request`,
`got`, `@xhmikosr/downloader`, `@xhmikosr/bin-wrapper`, `@workflow/nest`, or
`@swc/cli`. A separate scan of **388 `.next/server/**/*.js` files** found zero
literal cache/Nest/SWC CLI/downloader package-name markers and zero
`node_modules` path markers for the glob chain. These are local fresh-artifact
observations, not an assertion about every production-installed dependency or
future deployment. Minification can remove package names, and tracing alone is
not a complete execution proof. Deployment packaging or a changed entry import
still requires its own boundary review.

Do not run `npm audit fix --force`: its suggestions include an unrelated ESLint
downgrade and a Tailwind major migration, not a demonstrated patched leaf.

Keep glob/configuration inputs repository-controlled; do not pass unbounded
user patterns to these build tools. Do not introduce a shared authenticated Got
cache or forward attacker-controlled `max-stale` to one. If caching is later
required, first provide tenant/auth isolation, Set-Cookie exclusion, explicit
staleness/security-policy tests, and a patched or independently reviewed cache
implementation. Track upstream fixes and recheck the audit without suppressing
these findings globally. Removing unused integrations requires a separately
reviewed dependency/build change and regression verification.
