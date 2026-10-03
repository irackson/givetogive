import test from 'node:test';
import assert from 'node:assert/strict';
import {
	entityHref,
	simulationMetrics,
	simulationRunnerOnline,
} from '../../src/lib/simulation-presentation.ts';

test('online requires a nonterminal run, recent heartbeat and current scripted controller', () => {
	const now = Date.now();
	const run = {
		status: 'running',
		mode: 'scripted',
		settings: { controllerId: 'owned-controller' },
		lastHeartbeatAt: new Date(now - 1000),
	};
	assert.equal(simulationRunnerOnline(run, now), true);
	assert.equal(
		simulationRunnerOnline({ ...run, status: 'paused' }, now),
		true,
	);
	for (const status of [
		'created',
		'stopped',
		'completed',
		'cancelled',
		'failed',
	])
		assert.equal(simulationRunnerOnline({ ...run, status }, now), false);
	for (const settings of [{}, { controllerId: null }])
		assert.equal(simulationRunnerOnline({ ...run, settings }, now), false);
	for (const lastHeartbeatAt of [
		null,
		new Date(now - 15_000),
		new Date(now + 1000),
	])
		assert.equal(
			simulationRunnerOnline({ ...run, lastHeartbeatAt }, now),
			false,
		);
	assert.equal(
		simulationRunnerOnline(
			{ ...run, mode: 'deterministic', settings: {} },
			now,
		),
		true,
	);
});

test('simulation history distinguishes run, runner and agent identities', () => {
	assert.equal(
		entityHref('simulation', 'bot-1', 'run-1'),
		'/admin/simulations/run-1/agents/bot-1',
	);
	assert.equal(
		entityHref('simulation', 'runner', 'run-1'),
		'/admin/simulations/run-1',
	);
	assert.equal(
		entityHref('simulation', 'run-1', 'run-1'),
		'/admin/simulations/run-1',
	);
	assert.equal(
		entityHref('simulation_run', 'run-1'),
		'/admin/simulations/run-1',
	);
	assert.equal(
		entityHref('simulation', 'bot-1'),
		'/admin/activity?entityType=simulation&entityId=bot-1',
	);
	assert.equal(entityHref('simulation', null, 'run-1'), null);
});

test('entity navigation encodes each identity and preserves ordinary detail routes', () => {
	assert.equal(
		entityHref('simulation', 'a/b?c', 'r/s'),
		'/admin/simulations/r%2Fs/agents/a%2Fb%3Fc',
	);
	assert.equal(entityHref('ask', '12'), '/asks/12');
	assert.equal(entityHref('payment', 'a/b'), '/admin/payments/a%2Fb');
	assert.equal(entityHref('member', 'a/b'), '/admin/users/a%2Fb');
});

test('scripted metrics use actual job counts and do not imply every resolved cycle succeeded', () => {
	const metrics = simulationMetrics('scripted');
	assert.deepEqual(
		metrics.map((m) => m.name),
		['cycles', 'apiQueued', 'apiActive', 'actions', 'failures'],
	);
	assert.equal(metrics[0]!.label, 'Resolved action cycles');
	assert.match(metrics[0]!.explanation, /server-rejected/);
	assert.match(metrics[1]!.explanation, /not individual HTTP requests/);
	assert.match(metrics[3]!.explanation, /rejections are excluded/);
	for (const mode of ['deterministic', 'autonomous'])
		assert.deepEqual(
			simulationMetrics(mode).map((m) => m.name),
			['cycles', 'inferenceQueued', 'inferenceActive'],
		);
});
