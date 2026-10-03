export type CommunityActionEvidence = {
	id: string;
	agentId: string;
	kind: string;
	occurredAt: string;
	data?: { outcome?: string };
};

/** A timer or a large population alone never proves ongoing participation. */
export function communityContinuity(
	participants: string[],
	events: CommunityActionEvidence[],
	observedAt = Date.now(),
) {
	if (
		!participants.length ||
		new Set(participants).size !== participants.length
	)
		throw new Error('Evidence requires unique nonempty participants.');
	if (!Number.isFinite(observedAt))
		throw new Error('Invalid observation time.');
	const times = new Map(participants.map((id) => [id, [] as number[]]));
	const seen = new Map<string, { actor: string; at: number }>();
	for (const event of events) {
		if (event.kind !== 'action_result' || event.data?.outcome !== 'success')
			continue;
		const at = Date.parse(event.occurredAt);
		if (
			!times.has(event.agentId) ||
			!Number.isFinite(at) ||
			at > observedAt
		)
			throw new Error(
				'Successful evidence has an invalid participant or time.',
			);
		const prior = seen.get(event.id);
		if (prior && (prior.actor !== event.agentId || prior.at !== at))
			throw new Error(
				'Conflicting event identity cannot prove participation.',
			);
		if (prior) continue;
		seen.set(event.id, { actor: event.agentId, at });
		times.get(event.agentId)!.push(at);
	}
	const rows = [...times.values()].map((row) => row.sort((a, b) => a - b));
	const minimumSuccesses = Math.min(...rows.map((row) => row.length));
	const warmedUp = minimumSuccesses >= 3;
	const start = warmedUp ? Math.max(...rows.map((row) => row[2]!)) : null;
	// Conservatively end at the least recently active participant, not at the
	// newest event from a single busy account or at the process uptime.
	const end = warmedUp ? Math.min(...rows.map((row) => row.at(-1)!)) : null;
	const span = start !== null && end !== null ? Math.max(0, end - start) : 0;
	const windows = Math.floor(span / 300_000);
	let longestGap = 0;
	let minimumWindowActions = windows ? Infinity : 0;
	if (start !== null && end !== null && end >= start) {
		for (const row of rows) {
			const within = [
				start,
				...row.filter((at) => at > start && at < end),
				end,
			];
			for (let i = 1; i < within.length; i++)
				longestGap = Math.max(longestGap, within[i]! - within[i - 1]!);
			for (let window = 0; window < windows; window++) {
				const from = start + window * 300_000;
				minimumWindowActions = Math.min(
					minimumWindowActions,
					row.filter((at) => at >= from && at < from + 300_000)
						.length,
				);
			}
		}
	}
	return {
		participants: participants.length,
		minimumSuccessesPerParticipant: minimumSuccesses,
		warmupCompleteAt: start === null ? null : new Date(start).toISOString(),
		measuredThroughAt: end === null ? null : new Date(end).toISOString(),
		secondsAfterWarmup: Math.floor(span / 1000),
		maximumParticipantActionGapSeconds: longestGap / 1000,
		fullFiveMinuteWindows: windows,
		minimumSuccessesPerParticipantPerFullWindow: minimumWindowActions,
		oneHourContinuousEvidence:
			span >= 3_600_000 &&
			longestGap <= 180_000 &&
			minimumWindowActions > 0,
	};
}
