import assert from 'node:assert/strict';
import test from 'node:test';
import { askFilterHref, parseAskFilters } from '../../src/lib/ask-browsing.ts';

test('shared filter links parse every supported filter consistently', () => {
	assert.deepEqual(
		parseAskFilters(
			new URLSearchParams(
				'type=money&status=in_progress&difficulty=2&minutes=45&q=+garden+tools+&saved=1',
			),
		),
		{
			type: 'money',
			status: 'in_progress',
			maxDifficulty: 2,
			maxMinutes: 45,
			query: 'garden tools',
			savedOnly: true,
		},
	);
});

test('invalid deep-link values cannot cause an invalid API request', () => {
	assert.deepEqual(
		parseAskFilters(
			new URLSearchParams(
				'type=unknown&status=cancelled&difficulty=0x2&minutes=-30&saved=true&q=++',
			),
		),
		{
			type: undefined,
			status: undefined,
			maxDifficulty: undefined,
			maxMinutes: undefined,
			query: undefined,
			savedOnly: false,
		},
	);
	for (const invalid of ['0', '1.5', '6', '9999999999999999999999']) {
		assert.equal(
			parseAskFilters(new URLSearchParams({ difficulty: invalid }))
				.maxDifficulty,
			undefined,
		);
	}
	assert.equal(
		parseAskFilters(new URLSearchParams({ minutes: '10001' })).maxMinutes,
		undefined,
	);
	assert.equal(
		parseAskFilters(new URLSearchParams({ q: 'x'.repeat(150) })).query
			?.length,
		100,
	);
});

test('changing types preserves other filters and removing filters clears duplicates', () => {
	const href = askFilterHref(
		'/asks',
		'q=tools%20%26%20supplies&type=item&type=time&saved=1',
		{ type: 'resource' },
	);
	const url = new URL(href, 'https://givetogive.test');
	assert.equal(url.pathname, '/asks');
	assert.equal(url.searchParams.get('q'), 'tools & supplies');
	assert.equal(url.searchParams.get('saved'), '1');
	assert.deepEqual(url.searchParams.getAll('type'), ['resource']);
	assert.equal(
		askFilterHref('/asks', 'type=item&type=time', { type: undefined }),
		'/asks',
	);
});
