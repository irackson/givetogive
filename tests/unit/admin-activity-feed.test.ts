import assert from 'node:assert/strict';
import test from 'node:test';
import { activityCursor, activityPollingInterval, mergeActivityPage } from '../../src/lib/admin-activity-feed.ts';

test('an initially empty live feed uses cursor zero instead of skipping to newest records', () => {
	assert.equal(activityCursor(undefined, false), undefined);
	assert.equal(activityCursor([], false), 0);
	assert.equal(activityCursor([{ id: 3 }, { id: 9 }], false), 9);
	assert.equal(activityCursor([{ id: 9 }], true), undefined);
});

test('live activity polls promptly but never polls archives or rapidly retries failures', () => {
	assert.equal(activityPollingInterval(false), 1000);
	assert.equal(activityPollingInterval(false, true), 250);
	assert.equal(activityPollingInterval(false, true, true), 1000);
	assert.equal(activityPollingInterval(true, true), false);
});

test('incremental catch-up preserves each page before advancing the cursor', () => {
	let items = [{ id: 1 }];
	const received = new Set([1]);
	for (let page = 0; page < 8; page++) {
		const after = Math.max(...items.map((item) => item.id));
		const fresh = Array.from({ length: 100 }, (__, index) => ({ id: after + index + 1 }));
		fresh.forEach((item) => received.add(item.id));
		items = mergeActivityPage(items, fresh);
		assert.equal(items[0]?.id, after + 100);
		assert.equal(items.length, Math.min(1 + (page + 1) * 100, 500));
	}
	assert.equal(received.size, 801);
	assert.deepEqual(items.map((item) => item.id), Array.from({ length: 500 }, (__, index) => 801 - index));
});

test('activity merge deduplicates retries and prefers fresh details', () => {
	assert.deepEqual(mergeActivityPage([{ id: 2, detail: 'old' }, { id: 1, detail: 'one' }],
		[{ id: 3, detail: 'three' }, { id: 2, detail: 'fresh' }]),
		[{ id: 3, detail: 'three' }, { id: 2, detail: 'fresh' }, { id: 1, detail: 'one' }]);
});
