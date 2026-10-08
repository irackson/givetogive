import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardAccessAllowed } from '../../src/lib/dashboard-access.ts';

const owner = {
	email: 'inasusr@gmail.com',
	emailVerified: new Date(),
	frozenAt: null,
	isSynthetic: false,
	role: 'member' as const,
};
const environments = ['production', 'development', 'staging', 'test'] as const;

test('only the verified real owner has dashboard access, without granting a DB role', () => {
	for (const environment of environments) {
		assert.equal(dashboardAccessAllowed(owner, environment), true);
		assert.equal(
			dashboardAccessAllowed(
				{ ...owner, email: 'INASUSR@gmail.com' },
				environment,
			),
			true,
		);
		for (const email of [
			null,
			'other@gmail.com',
			'inasusr+admin@gmail.com',
			'inasusr@gmail.com.evil',
			' inasusr@gmail.com',
		])
			for (const role of ['member', 'admin'] as const)
				assert.equal(
					dashboardAccessAllowed(
						{ ...owner, email, role },
						environment,
					),
					false,
				);
	}
});
test('unverified and frozen owner identities are denied in every environment', () => {
	for (const environment of environments) {
		assert.equal(
			dashboardAccessAllowed(
				{ ...owner, emailVerified: null },
				environment,
			),
			false,
		);
		assert.equal(
			dashboardAccessAllowed(
				{ ...owner, frozenAt: new Date() },
				environment,
			),
			false,
		);
	}
});
test('synthetic agent operators stay in staging/test and cannot impersonate the owner', () => {
	for (const environment of environments) {
		const allowed = environment === 'staging' || environment === 'test';
		assert.equal(
			dashboardAccessAllowed(
				{ ...owner, isSynthetic: true, role: 'admin' },
				environment,
			),
			allowed,
		);
		assert.equal(
			dashboardAccessAllowed(
				{
					...owner,
					isSynthetic: true,
					email: 'operator@example.invalid',
					role: 'admin',
				},
				environment,
			),
			allowed,
		);
		assert.equal(
			dashboardAccessAllowed(
				{ ...owner, isSynthetic: true },
				environment,
			),
			false,
		);
		assert.equal(
			dashboardAccessAllowed(
				{
					...owner,
					isSynthetic: true,
					role: 'admin',
					emailVerified: null,
				},
				environment,
			),
			false,
		);
		assert.equal(
			dashboardAccessAllowed(
				{
					...owner,
					isSynthetic: true,
					role: 'admin',
					frozenAt: new Date(),
				},
				environment,
			),
			false,
		);
	}
});
