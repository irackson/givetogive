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
/** Append-only exact-run approvals. Historical exported values and wire shapes stay unchanged.
 * Adding a run requires reviewed actual provenance and a new signed trusted source checkpoint. */
export type FullRunApproval = Readonly<{ [Key in keyof typeof approved]: string }>;
const fullRunFields = ['runId','stateDirectory','sourceDigest','programDigest','actionJournalId','telemetryJournalId','setupDigest'] as const;
const releaseHashFields = ['authoredSourceDigest','gitAuthoredSourceDigest','lockDigest','runnerDigest','seedDigest'] as const;
// Tools are excluded from Vercel uploads. A new exact-run runner approval does
// not imply a different application deployment; deployed app hashes stay fixed.
const deployedHashFields = ['authoredSourceDigest','gitAuthoredSourceDigest','lockDigest'] as const;
/** Pure injectable registry validation for offline fixtures; it never changes the runtime registry. */
export function validateFullRunApprovalRegistry(raw: unknown): readonly FullRunApproval[] {
 const schema = z.object(Object.fromEntries(Object.keys(approved).map(key => [key,z.string()]))).strict();
 const records = z.array(schema).min(1).max(16).parse(raw) as FullRunApproval[];
 // Every extension retains the exact original approval in its original position.
 requireHosted(JSON.stringify(records[0]) === JSON.stringify(approved));
 const identities = new Set<string>(), directories = new Set<string>();
 const deployments = new Map<string, FullRunApproval>();
 for (const record of records) {
  requireHosted(uuid.test(record.runId) && uuid.test(record.actionJournalId) && uuid.test(record.telemetryJournalId)
   && /^\.state\/community-[a-z0-9-]+$/.test(record.stateDirectory));
  for (const field of ['sourceDigest','programDigest','setupDigest',...releaseHashFields] as const)
   requireHosted(/^[a-f0-9]{64}$/.test(record[field]));
  requireHosted(/^dpl_[A-Za-z0-9]+$/.test(record.deploymentId));
  const priorRelease = deployments.get(record.deploymentId);
  if (priorRelease) for (const field of deployedHashFields) requireHosted(record[field] === priorRelease[field]);
  else deployments.set(record.deploymentId,record);
  // New reviewed releases may change code/deployment, never the isolated target.
  for (const field of ['origin','databaseIdentity','databaseName'] as const) requireHosted(record[field] === approved[field]);
  for (const value of [record.runId,record.actionJournalId,record.telemetryJournalId]) {
   requireHosted(!identities.has(value)); identities.add(value);
  }
  requireHosted(!directories.has(record.stateDirectory)); directories.add(record.stateDirectory);
 }
 return Object.freeze(records.map(record => Object.freeze({ ...record })));
}
/** Actual fresh-cohort provenance, inspected October 8; not a fixture or completed-run claim.
 * Empty journals and all 253 real synthetic password bindings were independently verified.
 * The Linux source hash is from canonical Git blobs of the exact deployed application. */
