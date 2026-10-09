import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatAskAmount,
	getAskUnitLabel,
	type AskType,
} from '../../src/lib/asks.ts';
test('non-monetary displayed amounts use singular only for a count of one', () => {
	const cases: Array<[AskType, string, string]> = [
		['time', 'minute', 'minutes'],
		['task', 'task', 'tasks'],
		['item', 'item', 'items'],
		['resource', 'unit', 'units'],
	];
	for (const [type, singular, plural] of cases) {
		assert.equal(formatAskAmount(type, 1), `1 ${singular}`);
		assert.equal(formatAskAmount(type, 0), `0 ${plural}`);
		assert.equal(formatAskAmount(type, 2), `2 ${plural}`);
		assert.equal(formatAskAmount(type, -1), `-1 ${singular}`);
		assert.equal(getAskUnitLabel(type), plural);
	}
});
test('currency names and minor-unit money formatting are not pluralized or reinterpreted', () => {
	assert.equal(getAskUnitLabel('money', 'usd', 1), 'USD');
	assert.equal(formatAskAmount('money', 1), '$0.01');
	assert.equal(formatAskAmount('money', 100), '$1.00');
	assert.equal(formatAskAmount('money', 1500), '$15.00');
});
