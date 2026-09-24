import 'server-only';

import { env } from '@/env';
import type { AuthTokenPurpose } from '@/server/auth/tokens';

interface AuthEmailInput {
	to: string;
	url: string;
	purpose: AuthTokenPurpose;
}

type AuthEmailProvider = 'gmail' | 'resend';

function getEmailProvider(): AuthEmailProvider | undefined {
	if (
		env.GOOGLE_CLIENT_ID &&
		env.GOOGLE_CLIENT_SECRET &&
		env.GOOGLE_REFRESH_TOKEN &&
		env.GMAIL_SENDER
	) {
		return 'gmail';
	}

	if (env.RESEND_API_KEY && env.AUTH_EMAIL_FROM) {
		return 'resend';
	}

	return undefined;
}

function getEmailHtml(action: string, url: string) {
	return `<p>${action} for your GiveToGive account:</p><p><a href="${url}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`;
}

async function getGoogleAccessToken() {
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID!,
			client_secret: env.GOOGLE_CLIENT_SECRET!,
			grant_type: 'refresh_token',
			refresh_token: env.GOOGLE_REFRESH_TOKEN!,
		}),
	});
	const payload: unknown = await response.json().catch(() => undefined);
	const accessToken =
		typeof payload === 'object' &&
		payload !== null &&
		'access_token' in payload &&
		typeof payload.access_token === 'string'
			? payload.access_token
			: undefined;

	if (!response.ok || !accessToken) {
		throw new Error(
			`Gmail OAuth token request failed with status ${response.status}.`,
		);
	}

	return accessToken;
}

async function sendWithGmail({ to, url, purpose }: AuthEmailInput) {
	const subject =
		purpose === 'email_verification' ?
			'Verify your GiveToGive email'
		:		'Reset your GiveToGive password';
	const action =
		purpose === 'email_verification' ? 'Verify email' : 'Reset password';
	const message = [
		`From: ${env.GMAIL_SENDER}`,
		`To: ${to}`,
		`Subject: ${subject}`,
		'MIME-Version: 1.0',
		'Content-Type: text/html; charset="UTF-8"',
		'',
		getEmailHtml(action, url),
	].join('\r\n');
	const accessToken = await getGoogleAccessToken();
	const response = await fetch(
		'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ raw: Buffer.from(message).toString('base64url') }),
		},
	);

	if (!response.ok) {
		throw new Error(`Gmail delivery failed with status ${response.status}.`);
	}
}

async function sendWithResend({ to, url, purpose }: AuthEmailInput) {
	const subject =
		purpose === 'email_verification' ?
			'Verify your GiveToGive email'
		:		'Reset your GiveToGive password';
	const action =
		purpose === 'email_verification' ? 'Verify email' : 'Reset password';
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			'Content-Type': 'application/json',
			'User-Agent': 'GiveToGive/1.0',
		},
		body: JSON.stringify({
			from: env.AUTH_EMAIL_FROM,
			to: [to],
			subject,
			html: getEmailHtml(action, url),
		}),
	});

	if (!response.ok) {
		throw new Error(`Resend delivery failed with status ${response.status}.`);
	}
}

export async function sendAuthEmail({ to, url, purpose }: AuthEmailInput) {
	const provider = getEmailProvider();

	if (provider === 'gmail') {
		await sendWithGmail({ to, url, purpose });
	} else if (provider === 'resend') {
		await sendWithResend({ to, url, purpose });
	}

	return {
		delivered: Boolean(provider),
		previewUrl: env.NODE_ENV === 'development' ? url : undefined,
	};
}
