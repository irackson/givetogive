type ChangeCapability = {
	action: 'upgrade' | 'downgrade' | 'undo' | 'cancel' | 'resume';
	canConfirm: boolean;
};

/** Display policy only. The server still authorizes every confirmation. */
export function supporterChangeConfirmationAllowed(
	change: ChangeCapability,
	options: {
		billingOnly: boolean;
		enabled: boolean;
		managementEnabled: boolean;
	},
) {
	if (!change.canConfirm) return false;
	// A history entry has no local preview input. Its server capability already
	// verifies that restricted undo targets this member's unpaid upgrade.
	if (
		options.billingOnly &&
		change.action !== 'cancel' &&
		change.action !== 'undo'
	)
		return false;
	return change.action === 'upgrade' || change.action === 'downgrade' ?
			options.enabled
		:	options.managementEnabled;
}
