/** Public synthetic fixtures only; no real run credentials or provider requests. */
import { currentCheckoutCandidate as c,validateCurrentCheckoutProfile } from '../../src/checkout-current-profile.ts';
import { currentProfileDigest } from '../../src/checkout-current-phase.ts';
import { checkoutReleaseBinding } from '../../../../scripts/checkout-release-inspect.mjs';
import { approved } from '../../src/hosted-checkout-policy.ts';
export const now=Date.parse('2026-10-09T02:00:00Z'),head='a'.repeat(40);
export const source={canonicalSourceDigest:checkoutReleaseBinding.canonicalSourceDigest,rootLockDigest:checkoutReleaseBinding.lockDigest,runnerDigest:'b'.repeat(64)};
export function currentProfile(){return validateCurrentCheckoutProfile({protocol:1,purpose:'current-cohort-one-checkout',runId:c.runId,agentId:c.agentId,
 operationId:c.operationId,planDigest:c.planDigest,databaseIdentity:c.databaseIdentity,origin:c.origin,
 maximumAmountCents:500,currency:'usd',scenario:'decline',checkoutTier:'supporter',expectedResultTier:'neighbor',
 runBudgetCents:2500,actorBudgetCents:1500,noHistoryReset:true,maximumMemberLaunches:1,maximumSubmissions:1,
 retryAllowed:false,financialAdmission:false,paymentAccepted:false,stagedDeploymentId:checkoutReleaseBinding.deploymentId,source,
 job:{repository:'irackson/givetogive',actor:'irackson',triggeringActor:'irackson',event:'workflow_dispatch',ref:'refs/heads/main',attempt:1,
  runner:'ubuntu-24.04',platform:'linux',nodeMajor:24,workflowRunId:'1234',jobId:'5678',jobNonce:'c'.repeat(32),headSha:head,
  status:'in_progress',observedAt:new Date(now).toISOString(),freeBytes:4*1024**3,publicRepository:true}},head,source,now);}
export function currentInput(){const profile=currentProfile();return {protocol:1,purpose:'current-cohort-private-member-input',profile,
 profileDigest:currentProfileDigest(profile),member:{id:c.agentId,userId:c.memberId,email:c.memberEmail,password:'public-fixture-password-only'},
 stagingBypass:'public-fixture-bypass-only',retryAllowed:false,paymentAccepted:false,
 proof:{platformAccountId:approved.platformAccountId,customerAccountId:'acct_publicFixture',canonicalCustomerClockVerified:true,
  providerIdentityVerified:true,providerInvoiceAbsent:true,providerSubscriptionAbsent:true,
  checkout:{environment:'staging' as const,databaseIdentity:c.databaseIdentity,runId:c.runId,operationId:c.operationId,actorId:c.memberId,
   sessionId:'cs_test_publicFixture',url:'https://checkout.stripe.com/c/pay/cs_test_publicFixture#public-fixture',livemode:false as const,
   currency:'usd' as const,amountTotal:500,mode:'subscription' as const,status:'open' as const,paymentStatus:'unpaid' as const,
   expiresAt:Math.floor(now/1000)+3600,returnOrigin:c.origin,verifiedAt:new Date(now).toISOString()}},
};}
export function memberReadFixtures(){return {session:{access:'active',expires:new Date(now+3600000).toISOString(),
 user:{id:c.memberId,email:c.memberEmail,role:'member',sessionVersion:0,authenticatedAt:now-1000}},
 availability:{environment:'staging',livemode:false,subscriptions:true,askPayments:false,funds:false},
 overview:{tier:'neighbor',subscriptions:[]},subscriptions:[],
 payment:{id:c.operationId,kind:'supporter',status:'checkout_open',grossAmount:500,currency:'usd',tier:'supporter',recurring:true,
  livemode:false,paidAt:null,refundedAmount:0,disputedAmount:0,expiresAt:new Date(now+3600000).toISOString()},
};}
