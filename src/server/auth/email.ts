import 'server-only';

import { env } from '@/env';
import type { AuthTokenPurpose } from '@/server/auth/tokens';

interface AuthEmailInput {
	to: string;
	url: string;
	purpose: AuthTokenPurpose;
}

export async function sendAuthEmail({ to, url, purpose }: AuthEmailInput) {
	const subject =
		purpose === 'email_verification' ?
			'Verify your GiveToGive email'
		:	'Reset your GiveToGive password';
	const action =
		purpose === 'email_verification' ? 'Verify email' : 'Reset password';
	const configured = Boolean(env.RESEND_API_KEY && env.AUTH_EMAIL_FROM);

	if (configured) {
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.RESEND_API_KEY}`,
				'Content-Type': 'application/json',
				'User-Agent': 'GiveToGive/1.0',
			},
			body: JSON.stringify({
				from: env.AUTH_EMAIL_FROM,
				to: [to],
				subject,
				html: `<p>${action} for your GiveToGive account:</p><p><a href="${url}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
			}),
		});

		if (!response.ok) {
			throw new Error(
				`Email delivery failed with status ${response.status}.`,
			);
		}
	}

	return {
		delivered: configured,
		previewUrl: env.NODE_ENV === 'development' ? url : undefined,
	};
}
