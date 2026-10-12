import 'server-only';
import type { AppId, PreparedMessage } from './types.ts';
import { assertKind, escapeHTML as e, identity, MailPolicyError, ownedURL, plain, recipient, snapshotMessage } from './policy.ts';

type Base = { app: AppId; to: string; name?: string };
// Runtime provenance: only this renderer can issue an immutable prepared body.
// JSON, structural copies and hand-built HTML cannot cross the send boundary.
const renderedMessages = new WeakSet<PreparedMessage>();
export function isRenderedMessage(value: unknown): value is PreparedMessage {
  return typeof value === 'object' && value !== null && renderedMessages.has(value as PreparedMessage);
}
export type TemplateInput =
  | (Base & { kind: 'otp'; code: string })
  | (Base & { kind: 'email-verification' | 'password-reset'; actionURL: string })
  | (Base & { kind: 'budget-notice'; actualUsd: number })
  | (Base & { kind: 'campaign'; title: string; body: string; actionURL: string;
      subscription: { scope: 'blog' | 'projects' | 'app-updates'; unsubscribeURL: string } });

export function renderMessage(input: TemplateInput): PreparedMessage {
  assertKind(input.app, input.kind);
  recipient(input.to);
  if ('unsubscribeURL' in input || (input.kind !== 'campaign' && 'subscription' in input)) {
    throw new MailPolicyError('transactional_unsubscribe');
  }
  const p = identity(input.app);
  const greeting = input.name === undefined ? 'Hello,' : 'Hello ' + plain(input.name, 120) + ',';
  let heading: string, subject: string, prose: string, bodyHTML: string;
  let action: { label: string; url: string } | undefined;
  let unsubscribeURL: string | undefined;
  let scope: string | undefined;
  switch (input.kind) {
    case 'otp': {
      if (typeof input.code !== 'string' || !/^[0-9]{6}$/.test(input.code)) throw new MailPolicyError('invalid_code');
      heading = 'Your sign-in code'; subject = p.name + ' sign-in code';
      // Deliberately no false five-minute issuance-relative promise.
      prose = 'Use this code before it expires: ' + input.code
        + '\nEach code can be used only once. If it has already been used, request a new code when available.';
      bodyHTML = '<p>Use this code before it expires:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold">' + e(input.code)
        + '</p><p>Each code can be used only once. If it has already been used, request a new code when available.</p>';
      break;
    }
    case 'email-verification':
    case 'password-reset': {
      const verify = input.kind === 'email-verification';
      heading = verify ? 'Verify your email address' : 'Reset your password';
      subject = p.name + ': ' + heading;
      action = { label: verify ? 'Verify email' : 'Reset password', url: ownedURL(input.actionURL, input.app) };
      prose = (verify ? 'Confirm your email address using the link below.' : 'Choose a new password using the link below.')
        + '\nThis link expires according to the application policy and can be used only once.';
      bodyHTML = '<p>' + e(prose).replace(/\n/g, '</p><p>') + '</p>';
      break;
    }
    case 'budget-notice': {
      if (!Number.isFinite(input.actualUsd) || input.actualUsd < 2) throw new MailPolicyError('invalid_amount');
      heading = 'Project budget notice'; subject = p.name + ': project budget notice';
      prose = 'Recorded project use has reached $' + input.actualUsd.toFixed(2)
        + '.\nYour one-time project allowance remains $10.00. This notice does not reset the allowance or purchase credits.';
      bodyHTML = '<p>' + e(prose).replace(/\n/g, '</p><p>') + '</p>';
      break;
    }
    case 'campaign': {
      heading = plain(input.title, 150); subject = p.name + ': ' + heading;
      prose = plain(input.body, 5000);
      if (!input.subscription || !['blog', 'projects', 'app-updates'].includes(input.subscription.scope)) {
        throw new MailPolicyError('invalid_subscription');
      }
      scope = input.subscription.scope;
      unsubscribeURL = ownedURL(input.subscription.unsubscribeURL, input.app);
      action = { label: 'Read the update', url: ownedURL(input.actionURL, input.app) };
      bodyHTML = '<p>' + e(prose).replace(/\n/g, '<br>') + '</p>';
      break;
    }
    default: throw new MailPolicyError('invalid_kind');
  }
  const footer = input.kind === 'campaign'
    ? 'You subscribed to ' + scope + ' updates. Unsubscribe from ' + scope + ': ' + unsubscribeURL + '\nYour other subscriptions stay unchanged.'
    : (input.kind === 'budget-notice' ? 'This is an operational notice.' : 'If you did not request this action, you can ignore this message.');
  const footerHTML = unsubscribeURL
    ? 'You subscribed to ' + e(scope!) + ' updates. <a href="' + e(unsubscribeURL) + '">Unsubscribe from ' + e(scope!) + '</a>.<br>Your other subscriptions stay unchanged.'
    : e(footer);
  const button = action
    ? '<p><a href="' + e(action.url) + '" style="display:inline-block;background:#302b43;color:#fff;padding:16px 24px;border-radius:8px;text-decoration:none">' + e(action.label) + '</a></p>'
    : '';
  const text = greeting + '\n\n' + p.name + '\n' + heading + '\n\n' + prose
    + (action ? '\n\n' + action.label + ': ' + action.url : '')
    + '\n\n' + footer + '\nContact: ' + p.replyTo + '\n' + p.origin;
  // No remote images, script, tracking pixel or external font fetch.
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'
    + e(heading) + '</title><style>@media(max-width:620px){.content{padding:24px!important}.heading{font-size:28px!important}}a:focus-visible{outline:3px solid #7266b2;outline-offset:4px}</style></head>'
    + '<body style="margin:0;background:#f4f2ef;color:#252332;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="600" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e0e9;border-radius:16px"><tr><td class="content" style="padding:40px;overflow-wrap:anywhere">'
    + '<a href="' + e(p.origin) + '" style="color:#302b43;font-size:20px;font-weight:bold">' + e(p.name) + '</a><p>' + e(greeting) + '</p>'
    + '<h1 class="heading" style="font-size:36px">' + e(heading) + '</h1>' + bodyHTML + button
    + '<p style="font-size:12px;color:#625e6d">' + footerHTML + '</p><p style="font-size:12px">Contact: <a href="mailto:' + e(p.replyTo) + '">' + e(p.replyTo)
    + '</a></p></td></tr></table></td></tr></table></body></html>';
  const prepared = snapshotMessage({ app: input.app, kind: input.kind, to: input.to, from: p.from, replyTo: p.replyTo, subject, html, text,
    ...(unsubscribeURL ? { unsubscribeURL } : {}) });
  renderedMessages.add(prepared);
  return prepared;
}

