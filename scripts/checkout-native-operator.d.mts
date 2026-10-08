export function checkoutDispatchRunId(value: unknown): string;
export function executeNativeCheckoutOperator(): Promise<{
 nativeRunFinished: boolean;
 originalFinalRetained: boolean;
 paymentAccepted: boolean;
 independentSettlementRequired: boolean;
 retryAllowed: boolean;
}>;
