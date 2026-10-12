const canonical = 'https://givetogive.ianrackson.com';
/** A mail-only host choice: never rewrites APP_URL/payment/webhook/staging URLs. */
export function authLinkBase(
	source: Readonly<Record<string, string | undefined>>,
): string {
	if (
		source['APP_ENV'] === 'production' &&
		source['EMAIL_PROVIDER'] === 'mailgun' &&
		source['GIVE_MAIL_RUNTIME_ADMISSION'] === 'v1'
	) {
		if (source['GIVE_AUTH_ORIGIN'] !== canonical)
			throw new Error('Give mail origin admission unavailable.');
		return canonical;
	}
	const configured =
		source['APP_URL'] ??
		source['VERCEL_PROJECT_PRODUCTION_URL'] ??
		source['NEXTAUTH_URL'];
	if (!configured) throw new Error('Give authentication origin unavailable.');
	return configured.startsWith('http') ? configured : `https://${configured}`;
}
