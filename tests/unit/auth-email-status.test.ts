import test from 'node:test';
import assert from 'node:assert/strict';
import { authEmailCaptured, authEmailRequestMessage, registrationEmailMessage } from '../../src/lib/auth-email-status.ts';

test('only isolated staging and test environments capture authentication email', () => {
	assert.equal(authEmailCaptured('staging'), true);
	assert.equal(authEmailCaptured('test'), true);
	assert.equal(authEmailCaptured('production'), false);
	assert.equal(authEmailCaptured('development'), false);
});
test('captured registration is not described as delivered or solved by resend', () => {
	const message = registrationEmailMessage(false, true);
	assert.match(message, /private test inbox/);
	assert.match(message, /resending will not deliver/);
	assert.doesNotMatch(message, /Check your email/);
	assert.equal(registrationEmailMessage(true, false), 'Check your email for a verification link.');
	assert.match(registrationEmailMessage(false, false), /could not send/);
});
test('resend and reset messages disclose test mode, not account existence or tokens', () => {
	for (const purpose of ['email_verification', 'password_reset'] as const) {
		assert.match(authEmailRequestMessage(purpose, 'staging'), /No email is sent/);
		assert.equal(authEmailRequestMessage(purpose, 'staging'), authEmailRequestMessage(purpose, 'test'));
		const production = authEmailRequestMessage(purpose, 'production');
		assert.match(production, /^If /);
		assert.match(production, /requested/);
		assert.doesNotMatch(production, /has been sent|https:|token=/);
	}
});
