import { createHash } from 'node:crypto';
import { z } from 'zod';
import { clockCreateId } from '../simulation/clock-policy.ts';
import { simulationCheckoutOrigin } from './simulation-checkout-policy.ts';

export type EntitlementTime =
	| { status: 'ready'; asOf: Date; source: 'wall' | 'stripe_clock' }
	| { status: 'pending'; reason: string };

export type ClockAuditEvidence = {
	externalId: string | null;
	environment: string;
	actorId: string | null;
	entityType: string;
	entityId: string | null;
	action: string;
	outcome: string;
	runId: string | null;
	details: Record<string, unknown>;
};

export type ClockCohortEvidence = {
	id: string;
	createdById: string;
	memberUserId: string;
	agentCount: number;
	memberCount: number;
	mode: string;
	status: string;
	environment: string;
	databaseIdentity: string;
	provision: ClockAuditEvidence | null;
	creation: {
		actorId: string;
		correlationId: string;
		tool: string;
		status: string;
		result: Record<string, unknown> | null;
	} | null;
};

export type EntitlementEvidence = {
	subject: { id: string; isSynthetic: boolean } | null;
	bindings: ClockAuditEvidence[];
	cohorts: ClockCohortEvidence[];
	account: { stripeAccountId: string; livemode: boolean } | null;
};

export type EntitlementClockTarget = {
	origin: string;
	databaseIdentity: string;
	stripeMode: string;
	configured: boolean;
	livemode: boolean;
};

const unixSeconds = z.number().int().positive().max(8_640_000_000_000);
const bindingDetails = z.object({
	version: z.literal(1),
	accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
	databaseIdentity: z.string().min(8).max(128),
	initialFrozenTime: unixSeconds,
	livemode: z.literal(false),
});

export type VerifiedClockBinding = {
	actorId: string;
	runId: string;
	clockId: string;
	databaseIdentity: string;
	initialFrozenTime: number;
};

export function clockBindingEventId(actorId: string) {
	// Global per actor, not per run: a second cohort cannot silently replace it.
	return `entitlement-clock:${createHash('sha256').update(actorId).digest('hex')}`;
}

function validBindingMarker(
	event: ClockAuditEvidence,
	binding: Pick<VerifiedClockBinding, 'actorId' | 'runId' | 'clockId'>,
) {
	return (
		(event.externalId === clockBindingEventId(binding.actorId) ||
			event.externalId ===
				`clock-binding:${binding.runId}:${binding.actorId}`) &&
		event.actorId === binding.actorId &&
		event.environment === 'staging' &&
		event.entityType === 'simulation_clock' &&
		event.action === 'simulation_clock_bind' &&
		event.outcome === 'completed' &&
		event.runId === binding.runId &&
		event.entityId === binding.clockId
	);
}

/** Local durable evidence grants permission to inspect ONE provider clock, never a time. */
export function verifyClockBindingContext(
	actorId: string,
	evidence: EntitlementEvidence,
	target: EntitlementClockTarget,
	requested: { runId: string; clockId: string },
	allowRetired: boolean,
): VerifiedClockBinding {
	if (
		evidence.subject?.id !== actorId ||
		!evidence.subject.isSynthetic ||
		target.origin !== simulationCheckoutOrigin ||
		target.stripeMode !== 'test' ||
		!target.configured ||
		target.livemode ||
		!target.databaseIdentity ||
		!/^[A-Za-z0-9_-]{1,64}$/.test(requested.runId) ||
		!/^clock_[A-Za-z0-9]+$/.test(requested.clockId)
	)
		throw new Error('clock_environment_unverified');
	const binding = { actorId, ...requested };
	if (
		evidence.bindings.length > 2 ||
		evidence.bindings.some((event) => !validBindingMarker(event, binding))
	)
		throw new Error('clock_binding_conflict');
	const matching = evidence.cohorts.filter(
		(run) => run.id === requested.runId,
	);
	const run = matching[0];
	const states =
		allowRetired ?
			[
				'created',
				'running',
				'paused',
				'completed',
				'stopped',
				'failed',
				'cancelled',
			]
		:	['created', 'running', 'paused'];
	if (
		matching.length !== 1 ||
		!run ||
		run.memberUserId !== actorId ||
		run.mode !== 'deterministic' ||
		run.environment !== 'staging' ||
		run.databaseIdentity !== target.databaseIdentity ||
		!states.includes(run.status) ||
		!Number.isInteger(run.agentCount) ||
		run.agentCount < 1 ||
		run.agentCount > 3 ||
		run.memberCount !== run.agentCount
	)
		throw new Error('clock_cohort_unverified');
	const provision = run.provision;
	if (
		!provision ||
		provision.externalId !== `clock-provision:${run.id}` ||
		provision.actorId !== run.createdById ||
		provision.environment !== 'staging' ||
		provision.entityType !== 'simulation_run' ||
		provision.entityId !== run.id ||
		provision.runId !== run.id ||
		provision.action !== 'simulation_clock_scope_provisioned' ||
		provision.outcome !== 'completed'
	)
		throw new Error('clock_provision_unverified');
	const creation = run.creation;
	const initial = unixSeconds.safeParse(
		creation?.result?.['initialFrozenTime'],
	);
	if (
		creation?.actorId !== run.createdById ||
		creation.correlationId !== clockCreateId(run.id) ||
		creation.tool !== 'simulation_clock_create' ||
		creation.status !== 'completed' ||
		creation.result?.['runId'] !== run.id ||
		creation.result['clockId'] !== requested.clockId ||
		creation.result['livemode'] !== false ||
		!initial.success
	)
		throw new Error('clock_creation_unverified');
	return {
		...binding,
		databaseIdentity: target.databaseIdentity,
		initialFrozenTime: initial.data,
	};
}

