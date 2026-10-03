import { spawn } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { freemem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseActivity } from './activity.ts';
import { readCommunityCredentials, validateCommunity } from './community-config.ts';
import { CommunitySupervision } from './community-supervision.ts';
import { communityShutdownMessage } from './community-shutdown.ts';

const base = fileURLToPath(new URL('../', import.meta.url));
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

export function supervisionPaths(env: NodeJS.ProcessEnv, directory = base) {
	const match = new RegExp(`^\\.state/runs/(${uuid})/credentials\\.json$`).exec(env['SIM_CREDENTIALS'] ?? '');
	if (!match || !/^\.state\/community-[a-z0-9-]+$/.test(env['SIM_STATE_DIRECTORY'] ?? ''))
		throw new Error('Require exact isolated run credentials and community journal paths.');
	const runId = match[1]!;
	const activity = `.state/runs/${runId}/activity.jsonl`;
	if (env['SIM_ACTIVITY_FILE'] && env['SIM_ACTIVITY_FILE'] !== activity)
		throw new Error('Activity program must belong to the exact credential run.');
	const log = env['SIM_SUPERVISION_LOG'] ?? `.state/runs/${runId}/supervision.jsonl`;
	if (!new RegExp(`^\\.state/runs/${runId}/supervision(?:-${uuid})?\\.jsonl$`).test(log))
		throw new Error('Supervision log must be a fresh file inside the exact run directory.');
	if (env['SIM_PROTECTION_BYPASS_FILE'] && env['SIM_PROTECTION_BYPASS_FILE'] !== '.state/protection.json')
		throw new Error('Require the private local deployment-protection file.');
	return { runId, credentials: resolve(directory, match[0]), activity: resolve(directory, activity),
		state: resolve(directory, env['SIM_STATE_DIRECTORY']!), log: resolve(directory, log), activityRelative: activity };
}

function rejectLinkedPath(path: string) {
	let current = path;
	while (current !== base && current.startsWith(base)) {
		if (existsSync(current)) {
			if (lstatSync(current).isSymbolicLink() || realpathSync(current).toLowerCase() !== resolve(current).toLowerCase())
				throw new Error('Linked or redirected private state paths are not allowed.');
		}
		current = dirname(current);
	}
}

/** Child receives OS/runtime paths and validated simulation options, not app/Stripe secrets. */
export function supervisionEnvironment(env: NodeJS.ProcessEnv) {
	const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
		'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT', 'SIM_CREDENTIALS', 'SIM_STATE_DIRECTORY',
		'SIM_ACTIVITY_FILE', 'SIM_BROWSER_USERS', 'SIM_BROWSER_CONCURRENCY', 'SIM_API_CONCURRENCY',
		'SIM_DURATION_SECONDS', 'SIM_MIN_FREE_GIB', 'SIM_PROTECTION_BYPASS_FILE'];
	return Object.fromEntries(allowed.filter(key => env[key] !== undefined).map(key => [key, env[key]!])) as NodeJS.ProcessEnv;
}

/** Fixed categories and exact known aliases prevent secret-bearing arbitrary output fields. */
export function safeCommunityOutput(raw: unknown, users: ReadonlySet<string>, lines: ReadonlySet<string>, runId: string) {
	if (!raw || Array.isArray(raw) || typeof raw !== 'object') return undefined;
	const item = raw as Record<string, unknown>;
	const safe: Record<string, unknown> = {};
	if (typeof item['user'] === 'string' && users.has(item['user'])) safe['user'] = item['user'];
	if (typeof item['line'] === 'string' && lines.has(item['line'])) safe['line'] = item['line'];
	if (item['runId'] === runId) safe['runId'] = runId;
	const categories: Record<string, string[]> = {
		driver: ['script', 'browser'], outcome: ['success', 'waiting', 'rejected', 'paused', 'observation_backoff'],
		state: ['backing_off', 'paused', 'idle'], mode: ['scripted'],
		reason: ['control_or_telemetry_unavailable', 'unresolved_mutation', 'release_not_acknowledged', 'recovery_review_required'],
		telemetry: ['retained_locally'], command: ['community sync'], controller: ['retained_on_server'],
	};
	for (const [key, values] of Object.entries(categories))
		if (typeof item[key] === 'string' && values.includes(item[key])) safe[key] = item[key];
	for (const key of ['participants', 'browserUsers', 'browserConcurrency', 'apiConcurrency', 'lines', 'attempt'])
		if (typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] >= 0 && item[key] <= 100000) safe[key] = item[key];
	if (item['normalUiAuth'] === true) safe['normalUiAuth'] = true;
	return Object.keys(safe).length ? safe : undefined;
}

