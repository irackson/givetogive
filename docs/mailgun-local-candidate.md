# GiveToGive Mailgun migration: disabled local candidate

Prepared separately from the paused payment goal, on `codex/givetogive-mail-migration` from main `2a157fe7a08c376841b526f90509694a6ac45db7`. No payment, funds, supporters, Stripe, simulation, Goal, token lifecycle, database schema, Google grant, provider or live configuration changes are included.

## Source and behavior

Server-only `src/server/mail` ports the reviewed task-2 mail proposal's policy/templates and the repaired durable Mailgun transport. It uses exact **GiveToGive <noreply@ianrackson.com>**, Reply-To/contact **givetogive@ianrackson.com**, canonical origin **https://givetogive.ianrackson.com**, and US `ianrackson.com` provider scope. It includes HTML/text verification/reset templates, no tracking or transactional unsubscribe, and app-updates campaign preparation with scoped owned unsubscribe links/List-Unsubscribe. It makes no one-click POST claim and adds no campaign endpoint, scheduler, opt-in record or subscription management.

The transport retains renderer provenance, binds the original frozen renderer object, bounds response bytes/chunks and monotonic deadline, reserves before HTTP, invokes HTTP once, preserves unknown/late/receipt-uncertain outcomes, and never reclaims/rearms an intent. Private material is injected and copied, with versioned GiveToGive HMAC namespace; no secret is loaded/generated/defaulted. Synthetic stores and public fixtures occur only in tests. The production interface is the reviewed reserve/complete contract, not a process-local store.

`src/server/auth/email.ts` retains the existing staging/test encrypted capture path **before provider selection**. Existing undefined provider selection preserves legacy Gmail/Resend/test behavior. Explicit `EMAIL_PROVIDER=mailgun` selects only Mailgun and cannot fall back; disabled/invalid explicit selection also cannot send via legacy providers. `getGiveToGiveMailRuntime()` always returns undefined, so Mailgun sends are held even if environment values are present. The facade reports no known acceptance under that hold and exposes no provider IDs, private error bodies or configuration.

The mail facade accepts an optional server-owned intent key but never creates one. Current registration/reset/resend callers have no durable message-intent association and pass no key. Even an admitted dependency set cannot send without a supplied key. **Do not activate by adding a random key on each call or deriving an ID from email/token/URL.** A separate reviewed caller association and durable receipt design must precede activation. Existing token replacement/consumption, enumeration-safe reset/resend wording and rate limits remain unchanged.

## Reuse and limits

The original generic proposal transport is not copied with its earlier clone/empty-stream defects: the repaired transport is pinned from task-2's accepted local durable P2 candidate. Types reuse its common interface; its OTP counter snapshot and MyCommunityResources-specific Mongo adapter are not an admitted GiveToGive persistence design. No Mongo/Postgres/D1 adapter, schema, outbox or claim compaction is added here.

App-specific adaptations are server-only/import placement, recipient guard for GiveToGive's stricter unchecked-index compiler, unused callback naming, GiveToGive-only private binder/factory, explicit provider facade, and synthetic tests. Package/lock/tsconfig/env schema, financial flags, payment files and auth router/token files are unchanged. No account/API route is added.

## Activation gates

1. Complete the real MyCommunityResources/shared-foundation pilot before later-app release.
2. Independently review the exact candidate and its actual API integration. Admit a shared atomic durable receipt adapter, stable caller intent/token association across unknown HTTP/process/browser outcomes, fencing/provider-ID uniqueness, private binding material/version, capacity/retention/restore and authorized reconciliation. Never reset claims to retry.
3. Review token issuance/invalidation ordering: the existing issuer replaces previous purpose-scoped links. An uncertain send cannot authorize an automatic new token/intent or invalidate a possibly delivered link as an unreviewed recovery mechanism.
4. Securely admit exact provider/profile configuration and sending-domain/routing/SPF/DKIM/DMARC/headroom, preserving existing Google grants and working MX/bounce/tracking. No credential value or grant is included.
5. Admit the canonical custom host and actual verify/reset links/cookie/origin behavior; owned-link validation deliberately rejects the legacy/foreign origin instead of rewriting tokens.
6. Run separately authorized controlled staging/inbox/token-expiry/reuse/resend/reset/rate-limit/API/browser/cookie acceptance. Mock queue acceptance is not inbox delivery. Production flags/payment goal remain dark/paused.
7. If campaigns are later desired, independently admit opt-in, subscription scope, signed unsubscribe endpoint and actual unsubscribe/client rendering. This preparation does not authorize campaigns or implement a signed POST endpoint.
8. Use the existing serialized exact-head GiveToGive release/signing process only after review, real pilot admission and all required CI/build checks. No push/deployment/activation is included here.
