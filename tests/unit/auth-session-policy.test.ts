import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session } from 'next-auth';
import {
	activeSession,
	refreshIdentityToken,
	sessionContexts,
	type SessionIdentity,
} from '../../src/server/auth/session-policy.ts';

const identity: SessionIdentity = {
	id: 'member-id',
	role: 'admin',
	sessionVersion: 7,
	frozenAt: new Date(),
	emailVerified: new Date(),
};
test('fresh verified frozen sign-in gets identity-only billing access, not admin role', () => {
	const token = refreshIdentityToken({}, identity, true)!;
	assert.equal(token.access, 'billing_only');
	assert.equal(token.role, 'member');
	assert.equal(token.sessionVersion, 7);
	assert.equal(token.sub, identity.id);
	assert.ok(token.authenticatedAt);
	assert.equal(
		refreshIdentityToken({}, { ...identity, emailVerified: null }, true),
		null,
	);
});
test('old active or stale billing sessions never convert after a freeze or version rotation', () => {
	assert.equal(
		refreshIdentityToken(
			{ sub: identity.id, sessionVersion: 6, access: 'active' },
			identity,
			false,
		),
		null,
	);
	assert.equal(
		refreshIdentityToken(
			{ sub: identity.id, sessionVersion: 7, access: 'active' },
			identity,
			false,
		),
		null,
	);
	assert.equal(
		refreshIdentityToken(
			{ sub: identity.id, sessionVersion: 6, access: 'billing_only' },
			identity,
			false,
		),
		null,
	);
	assert.equal(
		refreshIdentityToken(
			{ sub: 'other', sessionVersion: 7, access: 'billing_only' },
			identity,
			false,
		),
		null,
	);
	assert.equal(refreshIdentityToken({}, undefined, true), null);
});
test('unfreeze requires a fresh login; ordinary active and legacy valid sessions remain active', () => {
	const current = { ...identity, frozenAt: null };
	assert.equal(
		refreshIdentityToken(
			{ sub: identity.id, sessionVersion: 7, access: 'billing_only' },
			current,
			false,
		),
		null,
	);
	assert.equal(
		refreshIdentityToken(
			{ sub: identity.id, sessionVersion: 7 },
			current,
			false,
		)?.access,
		'active',
	);
	assert.equal(refreshIdentityToken({}, current, true)?.role, 'admin');
});
test('public/ordinary auth sessions never expose a billing-only identity', () => {
	const restricted: Session = {
		access: 'billing_only',
		expires: new Date().toISOString(),
		user: {
			id: identity.id,
			role: 'member',
			sessionVersion: 7,
			authenticatedAt: Date.now(),
		},
	};
	assert.equal(activeSession(restricted), null);
	assert.deepEqual(sessionContexts(restricted), {
		session: null,
		billingSession: restricted,
	});
	const active = { ...restricted, access: 'active' as const };
	assert.equal(activeSession(active), active);
	assert.deepEqual(sessionContexts(null), {
		session: null,
		billingSession: null,
	});
});
