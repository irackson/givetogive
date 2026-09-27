import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
	simulationCheckoutOrigin,
	verifySandboxCheckoutSession,
	verifySandboxPaymentIntent,
} from '../../src/server/payments/simulation-checkout-policy.ts';
import {
	assertClockAdvance,
	assertClockCohort,
	clockCommandSchema,
	clockCreateId,
	verifyNamedClock,
} from '../../src/server/simulation/clock-policy.ts';

function fixture() {
	const binding = {
		operationId: randomUUID(),
		checkoutId: 'cs_test_fixture',
		customerAccountId: 'acct_fixture',
		grossAmount: 500,
		recurring: false,
	};
	const session = {
		id: binding.checkoutId,
		livemode: false,
		customer_account: binding.customerAccountId,
		client_reference_id: binding.operationId,
		amount_total: 500,
		currency: 'usd',
		mode: 'payment' as const,
		status: 'open' as const,
		payment_status: 'unpaid' as const,
		expires_at: Math.floor(Date.now() / 1000) + 300,
		url: `https://checkout.stripe.com/c/pay/${binding.checkoutId}#opaque`,
		success_url: `${simulationCheckoutOrigin}/giving/${binding.operationId}?checkout=returned`,
		cancel_url: `${simulationCheckoutOrigin}/giving/${binding.operationId}?checkout=canceled`,
	};
	return { session, binding };
}
test('server sandbox attestation rejects live mode, foreign actor/session/operation, monetary drift and external returns', () => {
	const { session, binding } = fixture();
	verifySandboxCheckoutSession(session, binding, true);
	for (const patch of [
		{ livemode: true },
		{ customer_account: 'acct_other' },
		{ client_reference_id: randomUUID() },
		{ id: 'cs_test_other' },
		{ amount_total: 501 },
		{ currency: 'eur' },
		{ mode: 'subscription' as const },
		{ cancel_url: 'https://example.com' },
		{ success_url: `${simulationCheckoutOrigin}/admin` },
		{
			url: `https://checkout.stripe.com.evil.example/c/pay/${binding.checkoutId}`,
		},
		{ status: 'complete' as const },
		{ payment_status: 'paid' as const },
		{ expires_at: 1 },
		{ url: null },
	])
		assert.throws(() =>
			verifySandboxCheckoutSession(
				{ ...session, ...patch },
				binding,
				true,
			),
		);
	assert.doesNotThrow(() =>
		verifySandboxCheckoutSession(
			{
				...session,
				status: 'complete',
				payment_status: 'paid',
				url: null,
			},
			binding,
			false,
		),
	);
});
test('server outcome verification also binds the actual PaymentIntent to owner, mode, amount and currency', () => {
	const { binding } = fixture();
	const intent = {
		livemode: false,
		customer_account: binding.customerAccountId,
		amount: 500,
		currency: 'usd',
	};
	verifySandboxPaymentIntent(intent, binding);
	for (const patch of [
		{ livemode: true },
		{ customer_account: 'acct_other' },
		{ amount: 499 },
		{ currency: 'eur' },
	])
		assert.throws(() =>
			verifySandboxPaymentIntent({ ...intent, ...patch }, binding),
		);
});
test('clock controls reject large or terminal runs, forged clock ownership, backwards and unbounded jumps', () => {
	assertClockCohort({ id: 'tiny-cohort', agentCount: 3, status: 'created' });
	for (const patch of [
		{ agentCount: 100 },
		{ agentCount: 0 },
		{ agentCount: 1.5 },
		{ status: 'completed' },
		{ status: 'stopped' },
	])
		assert.throws(() =>
			assertClockCohort({
				id: 'tiny-cohort',
				agentCount: 3,
				status: 'created',
				...patch,
			}),
		);
	const clock = {
		id: 'clock_fixture',
		name: 'givetogive:tiny-cohort',
		livemode: false,
		status: 'ready',
		frozen_time: 1900000000,
	};
	verifyNamedClock(clock, 'tiny-cohort', 'clock_fixture');
	for (const patch of [
		{ livemode: true },
		{ id: 'clock_other' },
		{ name: 'givetogive:other-run' },
		{ status: 'internal_failure' },
	])
		assert.throws(() =>
			verifyNamedClock(
				{ ...clock, ...patch },
				'tiny-cohort',
				'clock_fixture',
			),
		);
	assertClockAdvance(
		clock.frozen_time,
		clock.frozen_time + 86400,
		clock.frozen_time,
	);
	for (const target of [
		clock.frozen_time,
		clock.frozen_time - 1,
		clock.frozen_time + 33 * 86400,
		Infinity,
	])
		assert.throws(() =>
			assertClockAdvance(clock.frozen_time, target, clock.frozen_time),
		);
	assert.throws(() =>
		assertClockAdvance(
			clock.frozen_time + 366 * 86400,
			clock.frozen_time + 367 * 86400,
			clock.frozen_time,
		),
	);
});
test('clock commands cannot provide identities, delete clocks or change stable operation inputs', () => {
	assert.equal(clockCreateId('a'), clockCreateId('a'));
	assert.notEqual(clockCreateId('a'), clockCreateId('b'));
	assert.equal(
		clockCommandSchema.safeParse({ action: 'create', userId: 'victim' })
			.success,
		false,
	);
	assert.equal(
		clockCommandSchema.safeParse({
			action: 'delete',
			clockId: 'clock_fixture',
		}).success,
		false,
	);
	assert.equal(
		clockCommandSchema.safeParse({
			action: 'advance',
			operationId: 'not-a-uuid',
			frozenTime: 1900000000,
		}).success,
		false,
	);
	assert.equal(
		clockCommandSchema.safeParse({
			action: 'advance',
			operationId: randomUUID(),
			frozenTime: 1900000000,
		}).success,
		true,
	);
});