async function main() {
	const command = process.argv[2] ?? 'run';
	if (!['run', 'inspect'].includes(command)) throw new Error('Commands: run, inspect.');
	const paths = supervisionPaths(process.env);
	for (const path of [paths.credentials, paths.activity, paths.state, paths.log]) rejectLinkedPath(path);
	const { credentials, settings } = validateCommunity(readCommunityCredentials(paths.credentials), {
		browserUsers: process.env['SIM_BROWSER_USERS'], browserConcurrency: process.env['SIM_BROWSER_CONCURRENCY'],
		apiConcurrency: process.env['SIM_API_CONCURRENCY'], durationSeconds: process.env['SIM_DURATION_SECONDS'], minimumFreeGiB: process.env['SIM_MIN_FREE_GIB'],
	});
	if (credentials.runId !== paths.runId) throw new Error('Run credential identity differs from its private path.');
	const program = parseActivity(readFileSync(paths.activity, 'utf8'));
	const users = new Set(credentials.agents.map(account => account.id));
	const lines = new Set(program.map(line => line.id));
	if (program.some(line => !users.has(line.user)) || new Set(program.map(line => line.user)).size !== users.size)
		throw new Error('The program must schedule every exact independently provisioned participant.');
	const metadata = { runId: paths.runId, participants: users.size, browserUsers: settings.browserUsers,
		browserConcurrency: settings.browserConcurrency, apiConcurrency: settings.apiConcurrency,
		durationSeconds: settings.durationSeconds, minimumFreeGiB: settings.minimumFreeGiB, supervisionLog: paths.log };
	if (command === 'inspect') { console.log(JSON.stringify({ ...metadata, inspected: true, runnerStarted: false })); return; }
	if (freemem() / 2 ** 30 < Math.max(2.5, settings.minimumFreeGiB + 1))
		throw new Error('Insufficient measured memory headroom to launch a fresh community.');
	// Exclusive creation prevents accidental duplicate or overwritten supervision history.
	closeSync(openSync(paths.log, 'wx', 0o600));
	const supervision = new CommunitySupervision(paths.log);
	process.stdout.on('error', () => { supervision.outputLost(); });
	const env = supervisionEnvironment(process.env);
	env['SIM_ACTIVITY_FILE'] = paths.activityRelative;
	const child = spawn(process.execPath, ['--experimental-strip-types', 'src/community-cli.ts', 'run'], {
		cwd: base, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	supervision.record({ ...metadata, started: true, supervisorProcessId: process.pid, ownedProcessId: child.pid });
	const counters = { success: 0, waiting: 0, rejected: 0, paused: 0, backoff: 0 };
	let partial = '', stderrSeen = false;
	child.stdout!.on('data', chunk => {
		partial += chunk.toString();
		let newline;
		while ((newline = partial.indexOf('\n')) >= 0) {
			const line = partial.slice(0, newline); partial = partial.slice(newline + 1);
			let raw: unknown; try { raw = JSON.parse(line); } catch { continue; }
			const safe = safeCommunityOutput(raw, users, lines, paths.runId);
			if (!safe) continue;
			supervision.record(safe);
			const outcome = safe['outcome'];
			if (typeof outcome === 'string' && Object.hasOwn(counters, outcome)) counters[outcome as keyof typeof counters]++;
			if (safe['state'] === 'backing_off') counters.backoff++;
			if (['paused', 'rejected'].includes(String(outcome)) || safe['state'] === 'backing_off')
				supervision.record({ progress: counters, attention: safe });
		}
		if (partial.length > 65536) { partial = ''; supervision.record({ outputDiscarded: true }); }
	});
	child.stderr!.on('data', () => { stderrSeen = true; });
	const interval = setInterval(() => supervision.record({ runId: paths.runId, progress: counters }), 30000);
	function drain() {
		supervision.record({ runId: paths.runId, shutdownRequested: true, forceKilled: false });
		if (child.connected) child.send(communityShutdownMessage, error => {
			if (error) supervision.record({ shutdownDeliveryFailed: true, automaticRetry: false });
		});
	}
	process.once('SIGINT', drain);
	process.once('SIGTERM', drain);
	child.on('error', () => { clearInterval(interval); supervision.record({ terminal: true, runner: 'could_not_start' }); process.exitCode = 1; });
	child.on('close', (code, signal) => {
		clearInterval(interval);
		supervision.record({ runId: paths.runId, terminal: true, exitCode: code, signal, counters, stderrSeen });
		process.exitCode = code ?? 1;
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main().catch(() => { process.exitCode = 1; console.error('Community supervision failed; private diagnostics withheld.'); });
}
