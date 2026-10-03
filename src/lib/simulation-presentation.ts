/** Shared, testable presentation rules; never infer an outcome from an attempt. */
export function simulationRunnerOnline(
	run: {
		status: string;
		mode: string;
		settings: Record<string, unknown>;
		lastHeartbeatAt: Date | null;
	},
	now = Date.now(),
) {
	if (!['running', 'paused'].includes(run.status)) return false;
	if (
		run.mode === 'scripted' &&
		typeof run.settings['controllerId'] !== 'string'
	)
		return false;
	const heartbeat = run.lastHeartbeatAt?.getTime();
	return (
		heartbeat !== undefined && heartbeat <= now && heartbeat > now - 15_000
	);
}

export function entityHref(
	type: string,
	id: string | null,
	runId: string | null = null,
) {
	if (!id) return null;
	const encoded = encodeURIComponent(id);
	if (type === 'ask') return `/asks/${encoded}`;
	if (type === 'user' || type === 'member') return `/admin/users/${encoded}`;
	if (type === 'payment') return `/admin/payments/${encoded}`;
	if (type === 'simulation_run') return `/admin/simulations/${encoded}`;
	if (type === 'simulation' && runId) {
		const run = `/admin/simulations/${encodeURIComponent(runId)}`;
		return id === 'runner' || id === runId ?
				run
			:	`${run}/agents/${encoded}`;
	}
	// Without run context, telemetry may name an agent, not a run. Filter its
	// history instead of constructing a plausible but invalid run-detail URL.
	return `/admin/activity?entityType=${encodeURIComponent(type)}&entityId=${encoded}`;
}

export function simulationMetrics(mode: string) {
	const scripted = mode === 'scripted';
	return [
		{
			label: scripted ? 'Resolved action cycles' : 'Completed cycles',
			name: 'cycles',
			explanation:
				scripted ?
					'Accepted or server-rejected actions across all accounts. Waiting and unresolved intents are not resolved cycles.'
				:	'Runner-reported completed observe / decide / act cycles across all registered agents.',
			tone: 'leaf' as const,
		},
		{
			label:
				scripted ? 'Scripted actions queued' : 'Waiting for inference',
			name: scripted ? 'apiQueued' : 'inferenceQueued',
			explanation:
				scripted ?
					'Scripted jobs waiting for an API worker slot, not individual HTTP requests. Browser slots are separate.'
				:	'Requests waiting for a shared local-model slot. Queued is not generating.',
			tone: 'saffron' as const,
		},
		{
			label:
				scripted ? 'Scripted actions active' : 'Model requests active',
			name: scripted ? 'apiActive' : 'inferenceActive',
			explanation:
				scripted ?
					'Scripted jobs occupying an API worker slot at the last heartbeat; not all accounts or HTTP requests.'
				:	'Inference requests actually occupying a local model slot at the last heartbeat.',
			tone: 'cobalt' as const,
		},
		...(scripted ?
			[
				{
					label: 'Successful actions',
					name: 'actions',
					explanation:
						'Actions with an acknowledged authoritative success. Attempts and server rejections are excluded.',
					tone: 'leaf' as const,
				},
				{
					label: 'Action failures',
					name: 'failures',
					explanation:
						'Reported server rejections or unresolved errors. Inspect agent history before retrying uncertain actions.',
					tone: 'saffron' as const,
				},
			]
		:	[]),
	];
}
