import assert from 'node:assert/strict';
import test from 'node:test';
import { supporterChangeConfirmationAllowed } from '../../src/app/_components/payments/supporter-change-ui-policy.ts';

const restricted = {
	billingOnly: true,
	enabled: false,
	managementEnabled: true,
};

test('reopened restricted unpaid-upgrade undo relies on the server capability, not lost preview input', () => {
	// History/status supplies the same authoritative capability after the
	// dialog reopens with input:null. No paid record or provider call is mocked.
	assert.equal(
		supporterChangeConfirmationAllowed(
			{ action: 'undo', canConfirm: true },
			restricted,
		),
		true,
	);
	assert.equal(
		supporterChangeConfirmationAllowed(
			{ action: 'undo', canConfirm: false },
			restricted,
		),
		false,
	);
});

test('restricted confirmation never exposes new charges, tier changes, or renewal resumption', () => {
	for (const action of ['upgrade', 'downgrade', 'resume'] as const)
		assert.equal(
			supporterChangeConfirmationAllowed(
				{ action, canConfirm: true },
				{ ...restricted, enabled: true },
			),
			false,
		);
});

test('restricted cancel and undo require both server approval and billing management availability', () => {
	for (const action of ['cancel', 'undo'] as const) {
		assert.equal(
			supporterChangeConfirmationAllowed(
				{ action, canConfirm: true },
				restricted,
			),
			true,
		);
		assert.equal(
			supporterChangeConfirmationAllowed(
				{ action, canConfirm: false },
				restricted,
			),
			false,
		);
		assert.equal(
			supporterChangeConfirmationAllowed(
				{ action, canConfirm: true },
				{ ...restricted, managementEnabled: false },
			),
			false,
		);
	}
});

test('active-member sales and existing-billing controls retain separate gates', () => {
	const active = { ...restricted, billingOnly: false };
	for (const action of ['upgrade', 'downgrade'] as const) {
		assert.equal(
			supporterChangeConfirmationAllowed({ action, canConfirm: true }, active),
			false,
		);
		assert.equal(
			supporterChangeConfirmationAllowed(
				{ action, canConfirm: true },
				{ ...active, enabled: true },
			),
			true,
		);
	}
	for (const action of ['cancel', 'undo', 'resume'] as const)
		assert.equal(
			supporterChangeConfirmationAllowed({ action, canConfirm: true }, active),
			true,
		);
});
