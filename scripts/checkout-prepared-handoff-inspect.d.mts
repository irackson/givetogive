export const preparedHandoffBinding: Readonly<{
 headSha: string; runId: string; operationId: string; originalDigest: string;
}>;
export type PreparedHandoffFailure = Readonly<{
 binding: { releaseId: number; operationId: string; job: { id: string; nonce: string; headSha: string } };
 previousWorkerFailed: true; previousSubmitAttempts: 0; previousNoticeRequests: 0;
 originalExitEventUnobserved: true; originalOsGroupClosed: true;
 paymentAccepted: false; financialAdmission: false;
}>;
/** Classifies authenticated evidence only; grants no provider or retry authority. */
export function validatePreparedHandoffFailure(value: unknown, expectedProfileDigest: string): PreparedHandoffFailure;
export function observePreparedHandoffEligibility(key: Buffer): Promise<PreparedHandoffFailure & Readonly<{
 originalDigest: string; originalPreparationHead: string; priorJobTerminalFailed: true;
 originalDraftPrivateAndUnchanged: true; oldDraftNotRebound: true; newPreparationsAllowed: 0;
 providerAndOriginalBudgetRecheckRequired: true;
 transportEvidence: 'github-live-prepared-handoff'; financialRetryAuthorized: false;
}>>;
