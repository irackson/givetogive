/** Current job-bound private-draft transport, reusing the existing no-retry,
 * readback-verified encrypted asset implementation. Constructor/import are inert.
 * Root/parent own tokens; the ordinary member must never receive this object.
 * Durable upload intents and independent live job/OS checks remain mandatory.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CheckoutDraftTransport,type CheckoutDraftDependencies } from './hosted-checkout-github.ts';
import { validateCurrentCheckoutProfile,type CurrentCheckoutSource } from './checkout-current-profile.ts';

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const associationSchema=z.object({protocol:z.literal(1),purpose:z.literal('current-cohort-private-checkout-draft'),
 repository:z.literal('irackson/givetogive'),runId:z.string(),operationId:z.uuid(),headSha:z.string().regex(/^[a-f0-9]{40}$/),
 workflowRunId:z.string().regex(/^[1-9][0-9]{0,19}$/),jobId:z.string().regex(/^[1-9][0-9]{0,19}$/),
 jobNonce:z.string().regex(/^[a-f0-9]{32}$/),profileDigest:sha}).strict();
const phases=['input','open-proof','submit-proof','ack-intent','submit-intent','final'] as const;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=():never=>{throw Error('Current Checkout private draft rejected; no admission or retry.');};
export class CurrentCheckoutPrivateDraft extends CheckoutDraftTransport {
 readonly profile:ReturnType<typeof validateCurrentCheckoutProfile>;
 readonly association:Readonly<z.infer<typeof associationSchema>>;
 constructor(raw:unknown,reviewedHead:string,reviewedSource:CurrentCheckoutSource,releaseId:number,token:string,
  dependencies:CheckoutDraftDependencies={}) {
  const profile=validateCurrentCheckoutProfile(raw,reviewedHead,reviewedSource,(dependencies.now??Date.now)());
  if(!Number.isSafeInteger(releaseId)||releaseId<=0)fail();
  const association=Object.freeze(associationSchema.parse({protocol:1,purpose:'current-cohort-private-checkout-draft',
   repository:profile.job.repository,runId:profile.runId,operationId:profile.operationId,headSha:profile.job.headSha,
   workflowRunId:profile.job.workflowRunId,jobId:profile.job.jobId,jobNonce:profile.job.jobNonce,profileDigest:hash(profile)}));
  super({releaseId,operationId:profile.operationId,job:{id:profile.job.jobId,nonce:profile.job.jobNonce,headSha:reviewedHead}},
   token,dependencies,phases,{tagName:`checkout-current-${profile.operationId}`,validateAssociation(raw) {
    const value=associationSchema.parse(raw);
    if(Object.keys(association).some(key=>value[key as keyof typeof value]!==association[key as keyof typeof association]))fail();
   }});
  this.profile=profile;this.association=association;
 }
}
