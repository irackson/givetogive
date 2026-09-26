export type AskStatus = 'not_started' | 'in_progress' | 'complete';
export type ContributionStatus = 'pledged' | 'completed' | 'cancelled';

export function getAskStatus(
	contributedAmount: number,
	goalAmount: number,
	completedAmount = 0,
): AskStatus {
	if (contributedAmount === 0) return 'not_started';
	if (completedAmount >= goalAmount) return 'complete';
	return 'in_progress';
}

export function canUpdateContributionStatus({
	currentStatus,
	nextStatus,
	isContributor,
	isOwner,
}: {
	currentStatus: ContributionStatus;
	nextStatus: Exclude<ContributionStatus, 'pledged'>;
	isContributor: boolean;
	isOwner: boolean;
}) {
	const isAuthorized =
		nextStatus === 'cancelled' ? isContributor : isContributor || isOwner;
	if (!isAuthorized) return false;
	if (currentStatus === nextStatus) return true;
	return currentStatus === 'pledged';
}

export function isValidContributionAmount(type: string, amount: number) {
	if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000)
		return false;
	return type === 'money' ?
			Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7
		:	Number.isInteger(amount);
}
