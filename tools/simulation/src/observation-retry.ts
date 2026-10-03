import { UiObservationUnavailable } from './ui-session.ts';

/** Retry only a proved observation failure before any durable mutation intent. */
export function observationRetryDelay(error: unknown, pending: boolean, attempts: number) {
	if (
		!(error instanceof UiObservationUnavailable) || pending ||
		!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= 3
	) return undefined;
	return 1000 * 2 ** attempts;
}