export const october8Approved = {
 runId: '8b4d85f5-e07e-42f5-9402-3ffa866ff761',
 origin: 'https://givetogive-staging.vercel.app', databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
 databaseName: 'givetogive_staging_20260926',
 deploymentId: 'dpl_5Qci3JLvJ5kLPKkv8GrdSMyzwfFb',
 authoredSourceDigest: '96402c8a2286a883196b53d52bac33540ef1fa3bb31b3e259e0debd10f3c0dae',
 // Corrected before full-run admission: recursive traversal, not flat path sorting.
 // Failed smoke 37810787464 and the original signed checkpoint remain preserved.
 gitAuthoredSourceDigest: '19e1ac0db777ca2baa079a56e4313b467c0eaa40fb9bfb516a60be699d5f34f1',
 lockDigest: '9ac35921aee67783a92cbef09ed109e5ef6ac073f41cbec85164bbf0e66952fb',
 runnerDigest: '70a9780d0f64421e9a9885e012fe9ba143a3c82672382b4366d327f66b98d1c9',
 setupDigest: '5bb0f4d56f95df669c27f513582e51d8dea2ff6cce22cc4ed39112bc0e037a22',
 seedDigest: '51b7c3d5c35c685abb95e3f70a902b56535e5369e974e41b0804a780a31a7225',
 sourceDigest: 'f88fbc7feda59860511083d5f6803deae3b6d8b807b863e56486243983bdb8ad',
 programDigest: '7329fdb02d8dca23014062ad42b7846e32da86c9ba9776196f4f79349132907a',
 actionJournalId: '41f88f0e-3f4d-4d2a-a9bf-898752ced471', telemetryJournalId: '2101a3c8-d572-4647-bd65-53c2889e90dc',
 stateDirectory: '.state/community-hour253-oct8',
} as const satisfies FullRunApproval;
/** Fresh native-history release provenance; empty journals and all 253 passwords inspected.
 * This approves a bounded test, not its execution or acceptance. Prior failures remain historical. */
export const october8NativeApproved = {
 runId: '58568b0d-6eea-42cc-8bb9-faa8c32af1b4',
 origin: 'https://givetogive-staging.vercel.app', databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
 databaseName: 'givetogive_staging_20260926', deploymentId: 'dpl_4ZF8gk4Rv3NYoZcgFQeSnfBmNUg5',
 authoredSourceDigest: '4965f8838ce2c870c9fb8542878fab94fbb65d3beef43d9533ea1aec8dcc976a',
 gitAuthoredSourceDigest: '253f82bf1e6b403a917d45a3836218642b26fd3ab1550eadf493b67554b59ae8',
 lockDigest: '9ac35921aee67783a92cbef09ed109e5ef6ac073f41cbec85164bbf0e66952fb',
 runnerDigest: '5062b91d82a0b0d142cfd278adee3b424497fea96842122793bfcc60973806ca',
 setupDigest: '760c0ccb84c2a3143b4aae62340023664c772f89e6a904e169258402e7bff55b',
 seedDigest: '51b7c3d5c35c685abb95e3f70a902b56535e5369e974e41b0804a780a31a7225',
 sourceDigest: '04177773a9ab6f58da9c22500fa89a372ac96118b1a1a4e2ca5c637fb63a8fc5',
 programDigest: 'bb91091a535448d848a78edccacb1ffdd2becd6368e17153daebc071569c1a7f',
 actionJournalId: 'caeae055-eda5-401f-894c-430c5a343aa6', telemetryJournalId: '58e9af56-a8b8-452a-81d0-5186ee4490ae',
 stateDirectory: '.state/community-hour253-oct8-native',
} as const satisfies FullRunApproval;
/** Only compiled reviewed approvals are operational; fixture selectors are never accepted. */
export const october8LifecycleApproved = {
 ...october8NativeApproved,
 runId: '8cefab70-ee51-410c-88db-005c4412d8cf',
 runnerDigest: 'b7aa8d7ee99c4d3c6c7d88d4b7b9071f5d2de1473d36e8da5ce1f8b3ab7f0e61',
 setupDigest: '747d56ce7df3f3c777bb223f688392fa5663b4939216a09af73a51a3ddb8c882',
 sourceDigest: '3a039416eebd8be7dd13f4196bbb1cb6e970748e6666b718b88c1368245bda09',
 programDigest: '00527cb20ffa64214a75ee86b1d8a86f14b7651758fd1d228e75a42ffb38262a',
 actionJournalId: '93d974e9-ba19-432c-beb9-55a6d0ea3400',
 telemetryJournalId: 'e5d4cf17-ceb6-4250-b291-69ab7d76d0d8',
 stateDirectory: '.state/community-hour253-oct8-lifecycle',
} as const satisfies FullRunApproval;
export const fullRunApprovals = validateFullRunApprovalRegistry([approved, october8Approved, october8NativeApproved, october8LifecycleApproved]);
export function selectFullRunApproval(runId: unknown): FullRunApproval {
 const record = fullRunApprovals.find(value => value.runId === runId); requireHosted(record); return record;
}
export function validateFullRunApprovalTuple(value: Pick<HostedManifest, typeof fullRunFields[number] | 'runnerDigest' | 'seedDigest'>, record: FullRunApproval) {
 for (const field of [...fullRunFields,'runnerDigest','seedDigest'] as const) requireHosted(value[field] === record[field]);
}
/** Pure comparison only: callers must supply a record selected from the trusted source registry. */
export function validateReleaseApproval(value: Pick<HostedManifest, 'release' | 'runnerDigest' | 'seedDigest'>, record: FullRunApproval) {
 requireHosted(value.release.deploymentId === record.deploymentId && value.release.authoredSourceDigest === record.authoredSourceDigest
  && value.release.lockDigest === record.lockDigest && value.runnerDigest === record.runnerDigest && value.seedDigest === record.seedDigest);
}
/** No environment/file/fixture registration: only compiled, reviewed approvals are eligible. */
export function selectManifestApproval(value: HostedManifest): FullRunApproval {
 if (value.mode === 'full-hour') {
  const record = selectFullRunApproval(value.runId); validateReleaseApproval(value, record); return record;
 }
 const record = fullRunApprovals.find(record => value.release.deploymentId === record.deploymentId
  && value.release.authoredSourceDigest === record.authoredSourceDigest && value.release.lockDigest === record.lockDigest
  && value.runnerDigest === record.runnerDigest && value.seedDigest === record.seedDigest);
 requireHosted(record); return record;
}
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
 release: z.object({ observedAt: z.iso.datetime(), deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
  authoredSourceDigest: hash, lockDigest: hash,
  canonical: z.literal(true), protected: z.literal(true), ready: z.literal(true),
  independentReadinessPassed: z.literal(true), noOtherControllers: z.literal(true),
  noMemberTokens: z.literal(true),
  cloudBrowserSmokePassed: z.boolean(), authenticatedSmokePassed: z.boolean(),
 }).strict(),
}).strict();
export type HostedManifest = z.infer<typeof manifestSchema>;
export const observerInputPolicy = Object.freeze({ waitMilliseconds: 300000, maximumAgeMilliseconds: 300000,
 maximumBytes: 1024 * 1024, maximumAssets: 20 });
