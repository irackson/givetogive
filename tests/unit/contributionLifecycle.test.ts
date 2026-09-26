import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	canUpdateContributionStatus,
	getAskStatus,
	isValidContributionAmount,
} from '../../src/lib/contributionLifecycle.ts';

describe('contribution lifecycle', () => {
	it('keeps full pledges in progress until the help is delivered', () => {
		assert.equal(getAskStatus(0, 10), 'not_started');
		assert.equal(getAskStatus(4, 10), 'in_progress');
		assert.equal(getAskStatus(10, 10), 'in_progress');
		assert.equal(getAskStatus(10, 10, 4), 'in_progress');
		assert.equal(getAskStatus(10, 10, 10), 'complete');
		assert.equal(getAskStatus(12, 10, 12), 'complete');
	});

	it('allows contributors to complete or cancel their contribution', () => {
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'pledged',
				nextStatus: 'completed',
				isContributor: true,
				isOwner: false,
			}),
			true,
		);
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'pledged',
				nextStatus: 'cancelled',
				isContributor: true,
				isOwner: false,
			}),
			true,
		);
	});

	it('lets owners complete pledges but not cancel another person’s help', () => {
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'pledged',
				nextStatus: 'completed',
				isContributor: false,
				isOwner: true,
			}),
			true,
		);
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'pledged',
				nextStatus: 'cancelled',
				isContributor: false,
				isOwner: true,
			}),
			false,
		);
	});

	it('keeps cancelled contributions terminal', () => {
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'cancelled',
				nextStatus: 'completed',
				isContributor: true,
				isOwner: true,
			}),
			false,
		);
	});

	it('keeps delivered contributions terminal and permits authorized retries', () => {
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'completed',
				nextStatus: 'cancelled',
				isContributor: true,
				isOwner: false,
			}),
			false,
		);
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'completed',
				nextStatus: 'completed',
				isContributor: false,
				isOwner: true,
			}),
			true,
		);
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'cancelled',
				nextStatus: 'cancelled',
				isContributor: true,
				isOwner: false,
			}),
			true,
		);
		assert.equal(
			canUpdateContributionStatus({
				currentStatus: 'cancelled',
				nextStatus: 'cancelled',
				isContributor: false,
				isOwner: true,
			}),
			false,
		);
	});

	it('denies every status mutation to unrelated members', () => {
		for (const currentStatus of [
			'pledged',
			'completed',
			'cancelled',
		] as const) {
			for (const nextStatus of ['completed', 'cancelled'] as const) {
				assert.equal(
					canUpdateContributionStatus({
						currentStatus,
						nextStatus,
						isContributor: false,
						isOwner: false,
					}),
					false,
				);
			}
		}
	});

	it('reopens an Ask when a pledge is cancelled or its goal is increased', () => {
		assert.equal(getAskStatus(0, 10, 0), 'not_started');
		assert.equal(getAskStatus(8, 10, 8), 'in_progress');
		assert.equal(getAskStatus(10, 12, 10), 'in_progress');
	});

	it('rejects fractional non-money quantities and precision loss for money', () => {
		for (const type of ['time', 'task', 'item', 'resource']) {
			assert.equal(isValidContributionAmount(type, 1), true);
			assert.equal(isValidContributionAmount(type, 1.5), false);
		}
		assert.equal(isValidContributionAmount('money', 0.01), true);
		assert.equal(isValidContributionAmount('money', 29.99), true);
		assert.equal(isValidContributionAmount('money', 0.001), false);
		assert.equal(isValidContributionAmount('money', 1.005), false);
		for (const invalid of [0, -1, NaN, Infinity, 1_000_001]) {
			assert.equal(isValidContributionAmount('money', invalid), false);
		}
	});
});
