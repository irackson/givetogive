import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_REHEARSAL_TARGET, releaseRehearsalEnvironment, verifyReleaseRehearsalBinding } from '../../scripts/release-rehearsal-environment.ts';

const source = {
	DATABASE_URL: `postgresql://fixture:fixture-password@${RELEASE_REHEARSAL_TARGET.sourceHost}/verceldb?sslmode=require`,
	STRIPE_SECRET_KEY: 'must-not-be-inherited', STRIPE_WEBHOOK_SECRET: 'must-not-be-inherited',
	GOOGLE_REFRESH_TOKEN: 'must-not-be-inherited', RESEND_API_KEY: 'must-not-be-inherited',
	NEXTAUTH_SECRET: 'must-not-be-inherited', ADMIN_ENCRYPTION_KEY: 'must-not-be-inherited',
	VERCEL_URL: 'must-not-be-inherited', NODE_OPTIONS: '--require=must-not-be-inherited',
	PAYMENTS_ENABLED: 'true', SUPPORTERS_ENABLED: 'true', FUNDS_ENABLED: 'true',
	SIMULATION_ENABLED: 'true', STRIPE_LIVE_APPROVED: 'true', PATH: 'fixture-path',
};

test('private rehearsal rewrites only the approved endpoint and disables all external financial/member integrations', () => {
	const env = releaseRehearsalEnvironment(source, 3111);
	assert.equal(new URL(env['DATABASE_URL']!).hostname, RELEASE_REHEARSAL_TARGET.host);
	assert.equal(new URL(env['DATABASE_URL']!).pathname, '/verceldb');
	assert.equal(env['DATABASE_URL'], env['DATABASE_URL_UNPOOLED']);
	assert.equal(env['APP_URL'], 'http://127.0.0.1:3111');
	assert.equal(env['NEXTAUTH_URL'], env['APP_URL']);
	assert.equal(env['APP_ENV'], 'production');
	assert.equal(env['NODE_ENV'], 'production');
	for (const flag of ['PAYMENTS_ENABLED', 'SUPPORTERS_ENABLED', 'FUNDS_ENABLED', 'SIMULATION_ENABLED', 'STRIPE_LIVE_APPROVED'])
		assert.equal(env[flag], 'false');
	for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GOOGLE_REFRESH_TOKEN', 'RESEND_API_KEY', 'VERCEL_URL', 'NODE_OPTIONS'])
		assert.equal(env[key], undefined);
	assert.notEqual(env['NEXTAUTH_SECRET'], source.NEXTAUTH_SECRET);
	assert.notEqual(env['ADMIN_ENCRYPTION_KEY'], source.ADMIN_ENCRYPTION_KEY);
	assert.equal(env['PATH'], source.PATH);
	assert.equal(source.PAYMENTS_ENABLED, 'true');
});

test('rehearsal sessions and sealing secrets are fresh for every launcher invocation', () => {
	const a = releaseRehearsalEnvironment(source, 3111), b = releaseRehearsalEnvironment(source, 3111);
	assert.notEqual(a['NEXTAUTH_SECRET'], b['NEXTAUTH_SECRET']);
	assert.notEqual(a['ADMIN_ENCRYPTION_KEY'], b['ADMIN_ENCRYPTION_KEY']);
});

test('wrong source database, host, protocol, missing TLS or credentials cannot launch a rehearsal', () => {
	for (const value of [
		'not-a-url', source.DATABASE_URL.replace('/verceldb?', '/givetogive_staging_20260926?'),
		source.DATABASE_URL.replace(RELEASE_REHEARSAL_TARGET.sourceHost, RELEASE_REHEARSAL_TARGET.host),
		source.DATABASE_URL.replace('postgresql:', 'https:'), source.DATABASE_URL.replace('?sslmode=require', ''),
		source.DATABASE_URL.replace('fixture:fixture-password@', ''),
	]) assert.throws(() => releaseRehearsalEnvironment({ ...source, DATABASE_URL: value }, 3111));
});

test('private port validation prevents malformed arguments and public/default port assumptions', () => {
	for (const port of [0, 80, 1023, 65536, 3111.5, NaN])
		assert.throws(() => releaseRehearsalEnvironment(source, port));
});

test('live binding rejects production, staging and differently named copied databases', () => {
	const binding = { database: RELEASE_REHEARSAL_TARGET.database, project: RELEASE_REHEARSAL_TARGET.project, branch: RELEASE_REHEARSAL_TARGET.branch };
	assert.doesNotThrow(() => verifyReleaseRehearsalBinding(binding));
	for (const invalid of [undefined, '', 'production', 'br-holy-lake-a48597y6']) {
		assert.throws(() => verifyReleaseRehearsalBinding({ ...binding, branch: invalid }));
		assert.throws(() => verifyReleaseRehearsalBinding({ ...binding, project: invalid }));
		assert.throws(() => verifyReleaseRehearsalBinding({ ...binding, database: invalid }));
	}
});
