import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { applicationEnvironment } from '@/lib/environment';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { paymentAccounts } from '@/server/db/payments-schema';
import {
	operationEvents,
	simulationAgents,
	simulationRuns,
	toolOperations,
} from '@/server/db/operations-schema';
import { recordEvent } from '@/server/observability/events';
import { assertSimulationEnvironment } from '@/server/simulation/guard';
import { clockCreateId } from '@/server/simulation/clock-policy';
import { paymentConfiguration } from './config';
import { stripeClient } from './stripe';
import type { PaymentTransaction } from './ledger';
import {
	clockBindingEventId,
	requestedCustomerClock,
	resolveEntitlementTime,
	verifiedClockTime,
	verifyClockBindingContext,
	verifyPersistedClockBinding,
	type EntitlementEvidence,
	type EntitlementTime,
	type EntitlementClockTarget,
	type VerifiedClockBinding,
} from './entitlement-time-policy';

export type { EntitlementTime } from './entitlement-time-policy';

async function clockTarget() {
	const target = await assertSimulationEnvironment();
	const config = paymentConfiguration();
	if (config.environment !== 'staging' || config.origin !== target.origin)
		throw new Error('Clock environment mismatch.');
	return {
		...target,
		configured: config.configured,
		livemode: config.livemode,
	};
}

async function loadEvidence(
	actorId: string,
	executor: Pick<typeof db, 'query' | 'select'> = db,
): Promise<EntitlementEvidence> {
	const [subject, bindings, memberships, account] = await Promise.all([
		executor.query.users.findFirst({
			where: eq(users.id, actorId),
			columns: { id: true, isSynthetic: true },
		}),
		executor.query.operationEvents.findMany({
			where: and(
				eq(operationEvents.actorId, actorId),
				eq(operationEvents.action, 'simulation_clock_bind'),
			),
			limit: 3,
		}),
		executor.query.simulationAgents.findMany({
			where: eq(simulationAgents.userId, actorId),
			limit: 5,
		}),
		executor.query.paymentAccounts.findFirst({
			where: and(
				eq(paymentAccounts.userId, actorId),
				eq(paymentAccounts.livemode, false),
			),
			columns: { stripeAccountId: true, livemode: true },
		}),
	]);
	if (memberships.length === 5)
		throw new Error('Ambiguous clock membership.');
	const cohorts = await Promise.all(
		memberships.map(async (member) => {
			const run = await executor.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, member.runId),
			});
			if (!run) throw new Error('Clock cohort is missing.');
			const [provision, creation, population] = await Promise.all([
				executor.query.operationEvents.findFirst({
					where: eq(
						operationEvents.externalId,
						`clock-provision:${run.id}`,
					),
				}),
				executor.query.toolOperations.findFirst({
					where: and(
						eq(toolOperations.actorId, run.createdById),
						eq(toolOperations.correlationId, clockCreateId(run.id)),
					),
				}),
				executor
					.select({ count: sql<number>`count(*)::int` })
					.from(simulationAgents)
					.where(eq(simulationAgents.runId, run.id)),
			]);
			return {
				...run,
				memberUserId: member.userId,
				memberCount: population[0]?.count ?? 0,
				provision: provision ?? null,
				creation: creation ?? null,
			};
		}),
	);
	return {
		subject: subject ?? null,
		bindings,
		cohorts,
		account: account ?? null,
	};
}

/** Server-owned source of time; call outside DB transactions. No persistent clock cache. */
export async function entitlementTime(
	actorId: string,
): Promise<EntitlementTime> {
	return resolveEntitlementTime(actorId, {
		environment: applicationEnvironment(),
		wallTime: () => new Date(),
		loadEvidence,
		verifyEnvironment: clockTarget,
		retrieveAccount: async (id) => {
			const account = await stripeClient().v2.core.accounts.retrieve(
				id,
				{ include: ['configuration.customer'] },
				{ timeout: 5000, maxNetworkRetries: 0 },
			);
			return {
				id: account.id,
				livemode: account.livemode,
				clockId: account.configuration?.customer?.test_clock ?? null,
			};
		},
		retrieveClock: (id) =>
			stripeClient().testHelpers.testClocks.retrieve(
				id,
				{},
				{ timeout: 5000, maxNetworkRetries: 0 },
			),
	});
}

