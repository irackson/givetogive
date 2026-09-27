import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../../src/server/auth/password';
import {
	expect,
	test,
	type Page,
	type APIRequestContext,
} from '@playwright/test';
import superjson from 'superjson';

const environment = process.env['APP_ENV'];
const databaseName =
	environment === 'test' ? 'givetogive_ci_20260926'
	: environment === 'staging' ? 'givetogive_staging_20260926'
	: undefined;
const databaseUrl = new URL(process.env['DATABASE_URL'] ?? 'about:blank');
if (
	!databaseName ||
	databaseUrl.pathname !== `/${databaseName}` ||
	databaseUrl.username !== databaseName
) {
	throw new Error(
		'Refusing browser-test writes outside the isolated synthetic database.',
	);
}
export const testSql = postgres(process.env['DATABASE_URL']!, { max: 2 });
test.beforeAll(async () => {
	const [identity] =
		await testSql`SELECT current_database() AS name, current_user AS role,
		environment, database_name FROM givetogive_environment_identity WHERE id=1`;
	expect(identity?.['name']).toBe(databaseName);
	expect(identity?.['role']).toBe(databaseName);
	expect(identity?.['database_name']).toBe(databaseName);
	expect(identity?.['environment']).toBe(environment);
});

// Only the trusted test runner can decrypt the isolated email sink. The site
// deliberately never exposes reset/verification URLs in an API or browser UI.
export async function latestEmailLink(
	email: string,
	purpose: 'email_verification' | 'password_reset',
) {
	let ciphertext: string | undefined;
	await expect
		.poll(async () => {
			const [row] =
				await testSql`SELECT url_ciphertext FROM givetogive_email_sink
			WHERE recipient=${email} AND purpose=${purpose} ORDER BY id DESC LIMIT 1`;
			ciphertext = row?.['url_ciphertext'] as string | undefined;
			return Boolean(ciphertext);
		})
		.toBe(true);
	const key = process.env['ADMIN_ENCRYPTION_KEY'];
	if (!key)
		throw new Error('The isolated email-sink encryption key is required.');
	const [iv, tag, encrypted] = ciphertext!
		.split('.')
		.map((part) => Buffer.from(part, 'base64url'));
	const decipher = createDecipheriv(
		'aes-256-gcm',
		createHash('sha256').update(key).digest(),
		iv!,
	);
	decipher.setAAD(Buffer.from('staging-email'));
	decipher.setAuthTag(tag!);
	const url = new URL(
		Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString(
			'utf8',
		),
	);
	const expectedOrigin = new URL(
		process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3100',
	).origin;
	if (url.origin !== expectedOrigin)
		throw new Error('The email link points outside the test origin.');
	return url.toString();
}

export async function makeMembers() {
	const runId = randomUUID();
	const password = `Release-${randomUUID()}!`;
	const hash = await hashPassword(password);
	const members = ['Alex Rivera', 'Jamie Brooks', 'Morgan Chen'].map(
		(name, index) => ({
			id: randomUUID(),
			name,
			email: `givetogive-release-${runId}-${index}@example.invalid`,
			password,
		}),
	);
	await testSql`INSERT INTO givetogive_user ${testSql(members.map(({ id, name, email }) => ({ id, name, email, hashed_password: hash, email_verified: new Date(), is_synthetic: true })))}`;
	return members as [
		(typeof members)[number],
		(typeof members)[number],
		(typeof members)[number],
	];
}

export async function cleanMembers(ids: string[]) {
	if (!ids.length) return;
	await testSql.begin(async (sql) => {
		// Only records belonging to this run's exact synthetic IDs are removed.
		const members =
			await sql`SELECT id,email FROM givetogive_user WHERE id IN ${sql(ids)}`;
		if (
			members.some(
				(member) =>
					!String(member['email']).startsWith('givetogive-') ||
					!String(member['email']).endsWith('@example.invalid'),
			)
		) {
			throw new Error(
				'Cleanup only accepts this test harness synthetic identities.',
			);
		}
		for (const member of members)
			await sql`DELETE FROM givetogive_email_sink WHERE recipient=${String(member['email'])}`;
		await sql`DELETE FROM givetogive_saved_ask WHERE user_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_ask_activity WHERE actor_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_ask_contribution WHERE contributor_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_ask WHERE created_by IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_auth_token WHERE user_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_session WHERE user_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_account WHERE user_id IN ${sql(ids)}`;
		await sql`DELETE FROM givetogive_user WHERE id IN ${sql(ids)}`;
	});
}

export async function login(
	page: Page,
	member: { email: string; password: string },
) {
	await page.goto('/signin');
	await page.getByLabel('Email').fill(member.email);
	await page.getByLabel('Password').fill(member.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
}

export async function rpc(
	request: APIRequestContext,
	procedure: string,
	input: unknown,
	method: 'get' | 'post' = 'post',
) {
	const serialized = superjson.serialize(input);
	const response =
		method === 'get' ?
			await request.get(
				`/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(serialized))}`,
			)
		:	await request.post(`/api/trpc/${procedure}`, { data: serialized });
	const payload = await response.json();
	return {
		status: response.status(),
		data:
			payload.result ?
				(superjson.deserialize(payload.result.data) as Record<
					string,
					unknown
				>)
			:	undefined,
		error: payload.error?.json as
			{ message: string; data: { code: string } } | undefined,
	};
}
