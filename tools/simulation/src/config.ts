import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { credentialsSchema, manifestSchema, type Credentials } from './protocol.ts';

export function assertStagingOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Simulation requires an HTTPS staging origin without credentials, path, or query.');
  if (url.hostname === 'givetogive.vercel.app' || !/(^|[.-])(staging|simulation|sandbox)([.-]|$)/i.test(url.hostname))
    throw new Error('Refusing an origin not explicitly named staging, simulation, or sandbox.');
  return url;
}
export function assertLocalModel(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password)
    throw new Error('Inference must be an HTTP loopback server; cloud fallback is forbidden.');
  return url;
}
export function validateManifest(raw: unknown, credentials: Credentials) {
  const manifest = manifestSchema.parse(raw);
  if (new URL(manifest.origin).origin !== new URL(credentials.origin).origin || manifest.databaseIdentity !== credentials.databaseIdentity)
    throw new Error('Staging origin/database identity does not match provisioned credentials.');
  return manifest;
}
const optionsSchema = z.object({
  credentialsPath: z.string(), stateDirectory: z.string(), runId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  modelUrl: z.string(), model: z.string(), durationSeconds: z.coerce.number().int().min(1).max(86400),
  population: z.coerce.number().int().min(1).max(100), inferenceConcurrency: z.coerce.number().int().min(1).max(2),
  browserConcurrency: z.coerce.number().int().min(1).max(2), seed: z.coerce.number().int(),
  maxCyclesPerAgent: z.coerce.number().int().min(0).max(10000),
  minimumFreeGiB: z.coerce.number().min(0.5).max(8), mode: z.enum(['autonomous', 'deterministic']),
});
export type Options = z.infer<typeof optionsSchema>;
export function loadOptions(): { options: Options; credentials: Credentials } {
  const credentialsPath = process.env.SIM_CREDENTIALS ?? '.state/credentials.json';
  const credentials = credentialsSchema.parse(JSON.parse(readFileSync(credentialsPath, 'utf8')));
  const options = optionsSchema.parse({
    credentialsPath,
    stateDirectory: resolve(process.env.SIM_STATE_DIRECTORY ?? '.state'),
    runId: process.env.SIM_RUN_ID ?? credentials.runId ?? 'community-local', modelUrl: process.env.SIM_MODEL_URL ?? 'http://127.0.0.1:8089/v1',
    model: process.env.SIM_MODEL ?? 'qwen', durationSeconds: process.env.SIM_DURATION_SECONDS ?? 3600,
    population: process.env.SIM_POPULATION ?? credentials.agents.length, inferenceConcurrency: process.env.SIM_INFERENCE_CONCURRENCY ?? 2,
    browserConcurrency: process.env.SIM_BROWSER_CONCURRENCY ?? 2, seed: process.env.SIM_SEED ?? 20260926,
    maxCyclesPerAgent: process.env.SIM_MAX_CYCLES_PER_AGENT ?? 0,
    minimumFreeGiB: process.env.SIM_MIN_FREE_GIB ?? 1, mode: process.env.SIM_MODE ?? credentials.mode ?? 'autonomous',
  });
  assertLocalModel(options.modelUrl);
  assertStagingOrigin(credentials.origin);
  if (credentials.runId && options.runId !== credentials.runId) throw new Error('Tokens are bound to a different run. Provision fresh run-scoped credentials for another run ID.');
  if (credentials.mode && options.mode !== credentials.mode) throw new Error('Mode differs from the provisioned run. Create a new run for a different mode.');
  if (options.population > credentials.agents.length) throw new Error('Not enough independently provisioned accounts.');
  return { options, credentials };
}