/** Used only before creating/verifying a synthetic customer; never creates provider objects. */
export async function verifyEntitlementClockRequest(
	actorId: string,
	requested?: { runId: string; clockId: string },
) {
	if (applicationEnvironment() === 'production') {
		if (requested)
			throw new Error('Sandbox clocks are unavailable in production.');
		return null;
	}
	const evidence = await loadEvidence(actorId);
	const selected = requestedCustomerClock(evidence, requested);
	if (!selected) return null;
	const target = await clockTarget();
	const binding = verifyClockBindingContext(
		actorId,
		evidence,
		target,
		selected,
		false,
	);
	// Only an explicit operator binding request may upgrade a legacy marker.
	if (!requested) verifyPersistedClockBinding(evidence, binding);
	const clock = await stripeClient().testHelpers.testClocks.retrieve(
		binding.clockId,
		{},
		{ timeout: 5000, maxNetworkRetries: 0 },
	);
	if (verifiedClockTime(clock, binding).status !== 'ready')
		throw new Error('The named sandbox clock is not ready.');
	return binding;
}

/** Admission-only guard: retired clock cohorts may read history but start no mutations.
 * This resolves a permanent binding itself; callers must never supply clock/run IDs.
 * Existing ambiguous operations can continue through their separately fenced recovery.
 */
export async function assertEntitlementMutationAllowed(
	actorId: string,
): Promise<void> {
	try {
		await verifyEntitlementClockRequest(actorId);
	} catch {
		// Never surface provider details or confuse a failed clock check with wall time.
		throw new Error(
			'Billing changes are unavailable for this sandbox clock member.',
		);
	}
}

/** No network here. Caller persists the account row and this append-only binding together. */
export async function persistEntitlementClockBinding(
	tx: PaymentTransaction,
	binding: VerifiedClockBinding,
	accountId: string,
) {
	// Serialize retirement and competing bindings, then repeat local ownership checks.
	// All provider reads have already completed outside this transaction.
	await tx
		.select({ id: simulationRuns.id })
		.from(simulationRuns)
		.where(eq(simulationRuns.id, binding.runId))
		.for('update');
	const [user] = await tx
		.select({
			id: users.id,
			frozenAt: users.frozenAt,
			emailVerified: users.emailVerified,
		})
		.from(users)
		.where(eq(users.id, binding.actorId))
		.for('update');
	if (!user?.emailVerified || user.frozenAt)
		throw new Error('Clock member is inactive.');
	const config = paymentConfiguration();
	if (config.environment !== 'staging')
		throw new Error('Clock environment mismatch.');
	const target: EntitlementClockTarget = {
		origin: config.origin,
		databaseIdentity: binding.databaseIdentity,
		stripeMode: config.livemode ? 'live' : 'test',
		configured: config.configured,
		livemode: config.livemode,
	};
	const evidence = await loadEvidence(binding.actorId, tx);
	const checked = verifyClockBindingContext(
		binding.actorId,
		evidence,
		target,
		binding,
		false,
	);
	if (
		checked.initialFrozenTime !== binding.initialFrozenTime ||
		evidence.account?.stripeAccountId !== accountId ||
		evidence.account.livemode
	)
		throw new Error('Clock binding ownership changed.');
	await recordEvent(
		{
			externalId: clockBindingEventId(binding.actorId),
			actorId: binding.actorId,
			entityType: 'simulation_clock',
			entityId: binding.clockId,
			runId: binding.runId,
			action: 'simulation_clock_bind',
			outcome: 'completed',
			summary:
				'Synthetic customer permanently bound to its provider-verified sandbox clock.',
			details: {
				version: 1,
				accountId,
				databaseIdentity: binding.databaseIdentity,
				initialFrozenTime: binding.initialFrozenTime,
				livemode: false,
			},
		},
		tx,
	);
	const bindings = await tx
		.select()
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.actorId, binding.actorId),
				eq(operationEvents.action, 'simulation_clock_bind'),
			),
		)
		.limit(3);
	verifyPersistedClockBinding(
		{
			subject: null,
			bindings,
			cohorts: [],
			account: { stripeAccountId: accountId, livemode: false },
		},
		binding,
	);
}
