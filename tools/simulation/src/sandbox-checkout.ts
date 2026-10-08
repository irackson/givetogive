import { setTimeout as sleep } from 'node:timers/promises';
import { Semaphore } from './semaphore.ts';
import { checkoutOutcomeSchema, checkoutScenarios, validateCheckoutContext, type CheckoutOutcome, type CheckoutScenario, type SandboxBoundary, type VerifiedCheckout } from './sandbox-policy.ts';
import { SandboxLedger } from './sandbox-ledger.ts';
import type { CheckoutDriver } from './stripe-checkout-driver.ts';

export type SandboxCheckoutApi = { context(operationId: string): Promise<unknown>; outcome(operationId: string): Promise<unknown> };
type Result = { operationId: string; scenario: CheckoutScenario; result: 'verified_success' | 'verified_decline' | 'verified_authentication_failure' | 'canceled_unpaid'; effectiveTier?: string };
function assertSameCheckout(original: VerifiedCheckout, current: VerifiedCheckout) {
  // verifiedAt is intentionally refreshed. Every other provider/ownership field
  // must still identify the admitted session, including its opaque URL fragment.
  const { verifiedAt: _originalTime, ...originalBinding } = original;
  const { verifiedAt: _currentTime, ...currentBinding } = current;
  if (Object.keys(originalBinding).some(key => originalBinding[key as keyof typeof originalBinding] !== currentBinding[key as keyof typeof currentBinding])) throw new Error('Checkout changed before submission.');
}
export function matchingSandboxOutcome(scenario: CheckoutScenario, outcome: CheckoutOutcome): Result['result'] | undefined {
  if (['success', 'three_ds_success'].includes(scenario) && outcome.databaseStatus === 'succeeded' && outcome.providerPaymentStatus === 'succeeded' && outcome.webhookVerified) return 'verified_success';
  if (scenario === 'decline' && outcome.providerPaymentStatus === 'requires_payment_method' && outcome.providerErrorCode === 'card_declined' && outcome.databaseStatus !== 'succeeded') return 'verified_decline';
  if (scenario === 'three_ds_failure' && outcome.providerPaymentStatus === 'requires_payment_method' && ['payment_intent_authentication_failure', 'authentication_required'].includes(outcome.providerErrorCode ?? '') && outcome.databaseStatus !== 'succeeded') return 'verified_authentication_failure';
  if (scenario === 'cancel' && ['requires_payment_method', 'unpaid', 'open'].includes(outcome.providerPaymentStatus) && !['succeeded', 'refunded', 'partially_refunded'].includes(outcome.databaseStatus)) return 'canceled_unpaid';
  return undefined;
}

export class SandboxCheckoutExecutor {
  // Stripe explicitly discourages load tests against its sandbox. This lane is serial.
  private readonly slots = new Semaphore(1);
  private ledger: SandboxLedger; private makeDriver: (admitNotice: () => Promise<void>) => CheckoutDriver;
  constructor(ledger: SandboxLedger, makeDriver: (admitNotice: () => Promise<void>) => CheckoutDriver) { this.ledger = ledger; this.makeDriver = makeDriver; }
  private async outcome(api: SandboxCheckoutApi, boundary: SandboxBoundary): Promise<CheckoutOutcome> {
    const parsed = checkoutOutcomeSchema.safeParse(await api.outcome(boundary.operationId));
    if (!parsed.success || parsed.data.actorId !== boundary.actorId || parsed.data.operationId !== boundary.operationId) throw new Error('Invalid actor-owned test payment outcome.');
    return parsed.data;
  }
  async execute(api: SandboxCheckoutApi, boundary: SandboxBoundary, scenario: CheckoutScenario, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<Result> {
    if (!checkoutScenarios.includes(scenario)) throw new Error('Unknown fixed sandbox scenario.');
    const timeoutMs = options.timeoutMs ?? 60000; const pollMs = options.pollMs ?? 2000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isFinite(pollMs) || pollMs < 1000 || pollMs > 10000) throw new Error('Invalid bounded polling settings.');
    return this.slots.run(async () => {
      const verified = validateCheckoutContext(await api.context(boundary.operationId), boundary);
      this.ledger.reserve(boundary.operationId, boundary.actorId, verified.amountTotal, scenario);
      const driver = this.makeDriver(async () => {
        const current = validateCheckoutContext(await api.context(boundary.operationId), boundary);
        assertSameCheckout(verified, current);
        this.ledger.acknowledgeAgentNotice(boundary.operationId, boundary.actorId);
      }); let phase = 'opening';
      try {
        await driver.open(verified);
        const refreshed = validateCheckoutContext(await api.context(boundary.operationId), boundary);
        assertSameCheckout(verified, refreshed);
        if (scenario === 'cancel') { phase = 'canceling'; await driver.cancel(); }
        else {
          phase = 'filling'; await driver.fillFixture(scenario);
          phase = 'pre-submit verification';
          const preSubmit = validateCheckoutContext(await api.context(boundary.operationId), boundary);
          assertSameCheckout(verified, preSubmit);
          // Save before clicking: crashes/timeouts after this point must never cause another submit.
          this.ledger.update(boundary.operationId, 'submitted'); phase = 'submitting'; await driver.submit();
          if (scenario.startsWith('three_ds_')) { phase = 'authenticating'; await driver.challenge(scenario === 'three_ds_success'); }
        }
        phase = 'reconciling'; const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const outcome = await this.outcome(api, boundary);
          const result = matchingSandboxOutcome(scenario, outcome);
          if (result) { this.ledger.update(boundary.operationId, result); return { operationId: boundary.operationId, scenario, result, ...(outcome.effectiveTier ? { effectiveTier: outcome.effectiveTier } : {}) }; }
          await sleep(pollMs);
        }
        throw new Error('Authoritative outcome deadline exceeded.');
      } catch {
        this.ledger.update(boundary.operationId, 'ambiguous');
        // Never bubble a Playwright/provider error: it can embed test PAN, URL tokens, or entered fields.
        throw new Error(`Sandbox Checkout did not finish safely during ${phase}. Reconcile the existing operation; do not resubmit.`);
      } finally { await driver.close(); }
    });
  }
}
