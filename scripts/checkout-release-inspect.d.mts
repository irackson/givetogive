export function releaseCliArguments(args: string[]): string[];
export function inspectLocalCheckoutRelease(): Promise<{
 observedAt: string; headSha: string; deploymentId: string; deployedAppSha: string;
 canonicalSourceDigest: string; rootLockDigest: string; sourceDigest: string;
 ready: boolean; protected: boolean; nodeVersion: string; runtimeGatesVerified: boolean;
 publishableKeyMatchesLocal: boolean; deployedCanonicalAppMatchesHead: boolean;
 sourceApprovalStillRequired: boolean; financialAdmission: boolean; databaseWrites: number;
 memberActions: number; paymentAccepted: boolean;
}>;
