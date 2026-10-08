import { ApiRejection, UiObservationUnavailable } from './ui-session.ts';

export const browserPhases = [
	'browser_open', 'identity', 'navigation', 'browse_view', 'create_form',
	'contribution_target', 'contribution_view', 'contribution_control',
	'contribution_form', 'contribution_history', 'saved_view',
	'mutation_admission', 'mutation_request', 'mutation_response',
	'ui_transition', 'entity_verification', 'context_close',
] as const;
export type BrowserPhase = typeof browserPhases[number];
export type BrowserObservationState = {
	phase: BrowserPhase;
	mutationAdmitted: boolean;
	mutationSent: boolean;
	pageErrors: number;
	consoleErrors: number;
};
export function isBeforeMutationObservation(state: BrowserObservationState) {
	return browserPhases.includes(state.phase) &&
		!['mutation_admission', 'mutation_request', 'mutation_response', 'ui_transition', 'entity_verification', 'context_close'].includes(state.phase) &&
		!state.mutationAdmitted && !state.mutationSent && state.pageErrors === 0 && state.consoleErrors === 0;
}
function snapshot(state: BrowserObservationState) {
	return {
		browserPhase: browserPhases.includes(state.phase) ? state.phase : 'unknown',
		browserMutationAdmitted: state.mutationAdmitted === true,
		browserMutationSent: state.mutationSent === true,
		browserPageErrors: Number.isSafeInteger(state.pageErrors) && state.pageErrors >= 0 ? Math.min(state.pageErrors, 1000000) : 1000000,
		browserConsoleErrors: Number.isSafeInteger(state.consoleErrors) && state.consoleErrors >= 0 ? Math.min(state.consoleErrors, 1000000) : 1000000,
	};
}
export class BrowserWorkflowFailure extends Error {
	readonly diagnostic: ReturnType<typeof snapshot>;
	constructor(state: BrowserObservationState) {
		const diagnostic = snapshot(state);
		super(`Browser workflow unverified (${diagnostic.browserPhase}); private diagnostics withheld.`);
		this.diagnostic = diagnostic;
	}
}
export class BrowserObservationUnavailable extends UiObservationUnavailable {
	readonly diagnostic: ReturnType<typeof snapshot>;
	constructor(state: BrowserObservationState) {
		super();
		if (!isBeforeMutationObservation(state)) throw new BrowserWorkflowFailure(state);
		this.diagnostic = snapshot(state);
	}
}
export class BrowserApiRejection extends ApiRejection {
	readonly diagnostic: ReturnType<typeof snapshot>;
	constructor(error: ApiRejection, state: BrowserObservationState) {
		super(error.status, error.code);
		this.diagnostic = snapshot(state);
	}
}
/** Fixed vocabulary only: no underlying Error, DOM, URL, form, or provider body. */
export function browserDiagnostic(error: unknown): Partial<ReturnType<typeof snapshot>> {
	if (error instanceof BrowserWorkflowFailure || error instanceof BrowserObservationUnavailable || error instanceof BrowserApiRejection)
		return { ...error.diagnostic };
	return {};
}
/** A disappearing lifecycle control is waiting ONLY when its exact API target changed. */
export async function observeContributionStatusControl(
	state: BrowserObservationState,
	observeEligibleTarget: () => Promise<unknown>,
	openControl: () => Promise<unknown>,
	admit: () => void = () => {},
) {
	const assert = () => {
		if (state.phase !== 'contribution_history' || !isBeforeMutationObservation(state))
			throw new BrowserWorkflowFailure(state);
		admit();
	};
	assert();
	await observeEligibleTarget();
	assert();
	try { await openControl(); }
	catch (error) {
		assert();
		// An authoritative terminal/missing/unauthorized pledge throws selection changed.
		// If it is still eligible, preserve the original UI error, not a fabricated wait.
		await observeEligibleTarget();
		throw error;
	}
	assert();
	await observeEligibleTarget();
	assert();
}
function assertBeforeMutation(state: BrowserObservationState) {
	if (!isBeforeMutationObservation(state) || !['contribution_target', 'contribution_view', 'contribution_control'].includes(state.phase))
		throw new BrowserWorkflowFailure(state);
}
/** Only a missing pre-submit control gets up to TWO read-only reloads. Never returns "waiting". */
export async function observeContributionControl(
	state: BrowserObservationState,
	observeEligibleTarget: () => Promise<unknown>,
	controlPresent: () => Promise<boolean>,
	reload: () => Promise<unknown>,
	admit: () => void = () => {},
) {
	for (let attempt = 0; attempt <= 2; attempt++) {
		assertBeforeMutation(state);
		admit();
		state.phase = 'contribution_target';
		await observeEligibleTarget();
		assertBeforeMutation(state);
		state.phase = 'contribution_control';
		const present = await controlPresent();
		assertBeforeMutation(state);
		if (present) return;
		if (attempt === 2) throw new BrowserWorkflowFailure(state);
		state.phase = 'contribution_view';
		admit();
		await reload();
		assertBeforeMutation(state);
	}
}
