import type { ApplicationEnvironment } from './environment.ts';

export function authEmailCaptured(
	environment: ApplicationEnvironment,
	recipient?: string,
	stagingRecipients = '',
) {
	if (environment === 'test') return true;
	if (environment !== 'staging') return false;
	const email = recipient?.trim().toLowerCase();
	// Simulated recipients must never reach an external sender, even if misconfigured.
	if (
		!email ||
		/@(?:[^@]+\.)?(?:invalid|test|localhost|example\.(?:com|org|net))$/.test(
			email,
		)
	)
		return true;
	return !stagingRecipients
		.split(',')
		.some((allowed) => allowed.trim().toLowerCase() === email);
}

/** Environment-only wording: never discloses whether a supplied address has an account. */
export function authEmailRequestMessage(
	purpose: 'email_verification' | 'password_reset',
	environment: ApplicationEnvironment,
	captured = authEmailCaptured(environment),
) {
	if (captured)
		return 'This test site captures eligible authentication links in a private test inbox. No email is sent. Contact the site operator for your own link.';
	return purpose === 'email_verification' ?
			'If that account still needs verification, a new link has been requested.'
		:	'If an account exists for that email, a reset link has been requested.';
}

export function registrationEmailMessage(
	delivered: boolean,
	captured: boolean,
) {
	if (captured)
		return 'This test site saved your verification link in a private test inbox instead of emailing it. Contact the site operator for your own link; resending will not deliver an email.';
	return delivered ?
			'Check your email for a verification link.'
		:	'We could not send the verification email. Please try again.';
}
