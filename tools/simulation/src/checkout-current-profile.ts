/** Current cohort binding, kept separate from the consumed historical worker.
 * Pure validation only: no member credential, IO, preparation, reservation or
 * submission. A profile is NOT permission; native live-job/source observation,
 * normal member/provider verification and original atomic admission are required.
 */
import { z } from 'zod';
import { currentCheckoutSourceEvidence } from './checkout-current-preflight.ts';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { checkMemory } from './hosted-checkout-policy.ts';

export const currentCheckoutCandidate = Object.freeze({
 runId: '01d34cf1-7880-4978-aec3-e3c3ccc94b67',
 agentId: 'bot_bcfa98ea084ed93e_003',
 operationId: '398c5cf9-62de-4908-afb0-ce6321e8b3ad',
 planDigest: 'e36e25e6e4e49e662a2343b15230c0d3dd1717637ca5eabfc4c342f8da8d1e1a',
 databaseIdentity: 'd5e4408d-c2fa-404d-81c5-ef4336dd8cd7',
 origin: 'https://givetogive-staging.vercel.app',
 maximumAmountCents: 500, runBudgetCents: 2500, actorBudgetCents: 1500,
 scenario: 'decline', checkoutTier: 'supporter', expectedResultTier: 'neighbor',
});
const sha=z.string().regex(/^[a-f0-9]{64}$/),head=z.string().regex(/^[a-f0-9]{40}$/);
const id=z.string().regex(/^[1-9][0-9]{0,19}$/),nonce=z.string().regex(/^[a-f0-9]{32}$/);
const sourceSchema=z.object({canonicalSourceDigest:sha,rootLockDigest:sha,runnerDigest:sha}).strict();
const candidate=currentCheckoutCandidate;
const profileSchema=z.object({
 protocol:z.literal(1),purpose:z.literal('current-cohort-one-checkout'),
 runId:z.literal(candidate.runId),agentId:z.literal(candidate.agentId),operationId:z.literal(candidate.operationId),
 planDigest:z.literal(candidate.planDigest),databaseIdentity:z.literal(candidate.databaseIdentity),origin:z.literal(candidate.origin),
 maximumAmountCents:z.literal(500),currency:z.literal('usd'),scenario:z.literal('decline'),
 checkoutTier:z.literal('supporter'),expectedResultTier:z.literal('neighbor'),
 runBudgetCents:z.literal(2500),actorBudgetCents:z.literal(1500),
 noHistoryReset:z.literal(true),maximumMemberLaunches:z.literal(1),maximumSubmissions:z.literal(1),
 retryAllowed:z.literal(false),financialAdmission:z.literal(false),paymentAccepted:z.literal(false),
 stagedDeploymentId:z.literal(checkoutReleaseBinding.deploymentId),
 source:sourceSchema,
 job:z.object({repository:z.literal('irackson/givetogive'),actor:z.literal('irackson'),triggeringActor:z.literal('irackson'),
  event:z.literal('workflow_dispatch'),ref:z.literal('refs/heads/main'),attempt:z.literal(1),
  runner:z.literal('ubuntu-24.04'),platform:z.literal('linux'),nodeMajor:z.literal(24),
  workflowRunId:id,jobId:id,jobNonce:nonce,headSha:head,status:z.literal('in_progress'),
  observedAt:z.iso.datetime(),freeBytes:z.number().finite(),publicRepository:z.literal(true)}).strict(),
}).strict();
export type CurrentCheckoutProfile=z.infer<typeof profileSchema>;
export type CurrentCheckoutSource=z.infer<typeof sourceSchema>;
const fail=():never=>{throw Error('Current Checkout binding rejected; no admission or historical replay.');};
function guard(value:unknown):asserts value {if(!value)fail();}
function freeze(value:object) {
 for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);
 Object.freeze(value);
}

/** Source must come from a separately reviewed exact head and the running native
 * job. The passed observations are validated, not authenticated by this function.
 * A serialized profile cannot replace provider, OS, GitHub or journal readback.
 */
export function validateCurrentCheckoutProfile(raw:unknown,reviewedHead:string,
 reviewedSource:CurrentCheckoutSource,now:number):Readonly<CurrentCheckoutProfile> {
 try {
  const p=profileSchema.parse(raw),s=sourceSchema.parse(reviewedSource);
  guard(Number.isFinite(now)&&p.job.headSha===reviewedHead);
  const age=now-Date.parse(p.job.observedAt);guard(age>=-5000&&age<=30000);
  checkMemory(p.job.freeBytes,true);
  currentCheckoutSourceEvidence(p.source,reviewedHead);
  guard(p.source.canonicalSourceDigest===s.canonicalSourceDigest&&p.source.rootLockDigest===s.rootLockDigest&&
   p.source.runnerDigest===s.runnerDigest);
  freeze(p);return p;
 }catch{return fail();}
}

/** Phase-to-phase job and source identity must never roll over after preparation.
 * Callers re-observe the actual native job and source before each phase.
 */
export function recheckCurrentCheckoutProfile(raw:unknown,original:Readonly<CurrentCheckoutProfile>,now:number) {
 const before=validateCurrentCheckoutProfile(original,original.job.headSha,original.source,Date.parse(original.job.observedAt));
 const after=validateCurrentCheckoutProfile(raw,before.job.headSha,before.source,now);
 const {observedAt:_old,freeBytes:_oldMemory,...oldJob}=before.job;
 const {observedAt:_new,freeBytes:_newMemory,...newJob}=after.job;
 guard(JSON.stringify(oldJob)===JSON.stringify(newJob));
 guard(Date.parse(after.job.observedAt)>=Date.parse(before.job.observedAt));
 return after;
}
