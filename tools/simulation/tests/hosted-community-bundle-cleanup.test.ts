import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { seal, unseal, validateFiles, privateFile } from '../src/hosted-community-bundle.ts';

const value = { text: 'OFFLINE_CLEAR_BUFFER_SENTINEL' };
type Failure = 'gzip' | 'cipher' | 'encrypt-update' | 'encrypt-final' | 'encrypt-concat'
 | 'decrypt-concat' | 'gunzip' | undefined;
/** Scoped built-in spies, restored before leaving each synchronous test. No production fault hooks. */
function capture(t: TestContext, action: () => unknown, failure?: Failure) {
 const owned: Buffer[] = [], initialNonzero: boolean[] = [];
 const record = (buffer: Buffer) => { owned.push(buffer); initialNonzero.push(buffer.some(byte => byte !== 0)); return buffer; };
 const from = Buffer.from, concat = Buffer.concat;
 const gzip = zlib.gzipSync, gunzip = zlib.gunzipSync;
 const makeCipher = crypto.createCipheriv, makeDecipher = crypto.createDecipheriv, random = crypto.randomBytes;
 t.mock.method(Buffer, 'from', (...args: unknown[]) => {
  const result = Reflect.apply(from, Buffer, args) as Buffer;
  if (typeof args[0] === 'string' && args[0] === JSON.stringify(value)) record(result);
  return result;
 });
 t.mock.method(Buffer, 'concat', (...args: unknown[]) => {
  if (failure === 'encrypt-concat' || failure === 'decrypt-concat') throw new Error('offline concat failure');
  return record(Reflect.apply(concat, Buffer, args) as Buffer);
 });
 t.mock.method(zlib, 'gzipSync', (...args: unknown[]) => {
  if (failure === 'gzip') throw new Error('offline gzip failure');
  return record(Reflect.apply(gzip, zlib, args) as Buffer);
 });
 t.mock.method(zlib, 'gunzipSync', (...args: unknown[]) => {
  if (failure === 'gunzip') throw new Error('offline gunzip cap failure');
  return record(Reflect.apply(gunzip, zlib, args) as Buffer);
 });
 t.mock.method(crypto, 'randomBytes', (...args: unknown[]) => record(Reflect.apply(random, crypto, args) as Buffer));
 t.mock.method(crypto, 'createCipheriv', (...args: unknown[]) => {
  if (failure === 'cipher') throw new Error('offline cipher failure');
  const cipher = Reflect.apply(makeCipher, crypto, args) as crypto.CipherGCM;
  const update = cipher.update, final = cipher.final, tag = cipher.getAuthTag;
  t.mock.method(cipher, 'update', (...values: unknown[]) => {
   if (failure === 'encrypt-update') throw new Error('offline update failure');
   return record(Reflect.apply(update, cipher, values) as Buffer);
  });
  t.mock.method(cipher, 'final', (...values: unknown[]) => {
   if (failure === 'encrypt-final') throw new Error('offline final failure');
   return record(Reflect.apply(final, cipher, values) as Buffer);
  });
  t.mock.method(cipher, 'getAuthTag', () => record(Reflect.apply(tag, cipher, []) as Buffer));
  return cipher;
 });
 t.mock.method(crypto, 'createDecipheriv', (...args: unknown[]) => {
  const decipher = Reflect.apply(makeDecipher, crypto, args) as crypto.DecipherGCM;
  const update = decipher.update, final = decipher.final;
  t.mock.method(decipher, 'update', (...values: unknown[]) => record(Reflect.apply(update, decipher, values) as Buffer));
  t.mock.method(decipher, 'final', (...values: unknown[]) => record(Reflect.apply(final, decipher, values) as Buffer));
  return decipher;
 });
 syncBuiltinESMExports();
 let result: unknown, error: unknown;
 try { result = action(); } catch (caught) { error = caught; }
 finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
 return { owned, initialNonzero, result, error };
}
function erased(buffers: Buffer[]) { for (const buffer of buffers) assert.equal(buffer.every(byte => byte === 0), true); }
/** Construct a tiny authenticated payload with deliberately invalid gzip/JSON, outside spies. */
function envelope(compressed: Buffer, key: Buffer) {
 const iv = Buffer.alloc(12, 4), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
 const magic = Buffer.from('G2GHOST1'); cipher.setAAD(magic);
 const payload = Buffer.concat([cipher.update(compressed), cipher.final()]);
 return Buffer.concat([magic, iv, cipher.getAuthTag(), payload]);
}
test('seal wipes all owned temporaries on success; returned ciphertext and caller key remain usable', t => {
 const key = Buffer.alloc(32, 8), before = Buffer.from(key);
 const observed = capture(t, () => seal(value, key));
 assert.equal(observed.error, undefined); assert.ok(Buffer.isBuffer(observed.result));
 assert.ok(observed.initialNonzero.some(Boolean)); erased(observed.owned.filter(bytes => bytes !== observed.result));
 assert.deepEqual(key, before); assert.deepEqual(unseal(observed.result, key), value);
});
for (const failure of ['gzip', 'cipher', 'encrypt-update', 'encrypt-final', 'encrypt-concat'] as const) {
 test(`seal wipes previously allocated owned buffers on ${failure} failure`, t => {
  const key = Buffer.alloc(32, 8), before = Buffer.from(key);
  const observed = capture(t, () => seal(value, key), failure);
  assert.ok(observed.error); assert.ok(observed.owned.length > 0); erased(observed.owned); assert.deepEqual(key, before);
 });
}
test('seal overcap branch erases its clear buffer without allocating128MiB', t => {
 const small = Buffer.from('small offline cap fixture'), from = Buffer.from;
 const simulated = { length: 128 * 1024 * 1024 + 1, fill: (byte: number) => { small.fill(byte); } };
 t.mock.method(Buffer, 'from', (...args: unknown[]) => args[0] === JSON.stringify(value) ? simulated : Reflect.apply(from, Buffer, args));
 try { assert.throws(() => seal(value, Buffer.alloc(32, 8))); }
 finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
 erased([small]);
});
test('unseal success wipes prefix/tail/compressed/clear but preserves caller ciphertext/key', t => {
 const key = Buffer.alloc(32, 8), input = seal(value, key), before = Buffer.from(input), keyBefore = Buffer.from(key);
 const observed = capture(t, () => unseal(input, key));
 assert.equal(observed.error, undefined); assert.deepEqual(observed.result, value);
 assert.ok(observed.owned.length >= 4); assert.ok(observed.initialNonzero.some(Boolean)); erased(observed.owned);
 assert.deepEqual(input, before); assert.deepEqual(key, keyBefore);
});
test('failed final authentication wipes update plaintext prefix, not caller ciphertext/key', t => {
 const key = Buffer.alloc(32, 8), input = seal(value, key); input[input.length - 1] ^= 1;
 const before = Buffer.from(input), keyBefore = Buffer.from(key);
 const observed = capture(t, () => unseal(input, key));
 assert.ok(observed.error); assert.equal(observed.owned.length, 1); assert.equal(observed.initialNonzero[0], true);
 erased(observed.owned); assert.deepEqual(input, before); assert.deepEqual(key, keyBefore);
});
test('native malformed-gzip exception erases authenticated compressed prefix/tail/concat', t => {
 const key = Buffer.alloc(32, 8), input = envelope(Buffer.from('not a gzip stream'), key), before = Buffer.from(input);
 const observed = capture(t, () => unseal(input, key));
 assert.ok(observed.error); assert.ok(observed.owned.length >= 3); erased(observed.owned); assert.deepEqual(input, before);
});
test('gunzip cap exception erases compressed buffers, using a small scoped synthetic throw', t => {
 const key = Buffer.alloc(32, 8), input = seal(value, key);
 const observed = capture(t, () => unseal(input, key), 'gunzip');
 assert.ok(observed.error); assert.ok(observed.owned.length >= 3); erased(observed.owned);
});
test('decrypted concat failure erases both retained update/final buffers', t => {
 const key = Buffer.alloc(32, 8), input = seal(value, key);
 const observed = capture(t, () => unseal(input, key), 'decrypt-concat');
 assert.ok(observed.error); assert.equal(observed.owned.length, 2); erased(observed.owned);
});
test('native malformed-JSON exception erases clear and compressed buffers', t => {
 const key = Buffer.alloc(32, 8), input = envelope(zlib.gzipSync(Buffer.from('{')), key);
 const observed = capture(t, () => unseal(input, key));
 assert.ok(observed.error); assert.ok(observed.owned.length >= 4); erased(observed.owned);
});
test('validateFiles erases its temporary decode, preserving original caller bytes and encoded record', t => {
 const input = Buffer.from('caller-owned fixture'), before = Buffer.from(input), file = privateFile('offline.bin', input);
 const from = Buffer.from; let decoded: Buffer | undefined;
 t.mock.method(Buffer, 'from', (...args: unknown[]) => {
  const result = Reflect.apply(from, Buffer, args) as Buffer;
  if (args[0] === file.bytes && args[1] === 'base64') decoded = result;
  return result;
 });
 try { assert.deepEqual(validateFiles([file], ['offline.bin']), [file]); }
 finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
 assert.ok(decoded); erased([decoded]); assert.deepEqual(input, before);
 assert.equal(file.bytes, before.toString('base64'));
});