/** Existing legacy markers are sticky but cannot grant time without a full binding. */
export function verifyPersistedClockBinding(
	evidence: EntitlementEvidence,
	binding: VerifiedClockBinding,
) {
	const canonical = evidence.bindings.filter(
		(event) => event.externalId === clockBindingEventId(binding.actorId),
	);
	const details = bindingDetails.safeParse(canonical[0]?.details);
	if (
		evidence.bindings.length > 2 ||
		evidence.bindings.some(
			(event) => !validBindingMarker(event, binding),
		) ||
		canonical.length !== 1 ||
		!details.success ||
		details.data.databaseIdentity !== binding.databaseIdentity ||
		details.data.initialFrozenTime !== binding.initialFrozenTime ||
		evidence.account?.stripeAccountId !== details.data.accountId ||
		evidence.account.livemode
	)
		throw new Error('clock_binding_unverified');
	return details.data.accountId;
}

export function hasEntitlementClockEvidence(evidence: EntitlementEvidence) {
	return (
		evidence.bindings.length > 0 ||
		evidence.cohorts.some(
			(run) => run.provision !== null || run.creation !== null,
		)
	);
}

/** Ordinary customer calls cannot bypass a provisioned cohort's clock binding. */
export function requestedCustomerClock(
	evidence: EntitlementEvidence,
	requested?: { runId: string; clockId: string },
) {
	if (requested) return requested;
	if (!hasEntitlementClockEvidence(evidence)) return null;
	const marker = evidence.bindings.find(
		(event) =>
			event.externalId ===
			clockBindingEventId(evidence.subject?.id ?? ''),
	);
	if (!marker?.runId || !marker.entityId)
		throw new Error('clock_binding_required');
	return { runId: marker.runId, clockId: marker.entityId };
}

export type ProviderClockReading = {
	id: string;
	name: string | null;
	livemode: boolean;
	status: string;
	frozen_time: number;
};

export function verifiedClockTime(
	clock: ProviderClockReading,
	binding: VerifiedClockBinding,
): EntitlementTime {
	if (
		clock.id !== binding.clockId ||
		clock.name !== `givetogive:${binding.runId}` ||
		clock.livemode ||
		!Number.isSafeInteger(clock.frozen_time) ||
		clock.frozen_time < binding.initialFrozenTime ||
		clock.frozen_time > binding.initialFrozenTime + 366 * 86400 ||
		!Number.isFinite(new Date(clock.frozen_time * 1000).getTime())
	)
		return { status: 'pending', reason: 'clock_provider_unverified' };
	if (clock.status !== 'ready')
		return {
			status: 'pending',
			reason:
				clock.status === 'advancing' ?
					'clock_advancing'
				:	'clock_provider_unavailable',
		};
	return {
		status: 'ready',
		asOf: new Date(clock.frozen_time * 1000),
		source: 'stripe_clock',
	};
}

export type EntitlementTimeDependencies = {
	environment: string;
	wallTime(): Date;
	loadEvidence(actorId: string): Promise<EntitlementEvidence>;
	verifyEnvironment(): Promise<EntitlementClockTarget>;
	retrieveAccount(id: string): Promise<{
		id: string;
		livemode: boolean;
		clockId: string | null;
	}>;
	retrieveClock(id: string): Promise<ProviderClockReading>;
};

/** Injectable policy is tested without credentials; production adapter has no caller overrides. */
export async function resolveEntitlementTime(
	actorId: string,
	dependencies: EntitlementTimeDependencies,
): Promise<EntitlementTime> {
	const wall = (): EntitlementTime => ({
		status: 'ready',
		asOf: dependencies.wallTime(),
		source: 'wall',
	});
	if (dependencies.environment === 'production') return wall();
	try {
		const evidence = await dependencies.loadEvidence(actorId);
		if (evidence.subject?.id !== actorId)
			return { status: 'pending', reason: 'clock_subject_unverified' };
		if (!hasEntitlementClockEvidence(evidence)) return wall();
		if (dependencies.environment !== 'staging')
			return {
				status: 'pending',
				reason: 'clock_environment_unverified',
			};
		// A provisioned/unbound, malformed or retired binding never falls back to wall time.
		const marker = evidence.bindings[0];
		if (!marker?.runId || !marker.entityId)
			return { status: 'pending', reason: 'clock_binding_unverified' };
		const target = await dependencies.verifyEnvironment();
		const binding = verifyClockBindingContext(
			actorId,
			evidence,
			target,
			{ runId: marker.runId, clockId: marker.entityId },
			true,
		);
		const accountId = verifyPersistedClockBinding(evidence, binding);
		const [account, clock] = await Promise.all([
			dependencies.retrieveAccount(accountId),
			dependencies.retrieveClock(binding.clockId),
		]);
		if (
			account.id !== accountId ||
			account.livemode ||
			account.clockId !== binding.clockId
		)
			return { status: 'pending', reason: 'clock_account_unverified' };
		return verifiedClockTime(clock, binding);
	} catch {
		// Never return provider errors, IDs, secrets or runner assertions to renderers.
		return { status: 'pending', reason: 'clock_verification_pending' };
	}
}