/** The trusted wrapper supplies its exact GITHUB_RUN_ID. Do not refresh the original launch attestation. */
export function observerInputName(raw: HostedManifest, githubRunId: string) {
 const value = manifestSchema.parse(raw);
 const selected = selectManifestApproval(value);
 requireHosted(value.mode === 'full-hour' && value.population === 253 && value.durationSeconds === 4500
  && value.release.cloudBrowserSmokePassed && value.release.authenticatedSmokePassed);
 validateFullRunApprovalTuple(value,selected);
 requireHosted(/^[1-9][0-9]*$/.test(githubRunId) && Number.isSafeInteger(Number(githubRunId)));
 return `community-observer-input-${value.runId}-${githubRunId}-1.g2genc`;
}
export function requireHosted(value: unknown): asserts value {
 if (!value) throw new Error('Hosted community guard rejected; private details withheld.');
}
export function validateManifest(raw: unknown, now = Date.now()): HostedManifest {
 const value = manifestSchema.parse(raw);
 const age = now - Date.parse(value.release.observedAt);
 requireHosted(age >= -30000 && age <= 300000);
 const selected = selectManifestApproval(value);
 if (value.mode === 'full-hour') {
  requireHosted(value.population === 253 && value.durationSeconds === 4500);
  requireHosted(value.release.cloudBrowserSmokePassed && value.release.authenticatedSmokePassed);
  validateFullRunApprovalTuple(value,selected);
 } else requireHosted(value.population === 5 && value.durationSeconds === 300
  && !fullRunApprovals.some(record => value.runId === record.runId || value.stateDirectory === record.stateDirectory));
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
