import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import postgres from 'postgres';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const configuration = isolatedConfiguration(process.env, 'test');
const sql = postgres(configuration.directUrl, { max: 1, onnotice: () => {} });
after(async () => {
	await sql.end();
});

test('script preflight verifies actual restricted CI role and existing identity without modifying data', async () => {
	assert.deepEqual(await verifyIsolatedTarget(sql, configuration), {
		empty: false,
	});
});

test('migration preflight rejects an incorrect existing marker before any migration can run', async () => {
	await assert.rejects(
		verifyIsolatedTarget(
			sql,
			{
				...configuration,
				identity: '00000000-0000-0000-0000-000000000000',
			},
			true,
		),
		/identity mismatch/,
	);
});

test('connected target cannot be relabeled as the other isolated environment', async () => {
	await assert.rejects(
		verifyIsolatedTarget(sql, { ...configuration, environment: 'staging' }),
		/identity mismatch/,
	);
});
