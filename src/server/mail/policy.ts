import 'server-only';
import type { AppId, Identity, PreparedMessage, MessageKind } from './types.ts';

export class MailPolicyError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'MailPolicyError'; this.code = code; }
}
export const IDENTITIES: Readonly<Record<AppId, Identity>> = Object.freeze({
  mycommunityresources: Object.freeze({
    name: 'MyCommunityResources', from: 'MyCommunityResources <noreply@ianrackson.com>',
    replyTo: 'mycommunityresources@ianrackson.com', origin: 'https://mycommunityresources.ianrackson.com',
  }),
  givetogive: Object.freeze({
    name: 'GiveToGive', from: 'GiveToGive <noreply@ianrackson.com>',
    replyTo: 'givetogive@ianrackson.com', origin: 'https://givetogive.ianrackson.com',
  }),
  'personal-call-concierge': Object.freeze({
    name: 'Personal Call Concierge', from: 'Personal Call Concierge <noreply@ianrackson.com>',
    replyTo: 'illhavemyagentcall@ianrackson.com', origin: 'https://illhavemyagentcall.ianrackson.com',
  }),
});
const ALLOWED: Readonly<Record<AppId, readonly MessageKind[]>> = Object.freeze({
  mycommunityresources: Object.freeze(['otp', 'campaign'] as const),
  givetogive: Object.freeze(['email-verification', 'password-reset', 'campaign'] as const),
  'personal-call-concierge': Object.freeze(['otp', 'budget-notice', 'campaign'] as const),
});
export function identity(app: AppId): Identity {
  if (!Object.hasOwn(IDENTITIES, app)) throw new MailPolicyError('invalid_app');
  return IDENTITIES[app];
}
export function assertKind(app: AppId, kind: MessageKind): void {
  identity(app);
  if (!ALLOWED[app].includes(kind)) throw new MailPolicyError('invalid_kind');
}
export function plain(value: unknown, limit = 5000): string {
  if (typeof value !== 'string' || !value.length || value.length > limit
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new MailPolicyError('invalid_text');
  }
  return value;
}
export function header(value: unknown, limit = 180): string {
  const result = plain(value, limit);
  if (/[\r\n]/.test(result)) throw new MailPolicyError('invalid_header');
  return result;
}
export function recipient(value: unknown): string {
  const result = header(value, 254);
  // One conservative ASCII addr-spec; no display names, lists, CC or BCC.
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(result)) {
    throw new MailPolicyError('invalid_recipient');
  }
  const [local, domain] = result.split('@');
  if (local === undefined || domain === undefined || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || domain.length > 253 || domain.split('.').some(label => label.length > 63)) {
    throw new MailPolicyError('invalid_recipient');
  }
  return result;
}
export function ownedURL(value: unknown, app: AppId): string {
  const raw = header(value, 2048);
  let url: URL;
  try { url = new URL(raw); } catch { throw new MailPolicyError('invalid_link'); }
  if (url.protocol !== 'https:' || url.origin !== identity(app).origin
    || url.username || url.password || url.hash) throw new MailPolicyError('invalid_link');
  return url.href;
}
export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
/** Snapshot before asynchronous binding/reservation; enforce exact identities at send boundary. */
export function snapshotMessage(input: PreparedMessage): PreparedMessage {
  if (!input || typeof input !== 'object') throw new MailPolicyError('invalid_message');
  const app = input.app, kind = input.kind, profile = identity(app);
  assertKind(app, kind);
  if (input.from !== profile.from || input.replyTo !== profile.replyTo) throw new MailPolicyError('invalid_identity');
  const unsubscribeURL = kind === 'campaign' ? ownedURL(input.unsubscribeURL, app) : undefined;
  if (kind !== 'campaign' && input.unsubscribeURL !== undefined) throw new MailPolicyError('transactional_unsubscribe');
  const result: PreparedMessage = {
    app, kind, to: recipient(input.to), from: profile.from, replyTo: profile.replyTo,
    subject: header(input.subject), html: plain(input.html, 32_000), text: plain(input.text, 16_000),
    ...(unsubscribeURL ? { unsubscribeURL } : {}),
  };
  if (Buffer.byteLength(result.html, 'utf8') > 32_000 || Buffer.byteLength(result.text, 'utf8') > 16_000) {
    throw new MailPolicyError('message_too_large');
  }
  return Object.freeze(result);
}

