import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { freemem, totalmem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import {
	browserAccounts,
	readCommunityCredentials,
	validateCommunity,
} from './community-config.ts';
import { parseActivity, executeActivity } from './activity.ts';
import { ActivityStore } from './activity-store.ts';
import { ApiRejection, UiSession } from './ui-session.ts';
import { CommunityBrowser } from './community-browser.ts';
import { Semaphore } from './semaphore.ts';
import { protectionSecret } from './protection.ts';
import { redact } from './safety.ts';
import { CommunityControl, TerminalCommunityRun, assertTerminalCommunityCleanup } from './community-control.ts';
import { CommunityState } from './community-state.ts';
import { Store } from './store.ts';
import { flushOutbox } from './outbox.ts';
import { HostedTransportError } from './transport.ts';
import { observationRetryDelay } from './observation-retry.ts';
import { assertCommunityCheckpoint, reviewedCheckpointStop } from './community-recovery.ts';
import { registerCommunityShutdown } from './community-shutdown.ts';

const { credentials, settings } = validateCommunity(
	readCommunityCredentials(
		process.env.SIM_CREDENTIALS ?? '.state/credentials.json',
	),
	{
		browserUsers: process.env.SIM_BROWSER_USERS,
		browserConcurrency: process.env.SIM_BROWSER_CONCURRENCY,
		apiConcurrency: process.env.SIM_API_CONCURRENCY,
		durationSeconds: process.env.SIM_DURATION_SECONDS,
		minimumFreeGiB: process.env.SIM_MIN_FREE_GIB,
	},
);
const source = readFileSync(
	process.env.SIM_ACTIVITY_FILE ??
		`.state/runs/${credentials.runId}/activity.jsonl`,
	'utf8',
);
const lines = parseActivity(source);
const accounts = new Map(
	credentials.agents.map((account) => [account.id, account]),
);
if (lines.some((line) => !accounts.has(line.user)))
	throw new Error('An activity line names an unprovisioned account.');
const scheduledIds = new Set(lines.map((line) => line.user));
if (scheduledIds.size !== accounts.size)
	throw new Error(
		'Every provisioned participant must have an activity schedule; an idle fixture is not a live user.',
	);
const browserIds = new Set(
	browserAccounts(credentials, settings.browserUsers).map(
		(account) => account.id,
	),
);
const digest = createHash('sha256')
	.update(
		JSON.stringify({
			source,
			browserIds: [...browserIds],
			origin: credentials.origin,
			databaseIdentity: credentials.databaseIdentity,
		}),
	)
	.digest('hex');
const store = new ActivityStore(
	join(
		resolve(process.env.SIM_STATE_DIRECTORY ?? '.state'),
		'activity.sqlite',
	),
	credentials.runId,
	digest,
);
const browsers = new CommunityBrowser(settings.browserConcurrency);
const apiSlots = new Semaphore(settings.apiConcurrency, 30);
const bypass = protectionSecret();
const control = new CommunityControl(
	credentials,
	bypass,
	settings.browserUsers,
);
const telemetry = new Store(
	join(
		resolve(process.env.SIM_STATE_DIRECTORY ?? '.state'),
		'community-telemetry.sqlite',
	),
	credentials.runId,
);
const telemetryJournalId = telemetry.meta('journalId') ?? randomUUID();
telemetry.meta('journalId', telemetryJournalId);
// Bind both durable journals. Losing telemetry must not reset event sequences silently.
const controllerDigest = createHash('sha256')
	.update(`${digest}:${telemetryJournalId}`)
	.digest('hex');
const state = new CommunityState(
	telemetry,
	scheduledIds,
	browserIds,
	settings.browserConcurrency,
);
const secrets = [
	credentials.runnerToken,
	bypass ?? '',
	...credentials.agents.map((account) => account.password),
];
const sessions = new Map<string, UiSession>();
const haltedUsers = new Set<string>();
const stats = new Map(
	credentials.agents.map((account) => [
		account.id,
		{
			...store.counts(
				lines
					.filter((line) => line.user === account.id)
					.map((line) => line.id),
			),
			state: 'idle',
		},
	]),
);
let stopping = false;
let lastControlAt = 0;
let stopReason = 'interrupted';
let controllerClaimed = false;
let runStarted = false;
const unregisterShutdown = registerCommunityShutdown(() => { stopping = true; });
const finishAt = Date.now() + settings.durationSeconds * 1000;
const command = process.argv[2] ?? 'run';
class AdmissionWait extends Error {}
function admit(id: string) {
	if (
		stopping ||
		state.stopping ||
		state.paused ||
		state.pausedUsers.has(id) ||
		Date.now() >= finishAt ||
		Date.now() - lastControlAt > 15000 ||
		freemem() / 2 ** 30 < settings.minimumFreeGiB
	)
		throw new AdmissionWait(
			'Waiting for current control, resource and scheduling admission.',
		);
}
function event(
	id: string,
	actorState: 'idle' | 'acting' | 'backing_off' | 'paused',
	summary: string,
	data: Record<string, unknown> = {},
) {
	const counters = stats.get(id)!;
	counters.state = actorState;
	telemetry.event(id, actorState, 'action_result', summary, {
		cycles: counters.cycles,
		driver: browserIds.has(id) ? 'browser' : 'script',
		...data,
	});
}
async function controllerLoop() {
	while (!stopping && !state.stopping && Date.now() < finishAt) {
		try {
			await control.preflight();
			const batch = await control.transport.control(
				credentials.runId,
				telemetry.meta('cursor') ?? '0',
			);
			for (const instruction of batch.commands) {
				try {
					if (
						instruction.type === 'resume_agent' &&
						haltedUsers.has(instruction.agentId ?? '')
					)
						throw new Error(
							'This account requires outcome/authentication review, not automatic resume.',
						);
					if (state.apply(instruction))
						telemetry.event(
							'runner',
							'idle',
							'control_applied',
							`Applied ${instruction.type}`,
							{ commandId: instruction.id },
						);
				} catch {
					telemetry.event(
						'runner',
						'idle',
						'control_rejected',
						'Control rejected without changing member activity.',
						{ commandId: instruction.id },
					);
					telemetry.acknowledgeCommand(instruction.id);
				}
			}
			telemetry.meta('cursor', batch.cursor);
			browsers.slots.resize(state.browserConcurrency);
			telemetry.event(
				'runner',
				state.paused ? 'paused' : 'idle',
				'heartbeat',
				'Ongoing normal-auth community runner.',
				{
					cycles: [...stats.values()].reduce(
						(sum, row) => sum + row.cycles,
						0,
					),
					actions: [...stats.values()].reduce(
						(sum, row) => sum + row.actions,
						0,
					),
					failures: [...stats.values()].reduce(
						(sum, row) => sum + row.failures,
						0,
					),
					browserActive: browsers.slots.active,
					browserQueued: browsers.slots.waiting,
					browserConcurrency: state.browserConcurrency,
					browserUsers: browserIds.size,
					scriptedUsers: accounts.size - browserIds.size,
					apiActive: apiSlots.active,
					apiQueued: apiSlots.waiting,
					inferenceActive: 0,
					inferenceQueued: 0,
					ramFreeGiB: freemem() / 2 ** 30,
					ramTotalGiB: totalmem() / 2 ** 30,
				},
			);
			await flushOutbox(
				telemetry,
				(events) => control.transport.events(credentials.runId, events),
				10000,
			);
			lastControlAt = Date.now();
		} catch (error) {
			if (
				error instanceof HostedTransportError &&
				[401, 403, 409].includes(error.status)
			) {
				lastControlAt = 0;
				stopping = true;
				break;
			}
			if (error instanceof TerminalCommunityRun) {
				state.stopping = true;
				telemetry.meta('stopRequested', 'true');
				break;
			}
			// No secret-bearing network error text. Admission expires if control/telemetry is stale.
			console.log(
				JSON.stringify({
					state: 'backing_off',
					reason: 'control_or_telemetry_unavailable',
				}),
			);
		}
		if (!stopping && !state.stopping) await sleep(2000);
	}
}
async function userLoop(id: string) {
	const account = accounts.get(id)!;
	const driver = browserIds.has(id) ? 'browser' : 'script';
	const scheduled = lines
		.filter((line) => line.user === id)
		.map((line) => {
			const last = store.last(line.id);
			return {
				line,
				iteration:
					last ?
						last.state === 'pending' ?
							last.iteration
						:	last.iteration + 1
					:	0,
				wakeAt: 0,
				observationRetries: 0,
			};
		});
	while (!stopping && !state.stopping && Date.now() < finishAt) {
		try {
			admit(id);
		} catch {
			if (
				(state.paused || state.pausedUsers.has(id)) &&
				stats.get(id)!.state !== 'paused'
			)
				event(
					id,
					'paused',
					'Controller paused; no new member action admitted.',
				);
			await sleep(500);
			continue;
		}
		const job = scheduled.find(
			(job) =>
				job.wakeAt <= Date.now() &&
				(job.line.everySeconds || job.iteration === 0),
		);
		if (!job) {
			await sleep(250);
			continue;
		}
		if (store.state(job.line.id, job.iteration) === 'pending') {
			event(
				id,
				'paused',
				'Unresolved mutation retained; automatic replay is forbidden.',
				{ lineId: job.line.id, outcome: 'ambiguous' },
			);
			haltedUsers.add(id);
			console.log(
				JSON.stringify({
					user: id,
					driver,
					line: job.line.id,
					state: 'paused',
					reason: 'unresolved_mutation',
				}),
			);
			return;
		}
		try {
			const work = async () => {
				// Recheck after waiting for a slot: no new action after stop/resource pressure.
				admit(id);
				let session = sessions.get(id);
				if (!session) {
					session = await UiSession.signIn(
						credentials.origin,
						account,
						bypass,
					);
					sessions.set(id, session);
				}
				return executeActivity(session, job.line, store.refs(), {
					beforeMutation: (procedure) => {
						admit(id);
						store.intent(job.line.id, job.iteration, procedure);
					},
					...(driver === 'browser' ?
						{
							browserAction: (line, ask, admission, entity) =>
								browsers.action(
									session!,
									line,
									ask,
									bypass,
									admission,
									entity,
									() => admit(id),
								),
						}
					:	{}),
				});
			};
			// Browser concurrency is independent; API worker limits must not silently cap it at four.
			const result = await (driver === 'script' ?
				apiSlots.run(work)
			:	work());
			if (!result) continue;
			job.observationRetries = 0;
			if (result.outcome === 'success') {
				store.finish(
					job.line.id,
					job.iteration,
					'success',
					result.entity,
					job.line.ref,
				);
				job.iteration++;
				const counters = stats.get(id)!;
				counters.cycles++;
				counters.actions++;
			}
			event(
				id,
				'idle',
				result.outcome === 'success' ?
					`Completed ${job.line.action}`
				:	'Waiting for a matching record or exact dependency.',
				{
					lineId: job.line.id,
					iteration: job.iteration,
					outcome: result.outcome,
					entityId: result.entity?.id,
					entityKind: result.entity?.kind,
					askId: result.entity?.askId,
				},
			);
			console.log(
				JSON.stringify({
					user: id,
					driver,
					line: job.line.id,
					outcome: result.outcome,
					entity: result.entity,
				}),
			);
			job.wakeAt =
				Date.now() + ((job.line.everySeconds ?? 5) * 1000) / state.rate;
		} catch (error) {
			if (error instanceof AdmissionWait) {
				await sleep(500);
				continue;
			}
			const observationDelay = observationRetryDelay(
				error, store.state(job.line.id, job.iteration) === 'pending', job.observationRetries,
			);
			if (observationDelay !== undefined) {
				job.observationRetries++;
				job.wakeAt = Date.now() + observationDelay;
				event(id, 'backing_off', 'Read-only observation unavailable before any member mutation.', {
					lineId: job.line.id, outcome: 'observation_backoff', attempt: job.observationRetries,
				});
				console.log(JSON.stringify({ user: id, driver, line: job.line.id, outcome: 'observation_backoff', attempt: job.observationRetries }));
				continue;
			}
			const rejected =
				error instanceof ApiRejection &&
				error.status >= 400 &&
				error.status < 500;
			if (rejected) {
				store.finish(job.line.id, job.iteration, 'rejected');
				job.iteration++;
				stats.get(id)!.cycles++;
			}
			stats.get(id)!.failures++;
			const halted =
				!rejected ||
				[401, 403].includes((error as ApiRejection).status);
			event(
				id,
				halted ? 'paused' : 'backing_off',
				rejected ?
					'Server rejected this action; no success invented.'
				:	'Unresolved action requires review before further member activity.',
				{
					lineId: job.line.id,
					outcome: rejected ? 'rejected' : 'ambiguous',
					...(error instanceof ApiRejection ?
						{ httpStatus: error.status, errorCode: error.code }
					:	{}),
				},
			);
			console.log(
				JSON.stringify({
					user: id,
					driver,
					line: job.line.id,
					outcome: rejected ? 'rejected' : 'paused',
					message: redact(
						error instanceof Error ?
							error.message
						:	'Activity failed',
						secrets,
					),
				}),
			);
			if (halted) {
				haltedUsers.add(id);
				return;
			}
			job.wakeAt = Date.now() + 30000;
		}
	}
}
try {
	if (!['run', 'validate', 'preflight', 'sync', 'checkpoint', 'cleanup'].includes(command))
		throw new Error('Commands: run, validate, preflight, sync, checkpoint, cleanup.');
	if (
		command === 'run' &&
		(state.stopping ||
			['completed', 'stopped'].includes(
				telemetry.meta('lifecycle') ?? '',
			))
	)
		throw new Error(
			'This local run is terminal. Sync its retained telemetry and create a fresh run.',
		);
	console.log(
		JSON.stringify({
			runId: credentials.runId,
			participants: accounts.size,
			browserUsers: browserIds.size,
			browserConcurrency: settings.browserConcurrency,
			apiConcurrency: settings.apiConcurrency,
			lines: lines.length,
			mode: 'scripted',
			normalUiAuth: true,
		}),
	);
	if (command === 'sync') {
		control.transport.controllerId = telemetry.meta('controllerId');
		await flushOutbox(telemetry, (events) =>
			control.transport.events(credentials.runId, events),
		);
	}
	if (command === 'cleanup') {
		const manifest = assertTerminalCommunityCleanup(
			await control.transport.manifest(), credentials, settings.browserUsers,
			store.pendingCount(), telemetry.pendingEvents().length,
		);
		const cohort = new Set(credentials.agents.map(account => account.userId));
		store.reviewAbandonedClaims(cohort);
		const priorControllerId = telemetry.meta('controllerId');
		if (!priorControllerId) throw new Error('Retained controller identity is required for acknowledged hosted release.');
		await control.transport.controller('release', credentials.runId, priorControllerId, controllerDigest, store.journalId);
		const removedClaims = store.releaseAbandonedClaims(cohort);
		// Only local control metadata changes; action results and historical telemetry remain intact.
		telemetry.meta('stopRequested', 'true');
		telemetry.meta('lifecycle', manifest.runStatus === 'completed' ? 'completed' : 'stopped');
		console.log(JSON.stringify({ runId: credentials.runId, cleanup: true, removedClaims, historicalOutcomesPreserved: true }));
	}
	if (command === 'checkpoint') {
		let rawReview: unknown;
		try { rawReview = JSON.parse(readFileSync(process.env.SIM_CHECKPOINT_REVIEW_FILE ?? '', 'utf8')); }
		catch { throw new Error('The private operator checkpoint review could not be read.'); }
		const review = assertCommunityCheckpoint(
			await control.transport.manifest(), credentials, settings.browserUsers, rawReview,
			telemetry.meta('controllerId'), store.pendingCount(), telemetry.pendingEvents().length,
		);
		store.reviewAbandonedClaims(new Set(credentials.agents.map(account => account.userId)));
		state.paused = true;
		telemetry.meta('checkpointPriorControllerId', review.priorControllerId);
		for (const account of accounts.values())
			store.claim(account.userId, browserIds.has(account.id) ? 'browser' : 'script');
		telemetry.meta('controllerAttemptId', store.owner);
		await control.transport.controller('acquire', credentials.runId, store.owner, controllerDigest, store.journalId);
		controllerClaimed = true;
		telemetry.meta('controllerId', store.owner);
		// Shared finally records actual stop/paused cleanup. Never start member loops or sign in.
		runStarted = true;
		const stop = reviewedCheckpointStop(
			await control.transport.control(credentials.runId, telemetry.meta('cursor') ?? '0'), review.stopCommandId,
		);
		state.apply(stop);
		telemetry.meta('cursor', stop.id);
		telemetry.event('runner', 'paused', 'control_applied', 'Applied reviewed stop without member activity.', { commandId: stop.id, controlOnly: true });
		stopReason = 'stopped';
		console.log(JSON.stringify({ runId: credentials.runId, checkpoint: true, memberWorkStarted: false, reviewedStopApplied: true }));
	}
	if (command === 'preflight' || command === 'run') {
		const manifest = await control.preflight();
		state.paused ||= manifest.runStatus === 'paused';
		if (command === 'run') {
			// Claim the entire cohort before sign-in or activity, so a partial claim failure cannot leave other loops running.
			for (const account of accounts.values())
				store.claim(
					account.userId,
					browserIds.has(account.id) ? 'browser' : 'script',
				);
			// A fresh process identity is never reused to impersonate an older live controller.
			// Persist before sending: a lost acquisition response requires explicit recovery.
			telemetry.meta('controllerAttemptId', store.owner);
			await control.transport.controller(
				'acquire',
				credentials.runId,
				store.owner,
				controllerDigest,
				store.journalId,
			);
			controllerClaimed = true;
			telemetry.meta('controllerId', store.owner);
			telemetry.event(
				'runner',
				state.paused ? 'paused' : 'idle',
				'run_started',
				'Starting the ongoing scripted/browser community.',
				{ mode: 'scripted', population: accounts.size },
			);
			runStarted = true;
			await flushOutbox(telemetry, (events) =>
				control.transport.events(credentials.runId, events),
			);
			// First queued controls must be applied before any member work is admitted.
			lastControlAt = 0;
			const jobs = [
				controllerLoop(),
				...[...scheduledIds].map(userLoop),
			].map((promise) =>
				promise.catch((error) => {
					stopping = true;
					throw error;
				}),
			);
			const settled = await Promise.allSettled(jobs);
			const failed = settled.find(
				(result) => result.status === 'rejected',
			);
			if (failed?.status === 'rejected')
				throw new Error(
					'Community controller failed; remaining work drained and its journal retained.',
				);
			stopReason =
				state.stopping ? 'stopped'
				: Date.now() >= finishAt ? 'completed'
				: 'interrupted';
		}
	}
} finally {
	stopping = true;
	const sessionCleanup = await Promise.allSettled(
		[...sessions.values()].map((session) => session.close()),
	);
	const browserCleanup = await Promise.allSettled([browsers.close()]);
	const cleanupFailed = [...sessionCleanup, ...browserCleanup].some(
		(result) => result.status === 'rejected',
	);
	if (['run', 'checkpoint'].includes(command) && runStarted) {
		if (stopReason !== 'interrupted')
			telemetry.meta('lifecycle', stopReason);
		else telemetry.meta('paused', 'true');
		telemetry.event(
			'runner',
			'paused',
			stopReason === 'completed' ? 'run_completed'
			: stopReason === 'stopped' ? 'run_stopped'
			: 'run_paused',
			`Runner ${stopReason}; no new member activity admitted.`,
			{
				cycles: [...stats.values()].reduce(
					(sum, row) => sum + row.cycles,
					0,
				),
				actions: [...stats.values()].reduce(
					(sum, row) => sum + row.actions,
					0,
				),
				failures: [...stats.values()].reduce(
					(sum, row) => sum + row.failures,
					0,
				),
				browserActive: browsers.slots.active,
				browserQueued: browsers.slots.waiting,
				apiActive: apiSlots.active,
				apiQueued: apiSlots.waiting,
			},
		);
		await flushOutbox(telemetry, (events) =>
			control.transport.events(credentials.runId, events),
		).catch(() => {
			console.log(
				JSON.stringify({
					telemetry: 'retained_locally',
					command: 'community sync',
				}),
			);
		});
	}
	if (
		controllerClaimed &&
		!cleanupFailed &&
		!store.pendingCount() &&
		!telemetry.pendingEvents().length
	) {
		await control.transport
			.controller(
				'release',
				credentials.runId,
				store.owner,
				controllerDigest,
				store.journalId,
			)
			.catch(() => {
				console.log(
					JSON.stringify({
						controller: 'retained_on_server',
						reason: 'release_not_acknowledged',
					}),
				);
			});
	} else if (controllerClaimed) {
		console.log(
			JSON.stringify({
				controller: 'retained_on_server',
				reason: 'recovery_review_required',
			}),
		);
	}
	telemetry.close();
	store.close();
	unregisterShutdown();
}
