/** Work time belongs to the publication period, rather than being added to it. */
export function controllerPollingDelay(startedAt: number, finishedAt: number, failed: boolean): number {
	if (failed) return 2000;
	const elapsed = Math.max(0, finishedAt - startedAt);
	// Slow successful requests still yield; never spin a saturated endpoint.
	return Math.max(250, 1000 - elapsed);
}
