import assert from 'node:assert/strict';
import test from 'node:test';
import { safeCallbackPath } from '../../src/lib/safeCallbackPath.ts';

test('sign-in redirects remain on this site', () => {
	for (const input of [undefined, null, ['/asks', '//evil.invalid'], 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/\n/evil.invalid', 'javascript:alert(1)']) {
		assert.equal(safeCallbackPath(input), '/');
	}
	assert.equal(safeCallbackPath('/asks?type=money&saved=1'), '/asks?type=money&saved=1');
});
