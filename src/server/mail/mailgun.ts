import 'server-only';
import type { Outcome, DeliveryResult, TransportConfig, FetchLike, ReceiptStore, PayloadBinder, RecipientBinder } from './types.ts';
import { MailPolicyError, snapshotMessage } from './policy.ts';
import type { PreparedMessage } from './types.ts';
import { isRenderedMessage } from './templates.ts';

const MAX_RESPONSE_BYTES = 4096;
const MAX_RESPONSE_CHUNKS = 4096;
const DEFINITE_REJECTIONS = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);
class DeadlineError extends Error {}
function result(outcome: Outcome, deduplicated: boolean, receipt: 'recorded' | 'uncertain'): DeliveryResult {
  return Object.freeze({ ...outcome, deduplicated, receipt, retryAllowed: false });
}
async function boundedBody(response: Response, signal: AbortSignal, deadline: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing_body');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reads = 0;
  try {
    while (true) {
      if (signal.aborted || performance.now() >= deadline) { cancel(); throw new DeadlineError(); }
      const part = await reader.read();
      if (signal.aborted || performance.now() >= deadline) { cancel(); throw new DeadlineError(); }
      if (part.done) break;
      if (++reads > MAX_RESPONSE_CHUNKS) { cancel(); throw new Error('oversize_chunks'); }
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error('oversize_body');
      }
      if (part.value.byteLength > 0) chunks.push(part.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
/** This factory has no env loading, global fetch, implicit store, retry or fallback. */
export function createMailgunDelivery(config: TransportConfig, dependencies: {
  fetch: FetchLike; store: ReceiptStore; bind: PayloadBinder;
  bindRecipient?: RecipientBinder;
}) {
  const region = config.region, domain = config.domain, apiKey = config.apiKey;
  if (domain !== 'ianrackson.com' || !['us', 'eu'].includes(region)
    || typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 256
    || /[\s:]/.test(apiKey)) throw new MailPolicyError('invalid_transport_configuration');
  if (!dependencies || typeof dependencies.fetch !== 'function' || typeof dependencies.bind !== 'function'
    || typeof dependencies.store?.reserve !== 'function' || typeof dependencies.store?.complete !== 'function') {
    throw new MailPolicyError('missing_delivery_dependencies');
  }
  const timeoutMs = config.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MailPolicyError('invalid_deadline');
  // Snapshot configuration/dependencies before any asynchronous operation.
  const send = dependencies.fetch, bind = dependencies.bind, store = dependencies.store;
  const bindRecipient = dependencies.bindRecipient;
  const reserve = store.reserve.bind(store), complete = store.complete.bind(store);
  const providerScope = 'mailgun:' + region + ':' + domain;
  const endpoint = 'https://' + (region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net') + '/v3/' + domain + '/messages';

  return async function deliver(key: string, input: PreparedMessage): Promise<DeliveryResult> {
    let message: PreparedMessage;
    try {
      if (typeof key !== 'string' || !/^mail:[a-f0-9]{32}$/.test(key)) throw new MailPolicyError('invalid_intent_key');
      if (!isRenderedMessage(input)) throw new MailPolicyError('unprepared_message');
      message = snapshotMessage(input);
    } catch {
      return result({ state: 'rejected', reason: 'invalid_message' }, false, 'uncertain');
    }
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((__, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new DeadlineError()); }, timeoutMs);
    });
    const beforeDeadline = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (performance.now() >= deadline || controller.signal.aborted) throw new DeadlineError();
      const value = await Promise.race([Promise.resolve().then(() => {
        if (performance.now() >= deadline || controller.signal.aborted) throw new DeadlineError();
        return operation();
      }), timeout]);
      if (performance.now() >= deadline || controller.signal.aborted) throw new DeadlineError();
      return value;
    };
    const finish = (value: Outcome, deduplicated: boolean, receipt: 'recorded' | 'uncertain') => {
      if (timer !== undefined) clearTimeout(timer);
      return result(value, deduplicated, receipt);
    };
    let claim: string | undefined;
    let outcome: Outcome = { state: 'unknown', reason: 'malformed_acceptance' };
    let networkStarted = false;
    try {
      // The verified renderer object is already frozen and canonical. Bind that
      // exact trusted object; the equivalent validated snapshot is used for HTTP.
      const binding = await beforeDeadline(() => bind(input, providerScope));
      if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)) throw new Error('invalid_binding');
      const recipientBinding = bindRecipient ? await beforeDeadline(() => bindRecipient(message.to,providerScope)) : undefined;
      if (recipientBinding !== undefined && !/^[a-f0-9]{64}$/.test(recipientBinding)) throw new Error('invalid_binding');
      const reservation = await beforeDeadline(() => reserve({ key, binding, app: message.app, providerScope,
        ...(message.messageExpiresAt === undefined ? {} : { messageExpiresAt: message.messageExpiresAt }),
        ...(message.templateVersion === undefined ? {} : { templateVersion: message.templateVersion }),
        ...(recipientBinding === undefined ? {} : { recipientBinding }) }));
      if (reservation.state === 'conflict') return finish({ state: 'unknown', reason: 'intent_conflict' }, true, 'recorded');
      if (reservation.state === 'existing') {
        return finish(reservation.outcome ?? { state: 'unknown', reason: 'in_progress_or_uncertain' }, true, 'recorded');
      }
      claim = reservation.claim;
      if (typeof claim !== 'string' || !claim) throw new Error('invalid_claim');
      const form = new FormData();
      form.set('from', message.from); form.set('to', message.to); form.set('subject', message.subject);
      form.set('h:Reply-To', message.replyTo); form.set('html', message.html); form.set('text', message.text);
      if (message.unsubscribeURL) form.set('h:List-Unsubscribe', '<' + message.unsubscribeURL + '>');
      // No one-click header until an actual signed POST unsubscribe endpoint is accepted.
      form.set('o:tracking', 'no'); form.set('o:tracking-clicks', 'no'); form.set('o:tracking-opens', 'no');
      const response = await beforeDeadline(() => {
        networkStarted = true;
        return send(endpoint, { method: 'POST', redirect: 'error',
          headers: { Authorization: 'Basic ' + Buffer.from('api:' + apiKey).toString('base64') },
          body: form, signal: controller.signal });
      });
      if (DEFINITE_REJECTIONS.has(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        outcome = { state: 'rejected', reason: 'provider_rejection', httpStatus: response.status };
      } else if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        outcome = { state: 'unknown', reason: 'unrecognized_response' };
      } else {
        let decoded: unknown;
        try { decoded = JSON.parse(await beforeDeadline(() => boundedBody(response, controller.signal, deadline))); }
        catch (error) {
          if (error instanceof DeadlineError) throw error;
          outcome = { state: 'unknown', reason: 'malformed_acceptance' };
        }
        if (decoded !== undefined) {
          const data = decoded as { id?: unknown; message?: unknown };
          if (data && !Array.isArray(data) && typeof data.id === 'string'
            && /^[\x21-\x7e]{1,512}$/.test(data.id) && typeof data.message === 'string'
            && data.message.length > 0 && data.message.length <= 256) {
            outcome = { state: 'accepted', providerMessageId: data.id };
          } else outcome = { state: 'unknown', reason: 'malformed_acceptance' };
        }
      }
    } catch (error) {
      outcome = { state: 'unknown', reason: error instanceof DeadlineError ? 'deadline'
        : networkStarted ? 'network_or_body' : 'receipt_unavailable' };
    }
    try {
      // A timed-out attempt stays submitting/uncertain; never schedule a new write
      // or resend after the total deadline. A late atomic completion may settle it.
      if (!claim) return result(outcome!, false, 'uncertain');
      const completion = await beforeDeadline(() => complete(claim!, outcome!));
      if (completion === 'provider_id_conflict') {
        return result({ state: 'unknown', reason: 'provider_id_conflict' }, false, 'recorded');
      }
      return result(outcome!, false, completion === 'saved' ? 'recorded' : 'uncertain');
    } catch { return result(outcome!, false, 'uncertain'); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
}

