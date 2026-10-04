import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runHostedObserver } from './hosted-community-observer.ts';
import { validateObserverInput } from './hosted-community-observer-evidence.ts';
import { requireHosted } from './hosted-community-policy.ts';

/** Private stdin only. The broker never passes its key/token or member passwords here. */
export async function readObserverInput(stream: AsyncIterable<Buffer | string>, signal: AbortSignal,
 timeoutMilliseconds = 30000) {
 requireHosted(signal instanceof AbortSignal && Number.isInteger(timeoutMilliseconds) &&
  timeoutMilliseconds > 0 && timeoutMilliseconds <= 30000);
 const parts: Buffer[] = []; let size = 0; let bytes: Buffer | undefined; let inFlight: Buffer | undefined;
 let iterator: AsyncIterator<Buffer | string> | undefined; let completed = false; let closed = false;
 const cancellation = new AbortController();
 const stop = () => cancellation.abort();
 signal.addEventListener('abort', stop, { once: true });
 if (signal.aborted) stop();
 const deadline = setTimeout(stop, timeoutMilliseconds);
 const failure = () => new Error('Observer input unavailable');
 const check = () => { if (cancellation.signal.aborted) throw failure(); };
 let rejectCancelled: (() => void) | undefined;
 const cancelled = new Promise<never>((__resolve, reject) => { rejectCancelled = () => reject(failure()); });
 // A pre-aborted signal must not produce an unhandled rejected promise.
 void cancelled.catch(() => {});
 cancellation.signal.addEventListener('abort', rejectCancelled!, { once: true });
 try {
  check(); iterator = stream[Symbol.asyncIterator]();
  while (true) {
   check();
   const pending = Promise.resolve(iterator.next()).then((part) => {
    // An iterator can resolve after cancellation/return; erase late owned chunks too.
    if (Buffer.isBuffer(part.value)) {
     if (closed) part.value.fill(0); else inFlight = part.value;
    }
    return part;
   });
   const part = await Promise.race([pending, cancelled]);
   check();
   if (part.done) break;
   const chunk = Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value);
   parts.push(chunk); inFlight = undefined; size += chunk.length;
   requireHosted(size <= 1024 * 1024);
  }
  check(); bytes = Buffer.concat(parts);
  const value = z.object({ input: z.unknown(), outputName: z.string() }).strict().parse(JSON.parse(bytes.toString()));
  const result = { input: validateObserverInput(value.input), outputName: value.outputName };
  check(); completed = true; return result;
 } catch {
  // Validation, stream errors and abort reasons can contain private input.
  throw failure();
 } finally {
  closed = true; clearTimeout(deadline); signal.removeEventListener('abort', stop);
  cancellation.signal.removeEventListener('abort', rejectCancelled!);
  bytes?.fill(0); inFlight?.fill(0); for (const part of parts) part.fill(0);
  if (!completed) {
   // Destroy only this owned input stream, and never await a stalled iterator indefinitely.
   try { (stream as AsyncIterable<Buffer | string> & { destroy?: () => void }).destroy?.(); } catch { /* Redacted. */ }
   let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
   try {
    const returned = iterator?.return?.();
    if (returned) await Promise.race([
     Promise.resolve(returned).then((part) => { if (Buffer.isBuffer(part.value)) part.value.fill(0); }),
     new Promise<void>((finish) => { cleanupDeadline = setTimeout(finish, 1000); }),
    ]);
   } catch { /* The original read fails closed; never print iterator errors. */ }
   finally { if (cleanupDeadline) clearTimeout(cleanupDeadline); }
  }
 }
}
async function main() {
 requireHosted(process.env.G2G_HOSTED_OBSERVER_WORKER === '1' && process.argv.length === 2);
 for (const name of ['COMMUNITY_RECOVERY_TOKEN','COMMUNITY_BUNDLE_KEY','DATABASE_URL','STRIPE_SECRET_KEY','SIM_CREDENTIALS','NODE_OPTIONS'])
  requireHosted(!process.env[name]);
 const cancellation = new AbortController();
 const stop = () => cancellation.abort();
 process.on('SIGTERM', stop); process.on('SIGINT', stop);
 try {
  const value = await readObserverInput(process.stdin, cancellation.signal);
  requireHosted(!cancellation.signal.aborted);
  const result = await runHostedObserver(value.input, { toolsDirectory: resolve(fileURLToPath(new URL('../', import.meta.url))),
   outputName: value.outputName, signal: cancellation.signal });
  if (result.receipt.passed !== true || result.receipt.browserClosed !== true || result.receipt.apiClosed !== true) process.exitCode = 1;
 } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 await main().catch(() => { process.exitCode = 1; }); // No private stdin or browser error is printed.
