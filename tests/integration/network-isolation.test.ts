/** Standard CI command must reject provider HTTP before any network activity. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import http, { request as httpRequest } from 'node:http';
import https, { request as httpsRequest } from 'node:https';
import { sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';

after(() => db.$client.end());
const denied = (error: unknown) =>
	error instanceof Error &&
	error.message ===
		'Outbound HTTP disabled for isolated regression execution.';

test('CI fetch and default/named HTTP clients reject without exposing request details', async () => {
	const privateCanary = 'ci-private-request-canary';
	await assert.rejects(
		fetch(`https://provider.example.invalid/${privateCanary}`),
		denied,
	);
	for (const request of [http.request, http.get, httpRequest]) {
		assert.throws(
			() => request(`http://provider.example.invalid/${privateCanary}`),
			denied,
		);
	}
	for (const request of [https.request, https.get, httpsRequest]) {
		assert.throws(
			() => request(`https://provider.example.invalid/${privateCanary}`),
			denied,
		);
	}
});

test('verified CI PostgreSQL remains available while provider HTTP is disabled', async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	const [identity] = await db.execute<{ name: string; role: string }>(
		sql`SELECT current_database() AS name, current_user AS role`,
	);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
});
