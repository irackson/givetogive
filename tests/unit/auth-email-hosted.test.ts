import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
	receivedAuthLink,
	validateHostedAuthInput,
	hostedAuthContext,
	authFieldLabel,
} from '../../scripts/auth-email-hosted.ts';
const sha = 'a'.repeat(40),
	nonce = '11111111-1111-4111-8111-111111111111';
const input = () => ({
	purpose: 'owned-agentmail-hosted-auth',
	nonce,
	headSha: sha,
	issuedAt: new Date().toISOString(),
	phase: 'signup-resend',
	email: 'ian-4303+givetogive-hosted-1791530445337@agentmail.to',
	password: 'public-test-placeholder-only',
	bypass: 'public-test-placeholder-only',
	deploymentId: 'dpl_testfixture',
});
test('auth labels accept MUI required markers without matching other fields', () => {
	for (const name of ['Name', 'Email', 'Password'] as const) {
		assert.match(name, authFieldLabel(name));
		assert.match(`${name} *`, authFieldLabel(name));
		assert.doesNotMatch(`Confirm ${name}`, authFieldLabel(name));
	}
});
test('real received links must be complete, first-party single-token verification URLs', () => {
	const valid =
		'https://givetogive-staging.vercel.app/verify-email?token=' +
		'a'.repeat(43);
	assert.equal(receivedAuthLink(valid), valid);
	for (const value of [
		undefined,
		'https://example.invalid/verify-email?token=' + 'a'.repeat(43),
		valid + '&next=https://bad.invalid',
		valid + '#x',
		'https://givetogive-staging.vercel.app/verify-email',
		valid.replace('/verify-email', '/reset-password'),
	])
		assert.throws(() => receivedAuthLink(value));
});
test('only the exact owned fixture, current source, phase and fresh input are accepted', () => {
	assert.equal(
		validateHostedAuthInput(input(), sha, 'signup-resend', nonce).phase,
		'signup-resend',
	);
	for (const change of [
		{ email: 'inasusr@gmail.com' },
		{ headSha: 'b'.repeat(40) },
		{ nonce: '22222222-2222-4222-8222-222222222222' },
		{ issuedAt: new Date(Date.now() - 1201000).toISOString() },
		{ oldLink: 'extra' },
		{ admin: true },
	])
		assert.throws(() =>
			validateHostedAuthInput(
				{ ...input(), ...change },
				sha,
				'signup-resend',
				nonce,
			),
		);
	const oldLink =
			'https://givetogive-staging.vercel.app/verify-email?token=' +
			'a'.repeat(43),
		replacementLink = oldLink.replace('a'.repeat(43), 'b'.repeat(43));
	assert.equal(
		validateHostedAuthInput(
			{
				...input(),
				phase: 'verify-signin',
				memberId: 'owned-fixture',
				oldLink,
				replacementLink,
			},
			sha,
			'verify-signin',
			nonce,
		).phase,
		'verify-signin',
	);
	assert.throws(() =>
		validateHostedAuthInput(
			{
				...input(),
				phase: 'verify-signin',
				memberId: 'owned-fixture',
				oldLink,
				replacementLink: oldLink,
			},
			sha,
			'verify-signin',
			nonce,
		),
	);
});
test('local import/default cannot invoke hosted credentials or browser work', () => {
	assert.throws(() => hostedAuthContext({ NODE_ENV: 'test' }, 'win32', 24));
	const data = JSON.parse(
		execFileSync(process.execPath, ['scripts/auth-email-hosted.ts'], {
			encoding: 'utf8',
		}),
	);
	assert.equal(data.execute, false);
	assert.equal(data.externalRequests, 0);
});
