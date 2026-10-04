# Guarded hosted Checkout testing

Status: the pure policy/protocol is reviewed and its 24/24 offline tests pass. It has no executable adapter, workflow, browser, authentication, filesystem or provider entrypoint. Runtime adapter work is separate and unfinished; offline tests are not payment acceptance.

The community runner is already hosted separately. Checkout needs its own narrowly scoped manual job, sharing staging concurrency, rather than a new community capability or an administrative purchase shortcut.

## First bounded scenario

Use the existing unused Sustainer operation `284c4f9d-6aec-4910-bbb2-ef7b1a9d2ff7` for synthetic member `synthetic-6658c4939d672ff5-002`, only after independently rechecking its actual unused state. The original USD 25 test admission remains unchanged: two expired USD 5 reservations plus the USD 15 candidate. Do not reset budgets, replay expired sessions, grant entitlements directly, or substitute a provider-only purchase.

Prepare exactly once through the ordinary authenticated `billing.createCheckout` API, with durable original admission. Stripe credentials and database/admin credentials remain local. Transfer only the selected synthetic password, staging protection and exact job/source/session bindings through a private encrypted, unpublished draft; no public artifact or plaintext log.

The dedicated member worker must use normal cookie authentication, four exact ordinary billing GETs and repeated actual session checks. It receives no provider, database, broker, admin, runner or MCP token. The broker alone holds the private-transfer key and short-lived GitHub token. Explicit child environment filtering is process isolation, not a strong same-UID operating-system sandbox.

## Browser admission and uncertainty

- Verify fresh, independently inspected open/unpaid test Checkout, exact USD 15/subscription/customer/clock/operation/return URLs, source and original budget before opening and immediately before submission.
- Permit only the exact attested initial Checkout navigation and strictly owned subordinate resources. Never forward staging protection to Stripe.
- If present, inspect only the exact previously reviewed optional agent panel. One ordinary visible acknowledgment needs a durable intent. Link CLI remains deferred; unknown instructions, CAPTCHA, wallet or legal attestations stop the test.
- Require fresh actual test-mode/card controls and no remaining panel before entering the fixed public Stripe success-card fixture, and again before financial submission. Do not force hidden controls or save card-field screenshots, traces, HAR or raw provider errors.
- Exclusively create/fsync/read back the original submit intent. Encrypt and verify its immutable private retained asset before exactly one ordinary Subscribe click. Typed adapter assertions are not a substitute for implementing and observing this durability.
- A timeout, disconnect or uncertain admission never authorizes another click, another Checkout, an automatic cancellation/refund or a budget reset.
- Retain original partial/final receipts privately and prove actual API, context, browser and owned-process closure separately from child exit.

## Independent acceptance

Cloud receipts always report `paymentAccepted:false`. Root must reconcile the actual paid invoice, active subscription, succeeded PaymentIntent/captured charge, processed owned signed webhook inbox, paid invoice-line coverage, balanced exactly-once ledger and normal member recognition. A redirect or provider success alone cannot grant a tier.

Renewal, tier changes, cancellation, failed/3DS payments, refunds/disputes, monetary Asks, funds and Connect remain separate actual scenarios. This first policy is not evidence that any of those are finished or that live production payments are enabled.

References: [Stripe test cards](https://docs.stripe.com/testing), [webhook-based fulfillment](https://docs.stripe.com/checkout/fulfillment), [API-key safety](https://docs.stripe.com/keys-best-practices).
