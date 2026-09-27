import assert from 'node:assert/strict';
import test from 'node:test';
import { clockCreateId } from '../../src/server/simulation/clock-policy.ts';
import {
	clockBindingEventId,
	requestedCustomerClock,
	resolveEntitlementTime,
	verifyClockBindingContext,
	verifyPersistedClockBinding,
	type ClockAuditEvidence,
	type EntitlementEvidence,
	type EntitlementClockTarget,
	type EntitlementTimeDependencies,
	type ProviderClockReading,
} from '../../src/server/payments/entitlement-time-policy.ts';

const actorId = 'synthetic-clock-member';
const runId = 'tiny-clock-cohort';
const clockId = 'clock_fixture';
const accountId = 'acct_fixture';
const initial = 1_790_000_000;
const wallTime = new Date('2026-09-27T00:00:00Z');

function fixture() {
	const target: EntitlementClockTarget = {
		origin: 'https://givetogive-staging.vercel.app',
		databaseIdentity: 'test-clock-database',
		stripeMode: 'test',
		configured: true,
		livemode: false,
	};
	const binding: ClockAuditEvidence = {
		externalId: clockBindingEventId(actorId),
		environment: 'staging',
		actorId,
		entityType: 'simulation_clock',
		entityId: clockId,
		action: 'simulation_clock_bind',
		outcome: 'completed',
		runId,
		details: {
			version: 1,
			accountId,
			databaseIdentity: target.databaseIdentity,
			initialFrozenTime: initial,
			livemode: false,
		},
	};
	const evidence: EntitlementEvidence = {
		subject: { id: actorId, isSynthetic: true },
		bindings: [binding],
		account: { stripeAccountId: accountId, livemode: false },
		cohorts: [
			{
				id: runId,
				createdById: 'operator',
				memberUserId: actorId,
				agentCount: 2,
				memberCount: 2,
				mode: 'deterministic',
				status: 'running',
				environment: 'staging',
				databaseIdentity: target.databaseIdentity,
				provision: {
					externalId: `clock-provision:${runId}`,
					actorId: 'operator',
					environment: 'staging',
					entityType: 'simulation_run',
					entityId: runId,
					runId,
					action: 'simulation_clock_scope_provisioned',
					outcome: 'completed',
					details: { population: 2 },
				},
				creation: {
					actorId: 'operator',
					correlationId: clockCreateId(runId),
					tool: 'simulation_clock_create',
					status: 'completed',
					result: {
						runId,
						clockId,
						initialFrozenTime: initial,
						livemode: false,
					},
				},
			},
		],
	};
	const clock: ProviderClockReading = {
		id: clockId,
		name: `givetogive:${runId}`,
		livemode: false,
		status: 'ready',
		frozen_time: initial + 86400,
	};
	const account = { id: accountId, livemode: false, clockId };
	const calls: string[] = [];
	const dependencies: EntitlementTimeDependencies = {
		environment: 'staging',
		wallTime: () => {
			calls.push('wall');
			return wallTime;
		},
		loadEvidence: async (id) => {
			assert.equal(id, actorId);
			calls.push('evidence');
			return evidence;
		},
		verifyEnvironment: async () => {
			calls.push('environment');
			return target;
		},
		retrieveAccount: async (id) => {
			assert.equal(id, accountId);
			calls.push('account');
			return account;
		},
		retrieveClock: async (id) => {
			assert.equal(id, clockId);
			calls.push('clock');
			return clock;
		},
	};
	return { target, evidence, binding, clock, account, calls, dependencies };
}

test('production always uses wall time and never reads simulation state or Stripe', async () => {
	const { dependencies, calls } = fixture();
	dependencies.environment = 'production';
	assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
		status: 'ready',
		asOf: wallTime,
		source: 'wall',
	});
	assert.deepEqual(calls, ['wall']);
});

test('ordinary members and the unclocked 100-agent cohort use wall time', async () => {
	for (const synthetic of [false, true]) {
		const { dependencies, evidence, calls } = fixture();
		evidence.subject!.isSynthetic = synthetic;
		evidence.bindings = [];
		evidence.cohorts[0]!.agentCount = 100;
		evidence.cohorts[0]!.provision = null;
		evidence.cohorts[0]!.creation = null;
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'ready',
			asOf: wallTime,
			source: 'wall',
		});
		assert.deepEqual(calls, ['evidence', 'wall']);
		assert.equal(requestedCustomerClock(evidence), null);
	}
});

test('the exact named provider clock controls time, never cached or runner-reported timestamps', async () => {
	const { dependencies, evidence, clock, calls } = fixture();
	// These cached values must not become authoritative time.
	evidence.cohorts[0]!.creation!.result!['frozenTime'] =
		initial + 200 * 86400;
	evidence.bindings[0]!.details['frozenTime'] = initial + 100 * 86400;
	assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
		status: 'ready',
		asOf: new Date(clock.frozen_time * 1000),
		source: 'stripe_clock',
	});
	clock.frozen_time += 86400;
	assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
		status: 'ready',
		asOf: new Date(clock.frozen_time * 1000),
		source: 'stripe_clock',
	});
	assert.equal(calls.filter((value) => value === 'clock').length, 2);
	assert.equal(calls.includes('wall'), false);
});

