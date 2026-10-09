import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { validatePredispatchRecovery } from '../../scripts/checkout-predispatch-recovery.mjs';
const operationId = '398c5cf9-62de-4908-afb0-ce6321e8b3ad',
	memberId = 'synthetic-bcfa98ea084ed93e-003',
	headSha = '1b8871493ab2f05004bcdeaa03af644ecbf869d0';
function original() {
	return {
		names: [
			'operator-lease.json',
			'member-sign-in.intent.json',
			'prerequisites.original.json',
			'release.original.json',
			'current-dispatch-' + operationId,
		],
		dispatchNames: ['dispatch-lease.json'],
		operator: {
			headSha,
			operationId,
			maximumMemberSignIns: 1,
			maximumPreparations: 1,
			maximumSubmissions: 1,
			noHistoryReset: true,
			retryAllowed: false,
			paymentAccepted: false,
		},
		dispatch: {
			headSha,
			operationId,
			maximumDispatches: 1,
			maximumDraftCreates: 1,
			maximumAssociationWrites: 1,
			retryAllowed: false,
			paymentAccepted: false,
		},
		signIn: { actorId: memberId, maximumPosts: 1, retryAllowed: false },
		prerequisites: {
			readOnly: true,
			originalBudgetVerified: true,
			candidateUnused: true,
			candidatePrepared: false,
			checkoutCreated: false,
			submitAttempted: false,
			paymentAccepted: false,
			appSubscriptions: 0,
			paidCoverage: 0,
			ledgerEntries: 0,
			priorExpiredProviderSessions: 2,
		},
		release: {
			headSha,
			deploymentId: 'dpl_BjjNh1yYuzNyXHLPhdja6k2xwS7X',
			deployedAppSha: 'c8044c1b9dae433b2d598f39f84e6897dd87c546',
			ready: true,
			protected: true,
			runtimeGatesVerified: true,
			financialAdmission: false,
			paymentAccepted: false,
		},
	};
}
test('only the exact failed-before-dispatch original tree is eligible for separate recovery', () => {
	const proof = validatePredispatchRecovery(
		original(),
		operationId,
		memberId,
	);
	assert.equal(proof.financialRetry, false);
	assert.equal(proof.providerAndOriginalBudgetRecheckRequired, true);
	for (const change of [
		{ names: [...original().names, 'ui-acceptance.intent.json'] },
		{ dispatchNames: ['dispatch-lease.json', 'draft-create.intent.json'] },
		{
			dispatchNames: [
				'dispatch-lease.json',
				'workflow-dispatch.intent.json',
			],
		},
		{ operator: { ...original().operator, headSha: 'a'.repeat(40) } },
		{
			prerequisites: {
				...original().prerequisites,
				candidatePrepared: true,
			},
		},
		{ prerequisites: { ...original().prerequisites, ledgerEntries: 1 } },
		{ release: { ...original().release, financialAdmission: true } },
	])
		assert.throws(() =>
			validatePredispatchRecovery(
				{ ...original(), ...change },
				operationId,
				memberId,
			),
		);
	assert.throws(() =>
		validatePredispatchRecovery(original(), operationId, 'another-member'),
	);
});
test('native operator default remains inert and neither consumes nor recovers an intent', () => {
	const data = JSON.parse(
		execFileSync(
			process.execPath,
			['scripts/checkout-current-native-operator.mjs'],
			{ encoding: 'utf8' },
		),
	);
	assert.equal(data.execute, false);
	assert.equal(data.externalRequests, 0);
	assert.equal(data.checkoutCreated, false);
});
