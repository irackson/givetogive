import type { ReceiptStore, ClaimRequest, Reservation, Outcome } from '../../../src/server/mail/types.ts';
import { createHmac } from 'node:crypto';
import type { PayloadBinder } from '../../../src/server/mail/types.ts';

/** In-memory atomic model ONLY. It is not durable or a production integration. */
export class SyntheticReceiptStore implements ReceiptStore {
  readonly records = new Map<string, ClaimRequest & { claim: string; outcome?: Outcome }>();
  readonly ids = new Map<string, string>();
  reserveCount = 0; completeCount = 0;
  async reserve(request: ClaimRequest): Promise<Reservation> {
    this.reserveCount++;
    const existing = this.records.get(request.key);
    if (existing) {
      if (existing.binding !== request.binding || existing.providerScope !== request.providerScope || existing.app !== request.app) {
        return { state: 'conflict' };
      }
      return { state: 'existing', ...(existing.outcome ? { outcome: { ...existing.outcome } } : {}) };
    }
    const claim = 'synthetic-claim-' + this.reserveCount;
    this.records.set(request.key, { ...request, claim });
    return { state: 'new', claim };
  }
  async complete(claim: string, outcome: Outcome): Promise<'saved' | 'provider_id_conflict' | 'stale'> {
    this.completeCount++;
    const record = [...this.records.values()].find(entry => entry.claim === claim);
    if (!record || record.outcome) return 'stale';
    if (outcome.state === 'accepted') {
      const scopedId = record.providerScope + '\0' + outcome.providerMessageId;
      const previous = this.ids.get(scopedId);
      if (previous !== undefined && previous !== record.key) {
        record.outcome = { state: 'unknown', reason: 'provider_id_conflict' };
        return 'provider_id_conflict';
      }
      this.ids.set(scopedId, record.key);
    }
    record.outcome = { ...outcome };
    return 'saved';
  }
}
// Public fixture material, not a generated/stored credential. No env loading.
export const syntheticBinder: PayloadBinder = async (message, scope) =>
  createHmac('sha256', 'PUBLIC-SYNTHETIC-FIXTURE-NOT-A-CREDENTIAL')
    .update(scope).update('\0').update(JSON.stringify(message)).digest('hex');
export const intent = (number: number): string => 'mail:' + number.toString(16).padStart(32, '0');

