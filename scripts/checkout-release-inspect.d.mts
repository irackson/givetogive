export function releaseCliArguments(args: string[]): string[];
export const checkoutReleaseBinding: Readonly<{
 deploymentId: string; appSha: string; canonicalSourceDigest: string; sourceDigest: string; lockDigest: string; uploadDigest: string;
}>;
export function matchesReviewedCheckoutUpload(metadata: unknown): boolean;
export function parallelReleaseMetadataReads(read: (path: string) => Promise<unknown>): Promise<[unknown, unknown, unknown]>;
export interface CheckoutReleaseSnapshot {
 observedAt: string; sourceObservedAt: string; headSha: string; deploymentId: string; deployedAppSha: string;
 canonicalSourceDigest: string; rootLockDigest: string; sourceDigest: string; contextDigest: string;
 ready: boolean; protected: boolean; nodeVersion: string; runtimeGatesVerified: boolean;
 publishableKeyMatchesLocal: boolean; deployedCanonicalAppMatchesHead: boolean;
 sourceApprovalStillRequired: boolean; financialAdmission: boolean; databaseWrites: number;
 memberActions: number; paymentAccepted: boolean;
}
export function inspectLocalCheckoutRelease(): Promise<Readonly<CheckoutReleaseSnapshot>>;
export function recheckLocalCheckoutRelease(original: Readonly<CheckoutReleaseSnapshot>): Promise<Readonly<CheckoutReleaseSnapshot>>;
export function assertLocalCheckoutSourceUnchanged(original: Readonly<CheckoutReleaseSnapshot>): void;
