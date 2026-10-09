import test from 'node:test';
import assert from 'node:assert/strict';
import {
	SIMULATION_MEMBER_PAGE_SIZE,
	simulationMemberPage,
} from '../../src/lib/simulation-member-page.ts';

const agents = Array.from({ length: 253 }, (__unused, index) => ({
	id: `member-${index.toString().padStart(3, '0')}`,
	name: `Neighbor ${index.toString().padStart(3, '0')}`,
	tier: index % 2 ? 'supporter' : 'neighbor',
	state: index % 3 ? 'idle' : 'acting',
	cycles: index,
}));

test('253-member rendering is bounded while every member remains reachable exactly once', () => {
	const original = structuredClone(agents);
	const first = simulationMemberPage(agents);
	assert.equal(first.total, 253);
	assert.equal(first.pages, 11);
	assert.equal(first.items.length, SIMULATION_MEMBER_PAGE_SIZE);
	const ids = Array.from({ length: first.pages }, (__unused, page) =>
		simulationMemberPage(agents, { page }).items.map((agent) => agent.id),
	).flat();
	assert.equal(ids.length, 253);
	assert.equal(new Set(ids).size, 253);
	assert.deepEqual(agents, original);
	const last = simulationMemberPage(agents, { page: 10 });
	assert.equal(last.start, 241);
	assert.equal(last.end, 253);
});

test('search is case-insensitive literal name/ID matching composed with cohort and state filters', () => {
	assert.equal(
		simulationMemberPage(agents, { search: '  MEMBER-007  ' }).items[0]?.id,
		'member-007',
	);
	assert.equal(
		simulationMemberPage(agents, {
			search: 'Neighbor 007',
			tier: 'supporter',
			state: 'idle',
		}).total,
		1,
	);
	assert.equal(
		simulationMemberPage(agents, {
			search: 'Neighbor 007',
			tier: 'neighbor',
		}).total,
		0,
	);
	assert.equal(simulationMemberPage(agents, { search: '[.*]' }).total, 0);
});

test('empty, shrinking and invalid page requests cannot produce a blank out-of-range page', () => {
	assert.deepEqual(simulationMemberPage([]), {
		items: [],
		total: 0,
		page: 0,
		pages: 0,
		start: 0,
		end: 0,
	});
	for (const page of [NaN, Infinity, -1, 1.5])
		assert.equal(simulationMemberPage(agents, { page }).page, 0);
	assert.equal(
		simulationMemberPage(agents.slice(0, 3), { page: 100 }).items.length,
		3,
	);
	assert.equal(simulationMemberPage(agents, { page: 100 }).page, 10);
});

test('duplicate names use stable IDs and action updates do not reorder membership pages', () => {
	const sameName = agents
		.map((agent) => ({ ...agent, name: 'Same name' }))
		.reverse();
	const before = simulationMemberPage(sameName);
	const after = simulationMemberPage(
		sameName.map((agent) => ({
			...agent,
			cycles: 999,
			lastAction: 'updated',
		})),
	);
	assert.deepEqual(
		before.items.map((agent) => agent.id),
		after.items.map((agent) => agent.id),
	);
	assert.equal(before.items[0]?.id, 'member-000');
});
