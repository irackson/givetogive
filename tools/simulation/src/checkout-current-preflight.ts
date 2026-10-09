/** Current-source capability observation only. No keys, encrypted inputs, member
 * login, Checkout preparation, waiting financial parent, or payment permission.
 * Historical financial approvals are neither appended nor rewritten here. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { checkoutReleaseBinding } from '../../../scripts/checkout-release-inspect.mjs';
import { checkoutParentSourceSnapshot } from './hosted-checkout-parent.ts';
import { approvedSourceTuple, checkMemory } from './hosted-checkout-policy.ts';
import { browserSmoke } from './hosted-community.ts';

const fail = (): never => { throw Error('Current Checkout preflight rejected; no financial admission.'); };
function guard(value: unknown): asserts value { if (!value) fail(); }
export function validateCurrentCheckoutPreflightContext(env: NodeJS.ProcessEnv, platform: string, nodeMajor: number) {
 guard(platform === 'linux' && nodeMajor === 24 && env.GITHUB_REPOSITORY === 'irackson/givetogive' &&
  env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_JOB === 'verify' && env.GITHUB_RUN_ATTEMPT === '1' &&
  ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME ?? '') &&
  env.GITHUB_ACTOR === 'irackson' && env.GITHUB_TRIGGERING_ACTOR === 'irackson' &&
  /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? ''));
 guard(!Object.keys(env).some(key => /^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|CHECKOUT_BUNDLE_KEY|CHECKOUT_GITHUB_TOKEN|COMMUNITY_BUNDLE_KEY|COMMUNITY_RECOVERY_TOKEN|SIM_CREDENTIALS|SIM_RUNNER_TOKEN|GOOGLE_REFRESH_TOKEN|RESEND_API_KEY|VERCEL_TOKEN)$/.test(key) && env[key]));
 return env.GITHUB_SHA!;
}
/** Capability observation can describe unpublished code. It is never financial
 * source approval; the separate strict validator below still requires staging. */
export function currentCheckoutCapabilityEvidence(source: {
 canonicalSourceDigest: string; rootLockDigest: string; runnerDigest: string;
}, headSha: string) {
 guard(/^[a-f0-9]{40}$/.test(headSha) &&
  Object.keys(source).sort().join(',') === 'canonicalSourceDigest,rootLockDigest,runnerDigest' &&
  [source.canonicalSourceDigest,source.rootLockDigest,source.runnerDigest].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)));
 const stagedSourceMatches = source.canonicalSourceDigest === checkoutReleaseBinding.canonicalSourceDigest &&
  source.rootLockDigest === checkoutReleaseBinding.lockDigest;
 return Object.freeze({ kind: 'current-checkout-source-preflight', headSha, ...source,
  stagedDeploymentId: checkoutReleaseBinding.deploymentId, stagedSourceMatches,
  historicalApprovalReused: false,
  financialSourceApprovalStillRequired: true, nativeWaitingParent: false,
  memberActions: 0, checkoutPrepared: false, financialAdmission: false, paymentAccepted: false });
}
/** Financial-profile validation remains fail-closed until the exact app and lock
 * are independently deployed/reviewed. Capability output cannot substitute. */
export function currentCheckoutSourceEvidence(source: {
 canonicalSourceDigest: string; rootLockDigest: string; runnerDigest: string;
}, headSha: string) {
 const observation = currentCheckoutCapabilityEvidence(source, headSha);
 guard(observation.stagedSourceMatches && !approvedSourceTuple(source));
 return observation;
}
export async function executeCurrentCheckoutPreflight() {
 guard(process.argv.length === 3 && process.argv[2] === '--execute-credential-free');
 const headSha = validateCurrentCheckoutPreflightContext(process.env, process.platform, Number(process.versions.node.split('.')[0]));
 checkMemory(freemem(), true);
 const before = currentCheckoutCapabilityEvidence(checkoutParentSourceSnapshot(headSha), headSha);
 await browserSmoke(); // Exact allowlisted child, intercepted fixtures and closed native Chromium.
 checkMemory(freemem(), false);
 const after = currentCheckoutCapabilityEvidence(checkoutParentSourceSnapshot(headSha), headSha);
 guard(JSON.stringify(before) === JSON.stringify(after));
 return { ...after, credentialFreeNativeBrowserVerified: true, sourceUnchangedAcrossBrowser: true,
  externalRequests: 0, freeBytesObserved: freemem() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 if (process.argv.length === 2) console.log(JSON.stringify({ execute: false, externalRequests: 0, financialAdmission: false }));
 else executeCurrentCheckoutPreflight().then(value => console.log(JSON.stringify(value))).catch(() => {
  console.error('Current Checkout preflight rejected; no financial admission.'); process.exitCode = 1;
 });
}
