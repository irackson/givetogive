# Payment authority and recovery

These services are the authority behind `billing`, the Stripe webhook routes, and hosted payment workflows. Browser return URLs, model outputs, tool metadata, and an administrator clicking a button are not evidence of payment.

## Invariants

- All financial amounts are integer USD cents. A Checkout operation freezes gross, 5% platform deduction, the explicitly configured processing estimate, and recipient net. The ledger separately records actual processing fees and variance.
- Payment-enabled money Asks are an explicit opt-in and cannot contain legacy pledges. Manual pledge creation/completion/cancellation is rejected for these Asks. Non-enrolled Asks retain their existing workflow.
- Checkout, allocations, and owner goal edits serialize on the Ask row. Paid net, unresolved Checkout reservations, and reversible disputed principal all occupy capacity. Wall-clock expiry alone never releases a reservation.
- Refunded and disputed principal is excluded from verified progress. An open dispute holds reversible capacity; a terminal loss releases that hold. A won dispute cannot retroactively overfill the Ask.
- A paid supporter tier comes from verified invoice payment coverage. Full refunds/disputes revoke that coverage; old webhook replay cannot restore it. Partial refunds retain residual paid coverage. Cancellation retains already-paid time. Customer-credit/zero-payment invoices require review instead of silently granting free paid status.
- Fund allocations spend only settled, unallocated recipient principal. Refund reservations and unresolved financial holds exclude a source from new allocations. Allocation does not charge another platform fee.
- Journals are balanced, immutable, and idempotent. Operation identity also binds payment/fund identity. Network calls happen outside database transactions.

## Delivery and recovery

Signed classic and v2 webhooks persist minimal account/mode-bound inbox records before starting hosted workflows. Handlers fetch current Stripe objects and reconcile idempotently. Reservation workflows retry at 36 minutes and one day. The authenticated daily Hobby-compatible sweep drains up to 20 fair batches; claimed attempt timestamps and `SKIP LOCKED` prevent poison rows monopolizing the first page. A configured paid hosting plan may support a more frequent sweep, but changing plans is not automatic.

Refund and transfer response-loss recovery searches all pages for the persisted operation identity before creating another provider operation. Competing fund-reclaim handlers share a frozen reversal operation and apply it once. A transferred-but-interrupted allocation can be reclaimed before finalization and then finish with its remaining principal.

If a recipient transfer is skipped after the donor charge settles, its Ask capacity stays reserved and a targeted recovery case is opened. No recipient-delivery success is invented. A financial administrator can issue the full remaining refund. Missing/ambiguous transfer execution or an unavailable recipient balance remains an explicit financial-reconciliation case; do not release reservations solely because a timeout elapsed or fabricate provider IDs to close it.

## Verification boundaries

`tests/unit/payments*.test.ts` cover pure amount, policy, entitlement, and proration rules. `tests/integration/payments*.test.ts` use only the dedicated CI database. Database races, immutable journals, signature/inbox boundaries, real tRPC authorization, and domain projections are exercised. Recovery contract tests explicitly stub Stripe transport and retain frozen/inactive synthetic CI audit principals; they are **not Stripe sandbox verification**.

Real sandbox verification is still required before enabling payments: Accounts v2 eligibility and embedded onboarding, v2 customer `test_clock` behavior, hosted Checkout success/decline/async failures, subscription renewal/proration/cancellation, refunds, disputes, skipped transfers, and hosted webhook/workflow delivery. Test clocks are supported by the installed v2 customer SDK types, but this does not establish provider-account eligibility or a passed test-clock lifecycle.

Production requires live credentials, explicit live approval, configured fees, and independent feature flags. No live feature should be enabled on the strength of synthetic fixtures or deployment readiness alone.
