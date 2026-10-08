import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import { emailSink } from '../../src/server/db/operations-schema.ts';
import { sendAuthEmail } from '../../src/server/auth/email.ts';
import { openSecret } from '../../src/server/security/crypto.ts';

before(async () => {
	assert.equal(process.env['APP_ENV'], 'test');
	const [identity] = await db.execute<{ name: string; role: string }>(sql`select current_database() as name, current_user as role`);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
});
after(async () => { await db.$client.end(); });

test('isolated email is encrypted and captured, never reported as external delivery or sent to a provider', async () => {
	const to = `capture-${randomUUID()}@example.invalid`;
	const url = `https://example.invalid/verify-email?token=${randomUUID()}`;
	const originalFetch = globalThis.fetch;
	let externalRequests = 0;
	globalThis.fetch = async () => { externalRequests++; throw new Error('External email requests are forbidden in isolated tests.'); };
	try {
		const result = await sendAuthEmail({ to, url, purpose: 'email_verification' });
		assert.deepEqual(result, { delivered: false, captured: true, previewUrl: undefined });
		const messages = await db.select().from(emailSink).where(eq(emailSink.to, to));
		assert.equal(messages.length, 1);
		assert.equal(messages[0]?.purpose, 'email_verification');
		assert.notEqual(messages[0]?.urlCiphertext, url);
		assert.equal(openSecret(messages[0]!.urlCiphertext, 'staging-email'), url);
		assert.equal(externalRequests, 0);
	} finally {
		globalThis.fetch = originalFetch;
		await db.delete(emailSink).where(eq(emailSink.to, to));
	}
});
