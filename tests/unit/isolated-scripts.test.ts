import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedConfiguration } from '../../scripts/isolated-environment.ts';

const database = 'givetogive_staging_20260926';
const fixture = {
	APP_ENV: 'staging',
	DATABASE_DATABASE: database,
	DATABASE_USER: database,
	DATABASE_IDENTITY: '10213243-5465-7687-9809-a1b2c3d4e5f6',
	DATABASE_URL: `postgres://${database}:synthetic-placeholder@ep-fixture-pooler.example.invalid/${database}`,
	DATABASE_URL_UNPOOLED: `postgres://${database}:synthetic-placeholder@ep-fixture.example.invalid/${database}`,
	APP_URL: 'https://givetogive-staging.vercel.app',
};

test('isolated script configuration binds both URLs to exact environment, database and role', () => {
	assert.equal(isolatedConfiguration(fixture, 'staging').database, database);
	for (const patch of [
		{ APP_ENV: 'production' },
		{ DATABASE_USER: 'production_owner' },
		{
			DATABASE_URL:
				'postgres://production_owner:synthetic-placeholder@host.invalid/production',
		},
		{
			DATABASE_URL_UNPOOLED: `postgres://${database}:synthetic-placeholder@other.invalid/${database}`,
		},
		{ DATABASE_IDENTITY: '' },
		{ APP_URL: 'https://givetogive.vercel.app' },
		{ STRIPE_LIVE_APPROVED: 'true' },
		{ STRIPE_SECRET_KEY: 'sk_live_synthetic-placeholder' },
		{ STRIPE_PUBLISHABLE_KEY: 'pk_live_synthetic-placeholder' },
		{ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_synthetic-placeholder' },
	])
		assert.throws(() =>
			isolatedConfiguration({ ...fixture, ...patch }, 'staging'),
		);
});

test('configuration failures never echo a credential-bearing URL', () => {
	const privateMarker = 'never-disclose-this-value';
	assert.throws(
		() =>
			isolatedConfiguration({
				...fixture,
				DATABASE_URL: `postgres://wrong:${privateMarker}@host.invalid/production`,
			}),
		(error: Error) =>
			!error.message.includes(privateMarker) &&
			!error.message.includes('postgres://'),
	);
});
