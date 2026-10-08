import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivitySelectionChanged } from '../src/activity.ts';
import { ApiRejection } from '../src/ui-session.ts';
import { observationRetryDelay } from '../src/observation-retry.ts';
import {
	BrowserObservationUnavailable, BrowserWorkflowFailure, browserDiagnostic,
	observeContributionControl, observeContributionStatusDialog, type BrowserObservationState,
} from '../src/browser-observation.ts';

function state(): BrowserObservationState {
	return { phase: 'contribution_view', mutationAdmitted: false, mutationSent: false, pageErrors: 0, consoleErrors: 0 };
}

test('lifecycle dialog failures retain their exact fixed substep without retrying or swallowing errors', async () => {
	for (const failedStep of ['row', 'control', 'dialog'] as const) {
		const observation: BrowserObservationState = { ...state(), phase: 'contribution_history' };
		const error = new Error('private URL cookie and DOM fixture');
		const calls: string[] = [];
		const observe = (step: typeof failedStep) => async () => { calls.push(step); if (step === failedStep) throw error; };
		await assert.rejects(observeContributionStatusDialog(observation, observe('row'), observe('control'), observe('dialog')), candidate => candidate === error);
		assert.deepEqual(calls, ['row', 'control', 'dialog'].slice(0, ['row', 'control', 'dialog'].indexOf(failedStep) + 1));
		const diagnostic = browserDiagnostic(new BrowserWorkflowFailure(observation));
		assert.equal(diagnostic.browserContributionHistoryStep, failedStep);
		assert.doesNotMatch(JSON.stringify(diagnostic), /private|cookie|fixture/);
	}
});

test('lifecycle dialog observation refuses admission and error boundaries before the next control', async () => {
	for (const boundary of ['mutationAdmitted', 'mutationSent', 'pageErrors', 'consoleErrors'] as const) {
		const observation: BrowserObservationState = { ...state(), phase: 'contribution_history' };
		let controls = 0;
		await assert.rejects(observeContributionStatusDialog(observation,
			async () => { if (boundary === 'pageErrors' || boundary === 'consoleErrors') observation[boundary]++; else observation[boundary] = true; },
			async () => { controls++; }, async () => { controls++; }), BrowserWorkflowFailure);
		assert.equal(controls, 0);
	}
});

test('lifecycle substeps reject arbitrary strings and are absent from unrelated phases', () => {
	const observation = { ...state(), phase: 'contribution_history', contributionHistoryStep: 'secret-cookie-fixture' } as unknown as BrowserObservationState;
	assert.equal(browserDiagnostic(new BrowserWorkflowFailure(observation)).browserContributionHistoryStep, 'unknown');
	observation.phase = 'mutation_request';
	assert.equal(browserDiagnostic(new BrowserWorkflowFailure(observation)).browserContributionHistoryStep, undefined);
});
test('a missing freshly eligible contribution control permits only two read-only reloads', async () => {
	const observation = state();
	let reads = 0, reloads = 0;
	await observeContributionControl(observation, async () => { reads++; }, async () => reloads === 2, async () => { reloads++; });
	assert.equal(reads, 3);
	assert.equal(reloads, 2);
	assert.equal(observation.mutationAdmitted, false);
	assert.equal(observation.mutationSent, false);
	reads = reloads = 0;
	await assert.rejects(observeContributionControl(state(), async () => { reads++; }, async () => false, async () => { reloads++; }), BrowserWorkflowFailure);
	assert.equal(reads, 3);
	assert.equal(reloads, 2);
});
test('fresh target invalidation remains authoritative waiting at the caller, not a selector excuse', async () => {
	let reloads = 0;
	await assert.rejects(observeContributionControl(state(), async () => { throw new ActivitySelectionChanged(); }, async () => false, async () => { reloads++; }), ActivitySelectionChanged);
	assert.equal(reloads, 0);
	for (const error of [new Error('private DOM fixture'), new ApiRejection(401, 'UNAUTHORIZED')])
		await assert.rejects(observeContributionControl(state(), async () => { throw error; }, async () => false, async () => { reloads++; }), candidate => candidate === error);
	assert.equal(reloads, 0);
});
test('no admitted, sent, console/page-error, or post-response state may observe or reload', async () => {
	const invalid = [
		{ mutationAdmitted: true }, { mutationSent: true }, { pageErrors: 1 }, { consoleErrors: 1 },
		...(['mutation_admission', 'mutation_request', 'mutation_response', 'ui_transition', 'entity_verification'] as const).map(phase => ({ phase })),
	];
	for (const override of invalid) {
		const observation = { ...state(), ...override };
		let calls = 0;
		await assert.rejects(observeContributionControl(observation, async () => { calls++; }, async () => { calls++; return false; }, async () => { calls++; }), BrowserWorkflowFailure);
		assert.equal(calls, 0);
		assert.throws(() => new BrowserObservationUnavailable(observation), BrowserWorkflowFailure);
	}
});
test('a boundary changing during observation or reload prevents any further read/reload', async () => {
	for (const boundary of ['mutationAdmitted','mutationSent','pageErrors','consoleErrors'] as const) {
		for (const during of ['read','control','reload']) {
			const observation = state();
			let reloads = 0, reads = 0;
			const invalidate = () => { if (boundary === 'pageErrors' || boundary === 'consoleErrors') observation[boundary]++; else observation[boundary] = true; };
			await assert.rejects(observeContributionControl(observation,
				async () => { reads++; if (during === 'read') invalidate(); },
				async () => { if (during === 'control') invalidate(); return false; },
				async () => { reloads++; if (during === 'reload') invalidate(); }), BrowserWorkflowFailure);
			assert.equal(reads, 1);
			assert.equal(reloads, during === 'reload' ? 1 : 0);
		}
	}
});
test('admission is checked before each read-only reload and its exact failure is not hidden', async () => {
	let admissions = 0, reloads = 0;
	const failure = new Error('fixed admission stop');
	await assert.rejects(observeContributionControl(state(), async () => {}, async () => false, async () => { reloads++; }, () => { if (++admissions === 2) throw failure; }), candidate => candidate === failure);
	assert.equal(reloads, 0);
});
test('diagnostics are fixed vocabulary/counts only and retry classification stays bounded', () => {
	const observation = state();
	const error = new BrowserObservationUnavailable(observation);
	assert.deepEqual([0,1,2,3].map(attempt => observationRetryDelay(error, false, attempt)), [1000,2000,4000,undefined]);
	assert.equal(observationRetryDelay(error, true, 0), undefined);
	assert.equal(observationRetryDelay(new BrowserWorkflowFailure(observation), false, 0), undefined);
	const hostile = { ...state(), phase: 'secret-form-and-provider-body', pageErrors: Infinity, consoleErrors: -5 } as unknown as BrowserObservationState;
	const diagnostic = browserDiagnostic(new BrowserWorkflowFailure(hostile));
	assert.deepEqual(diagnostic, { browserPhase: 'unknown', browserMutationAdmitted: false, browserMutationSent: false, browserPageErrors: 1000000, browserConsoleErrors: 1000000 });
	assert.doesNotMatch(JSON.stringify(diagnostic), /secret|provider|form/);
	assert.deepEqual(browserDiagnostic(new Error('secret cookie fixture')), {});
	assert.doesNotMatch(new BrowserWorkflowFailure(hostile).message, /secret|provider|form/);
});
