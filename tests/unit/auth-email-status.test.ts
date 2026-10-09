import test from 'node:test';
import assert from 'node:assert/strict';
import {
	authEmailCaptured,
	authEmailRequestMessage,
	registrationEmailMessage,
} from '../../src/lib/auth-email-status.ts';

test('only isolated staging and test environments capture authentication email', () => {
	assert.equal(authEmailCaptured('staging'), true);
	assert.equal(authEmailCaptured('test'), true);
	assert.equal(authEmailCaptured('production'), false);
	assert.equal(authEmailCaptured('development'), false);
});

test('staging delivery requires an exact configured recipient, never a synthetic domain', () => {
	const allowed =
		' owner@agentmail.to, Neighbor@givetogive.invalid, someone@example.com ';
	assert.equal(
		authEmailCaptured('staging', 'OWNER@agentmail.to', allowed),
		false,
	);
	assert.equal(
		authEmailCaptured('staging', 'other@agentmail.to', allowed),
		true,
	);
	assert.equal(authEmailCaptured('staging', 'owner@agentmail.to'), true);
	assert.equal(
		authEmailCaptured('staging', 'neighbor@givetogive.invalid', allowed),
		true,
	);
	assert.equal(
		authEmailCaptured('staging', 'someone@example.com', allowed),
		true,
	);
	assert.equal(
		authEmailCaptured('test', 'owner@agentmail.to', allowed),
		true,
	);
	assert.equal(
		authEmailCaptured('production', 'owner@agentmail.to', allowed),
		false,
	);
	assert.equal(
		authEmailCaptured('staging', 'owner@agentmail.to.evil', allowed),
		true,
	);
});

test('allowed staging recipient wording remains account-independent and never promises delivery', () => {
	for (const purpose of ['email_verification', 'password_reset'] as const) {
		const message = authEmailRequestMessage(purpose, 'staging', false);
		assert.match(message, /^If /);
		assert.doesNotMatch(
			message,
			/No email is sent|has been sent|https:|token=/,
		);
	}
});
test('captured registration is not described as delivered or solved by resend', () => {
	const message = registrationEmailMessage(false, true);
	assert.match(message, /private test inbox/);
	assert.match(message, /resending will not deliver/);
	assert.doesNotMatch(message, /Check your email/);
	assert.equal(
		registrationEmailMessage(true, false),
		'Check your email for a verification link.',
	);
	assert.match(registrationEmailMessage(false, false), /could not send/);
});
test('resend and reset messages disclose test mode, not account existence or tokens', () => {
	for (const purpose of ['email_verification', 'password_reset'] as const) {
		assert.match(
			authEmailRequestMessage(purpose, 'staging'),
			/No email is sent/,
		);
		assert.equal(
			authEmailRequestMessage(purpose, 'staging'),
			authEmailRequestMessage(purpose, 'test'),
		);
		const production = authEmailRequestMessage(purpose, 'production');
		assert.match(production, /^If /);
		assert.match(production, /requested/);
		assert.doesNotMatch(production, /has been sent|https:|token=/);
	}
});
