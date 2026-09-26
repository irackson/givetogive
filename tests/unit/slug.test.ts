import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	createSlugBase,
	createSlugCandidate,
} from '../../src/lib/utils/slug.ts';

describe('Ask slugs', () => {
	it('keeps numeric titles distinct from legacy numeric ID routes', () => {
		assert.equal(createSlugBase('123'), 'ask-123');
		assert.equal(createSlugBase(' 000123! '), 'ask-000123');
		assert.equal(createSlugCandidate(createSlugBase('123'), 2), 'ask-123-2');
	});

	it('reserves the creation action name without rejecting the title', () => {
		assert.equal(createSlugBase('Create'), 'ask-create');
		assert.equal(createSlugBase(' CREATE! '), 'ask-create');
		assert.equal(createSlugBase('Create a garden'), 'create-a-garden');
	});

	it('normalizes accents and punctuation and supplies an empty fallback', () => {
		assert.equal(createSlugBase('Jos\u00e9\u2019s extra chairs!'), 'joses-extra-chairs');
		assert.equal(createSlugBase('---'), 'ask');
		assert.equal(createSlugBase('\ud83e\udd1d\ud83c\udf31'), 'ask');
	});

	it('bounds long bases and collision candidates', () => {
		const longBase = createSlugBase('a'.repeat(300));
		assert.equal(longBase.length, 240);
		assert.equal(createSlugBase('1'.repeat(300)).length, 240);
		assert.ok(createSlugCandidate(longBase, 100).length <= 256);
		assert.equal(createSlugCandidate('chairs', 1), 'chairs');
		assert.equal(createSlugCandidate('chairs', 3), 'chairs-3');
	});
});
