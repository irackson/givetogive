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

test('pre-payments JWTs stay valid for default-version members but cannot bypass revocation', () => {
	const migratedMember: SessionIdentity = {
		id: 'pre-payments-member', role: 'member', sessionVersion: 0,
		frozenAt: null, emailVerified: new Date(),
	};
	// The published app's JWT did not include access, role or sessionVersion.
	const legacy = { sub: migratedMember.id, name: 'Existing member' };
	const refreshed = refreshIdentityToken(legacy, migratedMember, false)!;
	assert.equal(refreshed.sub, migratedMember.id);
	assert.equal(refreshed.name, legacy.name);
	assert.equal(refreshed.access, 'active');
	assert.equal(refreshed.role, 'member');
	// Do not invent recent authentication for an old token; step-up still requires login.
	assert.equal(refreshed.authenticatedAt, undefined);
	assert.equal(refreshIdentityToken(legacy, { ...migratedMember, sessionVersion: 1 }, false), null);
	assert.equal(refreshIdentityToken(legacy, { ...migratedMember, frozenAt: new Date() }, false), null);
	assert.equal(refreshIdentityToken({ ...legacy, sub: 'another-member' }, migratedMember, false), null);
});
