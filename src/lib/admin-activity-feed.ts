/** Preserve cursor zero after an empty initial page; only archives read backwards. */
export function activityCursor(previous: { id: number }[] | undefined, archived: boolean): number | undefined {
	return archived || !previous ? undefined : Math.max(0, ...previous.map((item) => item.id));
}

/** Keep live activity bounded without advancing past any incremental page. */
export function mergeActivityPage<T extends { id: number }>(
	previous: T[],
	fresh: T[],
): T[] {
	return [...new Map([...previous, ...fresh].map((item) => [item.id, item])).values()]
		.sort((a, b) => b.id - a.id)
		.slice(0, 500);
}

/** A full incremental page may hide a backlog; fetch the next page promptly. */
export function activityPollingInterval(
	archived: boolean,
	catchingUp = false,
	failed = false,
): number | false {
	return archived ? false : catchingUp && !failed ? 250 : 1000;
}
