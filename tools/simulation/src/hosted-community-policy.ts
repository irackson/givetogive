import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

export const repository = 'irackson/givetogive';
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const approved = {
 runId: '3275f37c-213f-48d8-a1e0-50ce35850559',
 origin: 'https://givetogive-staging.vercel.app', databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
 databaseName: 'givetogive_staging_20260926',
 deploymentId: 'dpl_9v2tUXxH8AJ7qsaaSn8UfMdCmmZS',
 authoredSourceDigest: '9a3d105bf3026e03726eba1621400a6f24aa47d3e1a300cb7f6b2dc606245e8f',
 gitAuthoredSourceDigest: 'a84af7e787624e6bb87a7995888eb3fb61b9f7fc54abbfe1c292bce13f0ce883',
 lockDigest: '9ac35921aee67783a92cbef09ed109e5ef6ac073f41cbec85164bbf0e66952fb',
 runnerDigest: '70a9780d0f64421e9a9885e012fe9ba143a3c82672382b4366d327f66b98d1c9',
 setupDigest: '96cf84aad82d0c4a3ca3baa87418cbb9385b087dc275905eeaba1502da0e32db',
 seedDigest: '51b7c3d5c35c685abb95e3f70a902b56535e5369e974e41b0804a780a31a7225',
 sourceDigest: 'bec790eb9da18f64b49a796497465840cf0c8cc6e690381694c082db4e1e8e5c',
 programDigest: '10acf632bc885e5f35230be85e492a509f217290c13d9461e130cdbef765f3e9',
 actionJournalId: '94dc4a24-f891-4029-bbdb-71c82c74406c', telemetryJournalId: '6d6b3b5f-8869-4ce4-a885-a45dd1af28f2',
 stateDirectory: '.state/community-hour253regression2',
} as const;
export const runnerFiles = ['community-supervisor.ts', 'community-cli.ts', 'community-browser.ts',
 'browser-observation.ts', 'controller-cadence.ts', 'community-generate.ts', 'community-config.ts', 'activity.ts'];
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().regex(uuid);
export const manifestSchema = z.object({
 protocolVersion: z.literal(1), mode: z.enum(['authenticated-smoke', 'full-hour']), runId: id,
 headSha: z.string().regex(/^[a-f0-9]{40}$/), releaseId: z.number().int().positive(),
 stateDirectory: z.string().regex(/^\.state\/community-[a-z0-9-]+$/),
 population: z.number().int(), durationSeconds: z.number().int(),
 sourceDigest: hash, programDigest: hash, actionJournalId: id, telemetryJournalId: id,
 runnerDigest: hash, setupDigest: hash, seedDigest: hash, simulationLockDigest: hash,
 release: z.object({ observedAt: z.iso.datetime(), deploymentId: z.literal(approved.deploymentId),
  authoredSourceDigest: z.literal(approved.authoredSourceDigest), lockDigest: z.literal(approved.lockDigest),
  canonical: z.literal(true), protected: z.literal(true), ready: z.literal(true),
  independentReadinessPassed: z.literal(true), noOtherControllers: z.literal(true),
  noMemberTokens: z.literal(true),
  cloudBrowserSmokePassed: z.boolean(), authenticatedSmokePassed: z.boolean(),
 }).strict(),
}).strict();
export type HostedManifest = z.infer<typeof manifestSchema>;
export function requireHosted(value: unknown): asserts value {
 if (!value) throw new Error('Hosted community guard rejected; private details withheld.');
}
export function validateManifest(raw: unknown, now = Date.now()): HostedManifest {
 const value = manifestSchema.parse(raw);
 const age = now - Date.parse(value.release.observedAt);
 requireHosted(age >= -30000 && age <= 300000);
 requireHosted(value.runnerDigest === approved.runnerDigest && value.seedDigest === approved.seedDigest);
 if (value.mode === 'full-hour') {
  requireHosted(value.population === 253 && value.durationSeconds === 4500);
  requireHosted(value.release.cloudBrowserSmokePassed && value.release.authenticatedSmokePassed);
  for (const field of ['runId', 'stateDirectory', 'sourceDigest', 'programDigest', 'actionJournalId', 'telemetryJournalId', 'setupDigest'] as const)
   requireHosted(value[field] === approved[field]);
 } else requireHosted(value.population === 5 && value.durationSeconds === 300 && value.runId !== approved.runId && value.stateDirectory !== approved.stateDirectory);
 return value;
}
export function trustedExecution(env: NodeJS.ProcessEnv, mode: string) {
 requireHosted(env.GITHUB_REPOSITORY === repository && env.GITHUB_ACTOR === 'irackson' && env.GITHUB_TRIGGERING_ACTOR === 'irackson');
 requireHosted(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main');
 requireHosted(env.GITHUB_SHA === env.COMMUNITY_EXPECTED_SHA && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''));
 requireHosted(env.RUNNER_OS === 'Linux' && process.versions.node.split('.')[0] === '24');
 requireHosted(['browser-smoke', 'authenticated-smoke', 'full-hour'].includes(mode));
 requireHosted(env.GITHUB_RUN_ATTEMPT === '1'); // Never automatically rerun a mutation job.
}
export function containedPath(root: string, name: string) {
 const target = resolve(root, name), local = relative(resolve(root), target);
 requireHosted(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`));
 return target;
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function inputPaths(value: HostedManifest) {
 return [`.state/runs/${value.runId}/credentials.json`, `.state/runs/${value.runId}/activity.jsonl`,
  `${value.stateDirectory}/activity.sqlite`, `${value.stateDirectory}/community-telemetry.sqlite`, '.state/protection.json'];
}
export function assertDraft(raw: unknown, value: Pick<HostedManifest, 'runId' | 'headSha' | 'releaseId'>) {
 const release = z.object({ id: z.number(), draft: z.literal(true), published_at: z.null(),
  target_commitish: z.string(), tag_name: z.string(), body: z.string(),
 assets: z.array(z.object({ id: z.number().int().positive(), name: z.string(), size: z.number().int().nonnegative(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).passthrough()),
 }).passthrough().parse(raw);
 requireHosted(release.id === value.releaseId && release.target_commitish === value.headSha && release.tag_name === `community-acceptance-${value.runId}`);
 const association = z.object({ protocolVersion: z.literal(1), repository: z.literal(repository), runId: z.string(), headSha: z.string() }).strict().parse(JSON.parse(release.body));
 requireHosted(association.runId === value.runId && association.headSha === value.headSha);
 return release;
}
