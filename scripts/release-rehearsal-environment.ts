import { randomBytes } from 'node:crypto';

// This production-data copy is approved only for private release compatibility
// checks. It must never become an ordinary staging/simulation target.
export const RELEASE_REHEARSAL_TARGET = Object.freeze({
	project: 'muddy-truth-80467726',
	branch: 'br-dawn-lab-a4mm36bg',
	host: 'ep-bitter-bread-a4uv2cgt.us-east-1.aws.neon.tech',
	database: 'verceldb',
	sourceHost: 'ep-shrill-rice-a4of0cft.us-east-1.aws.neon.tech',
});

export function releaseRehearsalEnvironment(
	source: Record<string, string | undefined>,
	port: number,
) {
	if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
		throw new Error('A valid private rehearsal port is required.');
	let database: URL;
	try { database = new URL(source['DATABASE_URL'] ?? ''); }
	catch { throw new Error('Source database configuration is invalid.'); }
	if (
		!['postgres:', 'postgresql:'].includes(database.protocol) ||
		!database.username || !database.password || database.searchParams.get('sslmode') !== 'require' ||
		database.hostname.replace('-pooler.', '.') !== RELEASE_REHEARSAL_TARGET.sourceHost ||
		decodeURIComponent(database.pathname.slice(1)) !== RELEASE_REHEARSAL_TARGET.database
	) throw new Error('Source configuration does not match this release rehearsal.');
	database.hostname = RELEASE_REHEARSAL_TARGET.host;
	// Never inherit provider credentials, app secrets, Vercel identity or arbitrary
	// NODE_OPTIONS preload hooks. A fresh session key isolates copied real sessions.
	const child: Record<string, string> = {};
	for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) {
		const value = source[name];
		if (value) child[name] = value;
	}
	const origin = `http://127.0.0.1:${port}`;
	Object.assign(child, {
		NODE_ENV: 'production', APP_ENV: 'production', APP_URL: origin,
		NEXTAUTH_URL: origin, NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
		ADMIN_ENCRYPTION_KEY: randomBytes(48).toString('base64url'),
		DATABASE_URL: database.href, DATABASE_URL_UNPOOLED: database.href,
		DATABASE_DATABASE: RELEASE_REHEARSAL_TARGET.database,
		DATABASE_USER: decodeURIComponent(database.username), DATABASE_PASSWORD: decodeURIComponent(database.password),
		DATABASE_HOST: RELEASE_REHEARSAL_TARGET.host,
		DISCORD_CLIENT_ID: 'private-rehearsal-disabled', DISCORD_CLIENT_SECRET: 'private-rehearsal-disabled',
		PAYMENTS_ENABLED: 'false', SUPPORTERS_ENABLED: 'false', FUNDS_ENABLED: 'false',
		SIMULATION_ENABLED: 'false', STRIPE_LIVE_APPROVED: 'false', NEXT_TELEMETRY_DISABLED: '1',
	});
	return child;
}

export function verifyReleaseRehearsalBinding(binding: {
	database?: unknown; project?: unknown; branch?: unknown;
}) {
	if (binding.database !== RELEASE_REHEARSAL_TARGET.database ||
		binding.project !== RELEASE_REHEARSAL_TARGET.project || binding.branch !== RELEASE_REHEARSAL_TARGET.branch)
		throw new Error('The live database is not the approved private rehearsal copy.');
}
