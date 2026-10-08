import type { ApplicationEnvironment } from './environment.ts';

export function authEmailCaptured(environment: ApplicationEnvironment) {
	return environment === 'staging' || environment === 'test';
}

/** Environment-only wording: never discloses whether a supplied address has an account. */
export function authEmailRequestMessage(
	purpose: 'email_verification' | 'password_reset',
	environment: ApplicationEnvironment,
) {
	if (authEmailCaptured(environment))
		return 'This test site captures eligible authentication links in a private test inbox. No email is sent. Contact the site operator for your own link.';
	return purpose === 'email_verification' ?
		'If that account still needs verification, a new link has been requested.'
	:	'If an account exists for that email, a reset link has been requested.';
}

export function registrationEmailMessage(delivered: boolean, captured: boolean) {
	if (captured)
		return 'This test site saved your verification link in a private test inbox instead of emailing it. Contact the site operator for your own link; resending will not deliver an email.';
	return delivered ?
		'Check your email for a verification link.'
	:	'We could not send the verification email. Please try again.';
}