test('advancing or unavailable clocks remain pending with no wall-time fallback', async () => {
	for (const status of ['advancing', 'internal_failure', 'deleted']) {
		const { dependencies, clock, calls } = fixture();
		clock.status = status;
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason:
				status === 'advancing' ? 'clock_advancing' : (
					'clock_provider_unavailable'
				),
		});
		assert.equal(calls.includes('wall'), false);
	}
});

test('provider failures are sanitized and cannot grant time', async () => {
	for (const step of [
		'loadEvidence',
		'verifyEnvironment',
		'retrieveAccount',
		'retrieveClock',
	] as const) {
		const { dependencies, calls } = fixture();
		dependencies[step] = async () => {
			throw new Error('raw private provider response must never escape');
		};
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason: 'clock_verification_pending',
		});
		assert.equal(calls.includes('wall'), false);
	}
});

test('clock identity, mode, name and bounded frozen time are independently verified', async () => {
	for (const patch of [
		{ id: 'clock_other' },
		{ name: `givetogive:other-run` },
		{ livemode: true },
		{ frozen_time: initial - 1 },
		{ frozen_time: initial + 367 * 86400 },
		{ frozen_time: Infinity },
		{ frozen_time: initial + 0.5 },
	]) {
		const { dependencies, clock, calls } = fixture();
		Object.assign(clock, patch);
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason: 'clock_provider_unverified',
		});
		assert.equal(calls.includes('wall'), false);
	}
});

test('provider account must match the immutable local account and clock in test mode', async () => {
	for (const patch of [
		{ id: 'acct_other' },
		{ clockId: 'clock_other' },
		{ livemode: true },
	]) {
		const { dependencies, account, calls } = fixture();
		Object.assign(account, patch);
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason: 'clock_account_unverified',
		});
		assert.equal(calls.includes('wall'), false);
	}
});

test('origin, environment, mode, configuration and database mismatches fail before provider reads', async () => {
	for (const patch of [
		{ origin: 'https://givetogive.vercel.app' },
		{ origin: 'https://foreign.invalid' },
		{ stripeMode: 'live' },
		{ configured: false },
		{ livemode: true },
		{ databaseIdentity: 'different-database' },
	]) {
		const { dependencies, target, calls } = fixture();
		Object.assign(target, patch);
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.deepEqual(calls, ['evidence', 'environment']);
	}
	for (const environment of ['test', 'development']) {
		const { dependencies, calls } = fixture();
		dependencies.environment = environment;
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason: 'clock_environment_unverified',
		});
		assert.deepEqual(calls, ['evidence']);
	}
});

test('only an exact tiny deterministic synthetic cohort is eligible', async () => {
	for (const patch of [
		{ agentCount: 100 },
		{ agentCount: 0 },
		{ agentCount: 1.5 },
		{ memberCount: 3 },
		{ mode: 'autonomous' },
		{ memberUserId: 'other' },
		{ environment: 'production' },
		{ databaseIdentity: 'other' },
		{ status: 'unknown' },
	]) {
		const { dependencies, evidence, calls } = fixture();
		Object.assign(evidence.cohorts[0]!, patch);
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.equal(calls.includes('clock'), false);
		assert.equal(calls.includes('wall'), false);
	}
	const { dependencies, evidence, calls } = fixture();
	evidence.subject!.isSynthetic = false;
	assert.equal(
		(await resolveEntitlementTime(actorId, dependencies)).status,
		'pending',
	);
	assert.equal(calls.includes('clock'), false);
});

test('missing subject, duplicate memberships and deleted membership cannot inherit a clock', async () => {
	for (const variant of ['missing', 'wrong', 'duplicate', 'deleted']) {
		const { dependencies, evidence, calls } = fixture();
		if (variant === 'missing') evidence.subject = null;
		if (variant === 'wrong') evidence.subject!.id = 'other';
		if (variant === 'duplicate')
			evidence.cohorts.push(structuredClone(evidence.cohorts[0]!));
		if (variant === 'deleted') evidence.cohorts = [];
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.equal(calls.includes('clock'), false);
		assert.equal(calls.includes('wall'), false);
	}
});

test('retired cohorts retain read-only clock recognition but reject rebinding and mutations', async () => {
	for (const status of ['completed', 'stopped', 'failed', 'cancelled']) {
		const { dependencies, evidence, target } = fixture();
		evidence.cohorts[0]!.status = status;
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'ready',
		);
		assert.throws(
			() =>
				verifyClockBindingContext(
					actorId,
					evidence,
					target,
					{ runId, clockId },
					false,
				),
			/clock_cohort_unverified/,
		);
	}
});

