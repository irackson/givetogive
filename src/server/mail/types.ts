export type AppId = 'mycommunityresources' | 'givetogive' | 'personal-call-concierge';
export type MessageKind = 'otp' | 'email-verification' | 'password-reset' | 'budget-notice' | 'campaign';
export interface Identity {
  readonly name: string; readonly from: string; readonly replyTo: string; readonly origin: string;
}
export interface PreparedMessage {
  readonly app: AppId; readonly kind: MessageKind; readonly to: string;
  readonly from: string; readonly replyTo: string; readonly subject: string;
  readonly html: string; readonly text: string; readonly unsubscribeURL?: string;
  readonly messageExpiresAt?: number;
  readonly templateVersion?: string;
}
export type UnknownReason = 'deadline' | 'network_or_body' | 'unrecognized_response'
  | 'malformed_acceptance' | 'receipt_unavailable' | 'in_progress_or_uncertain'
  | 'provider_id_conflict' | 'intent_conflict';
export type Outcome =
  | { readonly state: 'accepted'; readonly providerMessageId: string }
  | { readonly state: 'rejected'; readonly reason: 'provider_rejection' | 'intent_conflict' | 'invalid_message'; readonly httpStatus?: number }
  | { readonly state: 'unknown'; readonly reason: UnknownReason };
export type DeliveryResult = Outcome & {
  readonly deduplicated: boolean; readonly receipt: 'recorded' | 'uncertain';
  readonly retryAllowed: false;
};
export interface ClaimRequest {
  readonly key: string; readonly binding: string; readonly app: AppId; readonly providerScope: string;
  readonly messageExpiresAt?: number;
  readonly templateVersion?: string; readonly recipientBinding?: string;
}
export interface IntentSnapshot {
  readonly issuedCounter: number;
  readonly messageExpiresAt: number; readonly templateVersion: string; readonly recipientBinding: string;
  readonly binding: string; readonly providerScope: string; readonly outcome?: Outcome;
}
export type Reservation =
  | { readonly state: 'new'; readonly claim: string }
  | { readonly state: 'conflict' }
  | { readonly state: 'existing'; readonly outcome?: Outcome };
/**
 * Requires actual atomic durable storage before effects. A new claim is already
 * persisted as submitting. No lease expiry or automatic takeover may resend it.
 * Outcomes are immutable. complete must fence by claim and enforce provider-ID
 * uniqueness inside providerScope; collision is atomically quarantined.
 */
export interface ReceiptStore {
  snapshot?(key: string): Promise<IntentSnapshot | undefined>;
  reserve(request: ClaimRequest): Promise<Reservation>;
  complete(claim: string, outcome: Outcome): Promise<'saved' | 'provider_id_conflict' | 'stale'>;
}
/** Host-owned keyed binding of every immutable envelope/body field + scope.
 * No raw email/code/body or unkeyed low-entropy OTP hash belongs in receipt state.
 * There is deliberately no default binder or store.
 */
export type PayloadBinder = (message: PreparedMessage, providerScope: string) => Promise<string>;
export type RecipientBinder = (recipient: string, providerScope: string) => Promise<string>;
export type FetchLike = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: FormData;
  signal: AbortSignal; redirect: 'error';
}) => Promise<Response>;
export interface TransportConfig {
  readonly apiKey: string; readonly domain: 'ianrackson.com'; readonly region: 'us' | 'eu';
  readonly timeoutMs?: number;
}

