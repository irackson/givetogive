/** Encrypted, nonfinancial inspection input. No provider SDK or payment admission.
 * The capture is time-bounded read-only evidence, NOT a fresh pre-submit proof. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { checkoutContextSchema, sandboxOrigin, type VerifiedCheckout } from './sandbox-policy.ts';

const reject = (): never => { throw Error('Read-only Checkout inspection input rejected; private details withheld.'); };
function guard(value: unknown): asserts value { if (!value) reject(); }
const bindingSchema = z.object({ head: z.string().regex(/^[a-f0-9]{40}$/), nonce: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
type Binding = z.infer<typeof bindingSchema>;
const payloadSchema = z.object({ purpose: z.literal('read-only-checkout-surface-v1'), head: bindingSchema.shape.head,
  nonce: bindingSchema.shape.nonce, issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  email: z.email().max(254).refine(value => value.endsWith('@givetogive.invalid')),
  checkout: checkoutContextSchema.strict(),
}).strict();
export type SurfaceInspectionPayload = z.infer<typeof payloadSchema>;
const aad = (binding: Binding) => Buffer.from(`givetogive:nonfinancial-checkout-surface:v1:${binding.head}:${binding.nonce}`);
function validatePayload(raw: unknown, binding: Binding, now: number) {
  const value = payloadSchema.parse(raw), issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt);
  guard(value.head === binding.head && value.nonce === binding.nonce && Number.isSafeInteger(now));
  guard(issued <= now + 5000 && now < expires && expires - issued === 600000);
  // The original provider proof stays original; never mint a new verifiedAt to
  // pass the stricter financial validator after queue/install time has elapsed.
  const proofAgeAtCapture = issued - Date.parse(value.checkout.verifiedAt);
  guard(proofAgeAtCapture >= -5000 && proofAgeAtCapture <= 30000);
  const checkout = value.checkout, url = new URL(checkout.url);
  guard(checkout.environment === 'staging' && checkout.databaseIdentity === 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7' &&
    checkout.returnOrigin === sandboxOrigin && checkout.actorId.startsWith('synthetic-') && z.uuid().safeParse(checkout.runId).success &&
    checkout.livemode === false && checkout.status === 'open' && checkout.paymentStatus === 'unpaid' &&
    checkout.amountTotal <= 1500 && checkout.expiresAt * 1000 > now + 15000);
  guard(url.origin === 'https://checkout.stripe.com' && !url.username && !url.password && !url.search &&
    url.pathname === `/c/pay/${checkout.sessionId}`);
  return value;
}
export function sealSurfaceInspection(key: Buffer, checkout: VerifiedCheckout, email: string, rawBinding: Binding, now = Date.now()) {
  let bytes: Buffer | undefined;
  try {
    const binding = bindingSchema.parse(rawBinding); guard(key.length === 32);
    const value = validatePayload({ purpose: 'read-only-checkout-surface-v1', ...binding, email, checkout,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString() }, binding, now);
    bytes = Buffer.from(JSON.stringify(value)); guard(bytes.length <= 8192);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad(binding));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
  } catch { return reject(); } finally { bytes?.fill(0); }
}
export function openSurfaceInspection(key: Buffer, ciphertext: string, rawBinding: Binding, now = Date.now()) {
  let bytes: Buffer | undefined, plain: Buffer | undefined;
  try {
    const binding = bindingSchema.parse(rawBinding); guard(key.length === 32 && ciphertext.length <= 12000 && /^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext));
    bytes = Buffer.from(ciphertext, 'base64'); guard(bytes.length > 28 && bytes.length <= 8220 && bytes.toString('base64') === ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(aad(binding)); decipher.setAuthTag(bytes.subarray(-16));
    plain = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
    return validatePayload(JSON.parse(plain.toString('utf8')), binding, now);
  } catch { return reject(); } finally { bytes?.fill(0); plain?.fill(0); }
}
