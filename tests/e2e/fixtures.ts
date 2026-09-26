import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../../src/server/auth/password';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import superjson from 'superjson';

if (!process.env['DATABASE_URL']) loadEnvFile('.env.local');
export const testSql = postgres(process.env['DATABASE_URL']!, { max: 2 });

export async function makeMembers() {
	const runId = randomUUID();
	const password = `Release-${randomUUID()}!`;
	const hash = await hashPassword(password);
	const members = ['Alex Rivera', 'Jamie Brooks', 'Morgan Chen'].map((name, index) => ({
		id: randomUUID(), name, email: `givetogive-release-${runId}-${index}@example.invalid`, password,
	}));
	await testSql`INSERT INTO givetogive_user ${testSql(members.map(({ id, name, email }) => ({ id, name, email, hashed_password: hash, email_verified: new Date() })))}`;
	return members as [typeof members[number], typeof members[number], typeof members[number]];
}

export async function cleanMembers(ids: string[]) {
	if (!ids.length) return;
	await testSql.begin(async (sql) => {
		// Only records belonging to this run's exact synthetic IDs are removed.
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

export async function login(page: Page, member: { email: string; password: string }) {
	await page.goto('/signin');
	await page.getByLabel('Email').fill(member.email);
	await page.getByLabel('Password').fill(member.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
}

export async function rpc(request: APIRequestContext, procedure: string, input: unknown, method: 'get' | 'post' = 'post') {
	const serialized = superjson.serialize(input);
	const response = method === 'get'
		? await request.get(`/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(serialized))}`)
		: await request.post(`/api/trpc/${procedure}`, { data: serialized });
	const payload = await response.json();
	return {
		status: response.status(),
		data: payload.result ? superjson.deserialize(payload.result.data) as Record<string, unknown> : undefined,
		error: payload.error?.json as { message: string; data: { code: string } } | undefined,
	};
}
