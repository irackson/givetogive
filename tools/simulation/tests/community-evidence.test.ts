import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	communityContinuity,
	type CommunityActionEvidence,
} from '../src/community-evidence.ts';

const start = Date.parse('2026-10-02T00:00:00Z');
function actions(actor: string, seconds: number[]): CommunityActionEvidence[] {
	return seconds.map((at) => ({
		id: `${actor}-${at}`,
		agentId: actor,
		kind: 'action_result',
		occurredAt: new Date(start + at * 1000).toISOString(),
		data: { outcome: 'success' },
	}));
}
test('an hour starts only after every participant has three successes and stays active throughout', () => {
	const schedule = Array.from({ length: 85 }, (__value, index) => index * 45);
	const events = [
		...actions('script', schedule),
		...actions(
			'browser',
			schedule.map((at) => at + 5),
		),
	];
	const evidence = communityContinuity(
		['script', 'browser'],
		events,
		start + 4000_000,
	);
	assert.equal(
		evidence.warmupCompleteAt,
		new Date(start + 95_000).toISOString(),
	);
	assert.equal(evidence.secondsAfterWarmup, 3685);
	assert.equal(evidence.oneHourContinuousEvidence, true);
	assert.equal(evidence.maximumParticipantActionGapSeconds, 45);
	assert.ok(evidence.minimumSuccessesPerParticipantPerFullWindow >= 6);
	assert.deepEqual(
		communityContinuity(
			['script', 'browser'],
			[...events, events[0]!],
			start + 4000_000,
		),
		evidence,
	);
});
test('a stopped browser or long inactivity cannot hide behind busy scripts and process uptime', () => {
	const scripts = actions(
		'script',
		Array.from({ length: 85 }, (__value, index) => index * 45),
	);
	const dropped = communityContinuity(
		['script', 'browser'],
		[...scripts, ...actions('browser', [0, 45, 90, 135])],
		start + 4000_000,
	);
	assert.equal(dropped.oneHourContinuousEvidence, false);
	assert.equal(dropped.secondsAfterWarmup, 45);
	const inactive = communityContinuity(
		['script', 'browser'],
		[...scripts, ...actions('browser', [0, 45, 90, 3780])],
		start + 4000_000,
	);
	assert.equal(inactive.oneHourContinuousEvidence, false);
	assert.equal(inactive.minimumSuccessesPerParticipantPerFullWindow, 0);
});
test('waiting and duplicate observations do not manufacture warmup; invalid successful evidence is rejected', () => {
	const events = actions('script', [0, 45, 90]);
	const waiting = actions('browser', [0, 45, 90]).map((event) => ({
		...event,
		data: { outcome: 'waiting' },
	}));
	assert.equal(
		communityContinuity(
			['script', 'browser'],
			[...events, ...waiting],
			start + 4000_000,
		).warmupCompleteAt,
		null,
	);
	for (const invalid of [
		actions('unknown', [0]),
		actions('script', [5000]),
		[{ ...events[0]!, agentId: 'browser' }],
	])
		assert.throws(() =>
			communityContinuity(
				['script'],
				[...events, ...invalid],
				start + 4000_000,
			),
		);
	assert.throws(() => communityContinuity(['script', 'script'], events));
});
