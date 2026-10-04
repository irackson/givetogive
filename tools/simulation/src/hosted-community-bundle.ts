import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { requireHosted, sha256 } from './hosted-community-policy.ts';

const magic = Buffer.from('G2GHOST1');
const maximum = 128 * 1024 * 1024;
export const fileSchema = z.object({ name: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.string() }).strict();
export type PrivateFile = z.infer<typeof fileSchema>;
export function privateFile(name: string, bytes: Buffer): PrivateFile {
 requireHosted(bytes.length <= maximum);
 return { name, digest: sha256(bytes), bytes: bytes.toString('base64') };
}
export function fileBytes(value: PrivateFile) {
 // Repeated regex groups overflow V8's stack on ordinary multi-MiB journals.
 // Bound before allocation and round-trip to reject the decoder's permissive forms.
 requireHosted(typeof value.bytes === 'string' && value.bytes.length <= 4 * Math.ceil(maximum / 3));
 const bytes = Buffer.from(value.bytes, 'base64');
 try {
  requireHosted(bytes.length <= maximum && bytes.toString('base64') === value.bytes && sha256(bytes) === value.digest);
  return bytes;
 } catch (error) { bytes.fill(0); throw error; }
}
export function encryptionKey(raw: string | undefined) {
 requireHosted(typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw));
 return Buffer.from(raw, 'hex');
}
/** Authenticate ciphertext before parsing, decompress with a strict output cap. Never log payloads. */
export function seal(value: unknown, key: Buffer) {
 requireHosted(key.length === 32);
 let clear: Buffer | undefined, compressed: Buffer | undefined, iv: Buffer | undefined;
 let prefix: Buffer | undefined, tail: Buffer | undefined, encrypted: Buffer | undefined, tag: Buffer | undefined;
 try {
  clear = Buffer.from(JSON.stringify(value)); requireHosted(clear.length <= maximum);
  iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic); compressed = gzipSync(clear);
  prefix = cipher.update(compressed); tail = cipher.final();
  encrypted = Buffer.concat([prefix, tail]); tag = cipher.getAuthTag();
  return Buffer.concat([magic, iv, tag, encrypted]);
 } finally {
  // Only our owned byte buffers. Caller key/output and immutable JS strings are not erased here.
  for (const bytes of [clear, compressed, iv, prefix, tail, encrypted, tag]) bytes?.fill(0);
 }
}
export function unseal(bytes: Buffer, key: Buffer): unknown {
 requireHosted(key.length === 32 && bytes.length > 36 && bytes.length <= maximum && bytes.subarray(0, 8).equals(magic));
 let prefix: Buffer | undefined, tail: Buffer | undefined, compressed: Buffer | undefined, clear: Buffer | undefined;
 try {
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
  decipher.setAAD(magic); decipher.setAuthTag(bytes.subarray(20, 36));
  // Retain update's unauthenticated plaintext so final() failure cannot abandon it.
  prefix = decipher.update(bytes.subarray(36)); tail = decipher.final();
  compressed = Buffer.concat([prefix, tail]); clear = gunzipSync(compressed, { maxOutputLength: maximum });
  return JSON.parse(clear.toString('utf8'));
 } finally {
  for (const owned of [prefix, tail, compressed, clear]) owned?.fill(0);
 }
}
export function validateFiles(raw: unknown, names: string[]) {
 const files = z.array(fileSchema).max(30).parse(raw);
 requireHosted(files.length === names.length && new Set(files.map(file => file.name)).size === names.length);
 requireHosted(files.every(file => names.includes(file.name)));
 for (const file of files) fileBytes(file).fill(0);
 return files;
}
