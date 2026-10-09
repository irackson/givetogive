import assert from 'node:assert/strict';
import { test } from 'node:test';
// Import must remain inert: no browser launch, output allocation or network.
import {
	captureFailureType,
	origin,
	publicDetailPath,
	publicPaths,
	readOnlyMethod,
	signInCallback,
} from '../../scripts/capture-public-walkthrough.mjs';

test('capture failure classification never returns private messages, URL or unknown error names', () => {
	const privateMessage = 'https://private.invalid/?token=not-public';
	assert.equal(
		captureFailureType({ name: 'TimeoutError', message: privateMessage }),
		'timeout',
	);
	assert.equal(
		captureFailureType({ name: 'AssertionError', message: privateMessage }),
		'assertion',
	);
	for (const error of [
		new Error(privateMessage),
		{ name: privateMessage },
		privateMessage,
		null,
	]) {
		assert.equal(captureFailureType(error), 'runtime');
	}
});

test('public capture is fixed to production anonymous routes with no sensitive query', () => {
	assert.equal(origin, 'https://givetogive.vercel.app');
	assert.ok(Object.isFrozen(publicPaths));
	assert.equal(new Set(publicPaths).size, publicPaths.length);
	assert.ok(
		publicPaths.every(
			(route) =>
				route.startsWith('/') &&
				!route.includes('?') &&
				!route.includes('#'),
		),
	);
});

test('only read-only request methods may leave the browser', () => {
	for (const method of ['GET', 'HEAD', 'OPTIONS'])
		assert.equal(readOnlyMethod(method), true);
	for (const method of [
		'POST',
		'PUT',
		'PATCH',
		'DELETE',
		'CONNECT',
		'get',
		'',
		null,
	])
		assert.equal(readOnlyMethod(method), false);
});

test('public details must be observed local paths, not arbitrary redirects or tokens', () => {
	assert.equal(
		publicDetailPath('/asks/real-ask_123', 'asks'),
		'/asks/real-ask_123',
	);
	assert.equal(
		publicDetailPath('/members/observed-member', 'members'),
		'/members/observed-member',
	);
	for (const href of [
		'/asks',
		'/asks/a?token=secret',
		'/asks/a#secret',
		'/asks/a/b',
		'/asks/../admin',
		'//evil.test/asks/a',
		'https://givetogive.vercel.app/asks/a',
		'/asks/%2fadmin',
		'/members/a',
		null,
	]) {
		assert.equal(publicDetailPath(href, 'asks'), null);
	}
	assert.equal(publicDetailPath('/admin/a', 'admin'), null);
});

test('anonymous capture follows the existing shared admin callback without claiming child content', () => {
	for (const route of ['/admin', '/admin/activity', '/admin/simulations'])
		assert.equal(signInCallback(route), '/admin');
	for (const route of ['/giving', '/account/billing', '/account/security'])
		assert.equal(signInCallback(route), route);
});