test('provision or create evidence without the immutable binding stays pending until explicit binding', async () => {
	for (const provisioned of [true, false]) {
		const { dependencies, evidence, calls } = fixture();
		evidence.bindings = [];
		if (provisioned) evidence.cohorts[0]!.creation = null;
		else evidence.cohorts[0]!.provision = null;
		assert.deepEqual(await resolveEntitlementTime(actorId, dependencies), {
			status: 'pending',
			reason: 'clock_binding_unverified',
		});
		assert.throws(
			() => requestedCustomerClock(evidence),
			/clock_binding_required/,
		);
		assert.equal(calls.includes('wall'), false);
	}
});

test('legacy marker alone is sticky but insufficient, and a verified canonical upgrade is accepted', async () => {
	const { dependencies, evidence, binding, calls } = fixture();
	evidence.bindings = [
		{
			...binding,
			externalId: `clock-binding:${runId}:${actorId}`,
			details: {},
		},
	];
	assert.equal(
		(await resolveEntitlementTime(actorId, dependencies)).status,
		'pending',
	);
	assert.throws(
		() => requestedCustomerClock(evidence),
		/clock_binding_required/,
	);
	assert.deepEqual(requestedCustomerClock(evidence, { runId, clockId }), {
		runId,
		clockId,
	});
	assert.equal(calls.includes('clock'), false);
	evidence.bindings.push(binding);
	assert.equal(
		(await resolveEntitlementTime(actorId, dependencies)).status,
		'ready',
	);
	assert.deepEqual(requestedCustomerClock(evidence), { runId, clockId });
});

test('canonical binding rejects another account, database, epoch, mode, context or missing details', async () => {
	for (const patch of [
		{ accountId: 'acct_other' },
		{ databaseIdentity: 'other' },
		{ initialFrozenTime: initial + 1 },
		{ livemode: true },
		{ version: 2 },
		{ accountId: null },
	]) {
		const { dependencies, binding, calls } = fixture();
		Object.assign(binding.details, patch);
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.equal(calls.includes('account'), false);
	}
	for (const patch of [
		{ externalId: 'forged' },
		{ actorId: 'other' },
		{ entityType: 'wrong' },
		{ entityId: 'clock_other' },
		{ environment: 'production' },
		{ outcome: 'pending' },
		{ runId: 'other' },
	]) {
		const { dependencies, binding, calls } = fixture();
		Object.assign(binding, patch);
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.equal(calls.includes('clock'), false);
	}
});

test('sticky binding prevents another cohort replacing it and rejects contradictory or excess markers', async () => {
	const { evidence, target, binding } = fixture();
	assert.throws(
		() =>
			verifyClockBindingContext(
				actorId,
				evidence,
				target,
				{ runId: 'other-run', clockId: 'clock_other' },
				false,
			),
		/clock_binding_conflict/,
	);
	evidence.bindings.push({
		...binding,
		externalId: `clock-binding:${runId}:${actorId}`,
		entityId: 'clock_other',
	});
	assert.throws(
		() =>
			verifyClockBindingContext(
				actorId,
				evidence,
				target,
				{ runId, clockId },
				false,
			),
		/clock_binding_conflict/,
	);
	evidence.bindings = [binding, binding, binding];
	assert.throws(
		() =>
			verifyClockBindingContext(
				actorId,
				evidence,
				target,
				{ runId, clockId },
				false,
			),
		/clock_binding_conflict/,
	);
});

test('clock creation and provision must originate from the exact cohort operator and durable action', async () => {
	for (const mutate of [
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.provision = null;
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.provision!.actorId = 'other';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.provision!.action = 'unrelated';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.status = 'pending';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.actorId = 'other';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.correlationId = 'other';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.result!['clockId'] = 'clock_other';
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.result!['livemode'] = true;
		},
		(e: EntitlementEvidence) => {
			e.cohorts[0]!.creation!.result!['initialFrozenTime'] = NaN;
		},
	]) {
		const { dependencies, evidence, calls } = fixture();
		mutate(evidence);
		assert.equal(
			(await resolveEntitlementTime(actorId, dependencies)).status,
			'pending',
		);
		assert.equal(calls.includes('clock'), false);
	}
});

test('immutable marker verification is safe to reuse directly and its ID is bounded for all actor IDs', () => {
	const { evidence, target } = fixture();
	const verified = verifyClockBindingContext(
		actorId,
		evidence,
		target,
		{ runId, clockId },
		false,
	);
	assert.equal(verifyPersistedClockBinding(evidence, verified), accountId);
	evidence.bindings[0]!.environment = 'production';
	assert.throws(
		() => verifyPersistedClockBinding(evidence, verified),
		/clock_binding_unverified/,
	);
	assert.equal(clockBindingEventId('a'.repeat(255)).length, 82);
	assert.notEqual(clockBindingEventId('a'), clockBindingEventId('b'));
	assert.equal(clockBindingEventId('a'), clockBindingEventId('a'));
});
