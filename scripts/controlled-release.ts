/** GiveToGive-only, deliberate releases. Import/default is inert. Checkpoint
 * pushes run CI but do not deploy. No credentials are copied to GitHub. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSourceDigest } from './release-rehearsal-fingerprint.mjs';

export const releaseTargets = Object.freeze({
	production: {
		project: 'prj_ybTPdccFCvwTBUNrYDC8qxJ2fqq3',
		name: 'givetogive',
		host: 'givetogive.vercel.app',
		protection: 'prod_deployment_urls_and_all_previews',
	},
	staging: {
		project: 'prj_HvlFV1kKHVsML73nlsJAFQNA7grP',
		name: 'givetogive-staging',
		host: 'givetogive-staging.vercel.app',
		protection: 'all',
	},
});
type Target = keyof typeof releaseTargets;
const team = 'team_TXid48wU77cfhEg28L3EyLpn';
const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (): never => {
	throw Error(
		'Controlled release refused; private diagnostics withheld. Inspect the retained receipt before any retry.',
	);
};
function guard(value: unknown): asserts value {
	if (!value) fail();
}

export function releaseRelevantPath(path: string) {
	const name = path.replaceAll('\\', '/');
	if (name.startsWith('src/app/.well-known/workflow/')) return false;
	return (
		/^(src\/|public\/)/.test(name) ||
		/^(package(?:-lock)?\.json|next\.config\.(ts|js|mjs)|tsconfig\.json|postcss\.config\.(js|cjs|mjs)|tailwind\.config\.(ts|js)|vercel\.json|\.vercelignore|\.npmrc|\.nvmrc)$/.test(
			name,
		)
	);
}
export function privateDeploymentPath(path: string) {
	const name = path.replaceAll('\\', '/');
	return (
		/^(?:\.env|\.git\/|\.github\/|\.vercel\/|\.stripe\/|\.next\/|node_modules\/|tools\/|tests\/|tmp\/|\.vscode\/|output\/|docs\/|\.codex-finalizer\/|chrome-debug-profile\/|playwright-report\/|test-results\/|coverage\/|src\/app\/\.well-known\/workflow\/)/.test(
			name,
		) || /\.(?:pem|pdf|sqlite|key|tsbuildinfo)$/i.test(name)
	);
}
type CiRun = {
	head_sha: string;
	head_branch: string;
	event: string;
	status: string;
	conclusion: string | null;
	run_attempt: number;
};
export function verifiedReleaseCi(runs: readonly CiRun[], sha: string) {
	return (
		/^[a-f0-9]{40}$/.test(sha) &&
		runs.some(
			(run) =>
				run.head_sha === sha &&
				run.head_branch === 'main' &&
				['push', 'workflow_dispatch'].includes(run.event) &&
				run.status === 'completed' &&
				run.conclusion === 'success' &&
				run.run_attempt === 1,
		)
	);
}
export function parseReleaseArguments(args: readonly string[]) {
	if (!args.length) return { mode: 'help' as const, target: null };
	guard(
		args.length === 3 &&
			['--inspect', '--deploy'].includes(args[0] ?? '') &&
			args[1] === '--target' &&
			(args[2] === 'production' || args[2] === 'staging'),
	);
	return {
		mode:
			args[0] === '--deploy' ? ('deploy' as const) : ('inspect' as const),
		target: args[2] as Target,
	};
}
function command(binary: string, args: string[]) {
	try {
		return execFileSync(binary, args, {
			cwd: root,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 120000,
			maxBuffer: 16777216,
		});
	} catch {
		return fail();
	}
}
function git(args: string[]) {
	const bytes = command('git', args);
	try {
		return bytes.toString().trim();
	} finally {
		bytes.fill(0);
	}
}
function jsonCommand(binary: string, args: string[]): unknown {
	const bytes = command(binary, args);
	try {
		return JSON.parse(bytes.toString());
	} catch {
		return fail();
	} finally {
		bytes.fill(0);
	}
}
function object(value: unknown): Record<string, unknown> {
	guard(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}
function cliPath() {
	const path = process.env['VERCEL_CLI_PATH'];
	guard(typeof path === 'string' && existsSync(path));
	const pkg = object(
		JSON.parse(
			readFileSync(join(dirname(path), '../package.json'), 'utf8'),
		),
	);
	guard(pkg['name'] === 'vercel' && pkg['version'] === '59.5.0');
	return path;
}
function api(cli: string, path: string) {
	return object(
		jsonCommand(process.execPath, [
			cli,
			'--non-interactive',
			'api',
			`${path}${path.includes('?') ? '&' : '?'}teamId=${team}`,
			'--raw',
		]),
	);
}
function requireLocal(sha?: string) {
	guard(
		Number(process.versions.node.split('.')[0]) === 24 &&
			git(['branch', '--show-current']) === 'main' &&
			git(['status', '--porcelain']) === '',
	);
	const head = git(['rev-parse', 'HEAD']);
	guard(/^[a-f0-9]{40}$/.test(head) && (!sha || head === sha));
	guard(git(['log', '-1', '--format=%G? %GS']) === 'G inasusr@gmail.com');
	guard(
		[
			'git@github.com:irackson/givetogive.git',
			'https://github.com/irackson/givetogive.git',
		].includes(git(['remote', 'get-url', 'origin'])),
	);
	const link = object(
		JSON.parse(readFileSync(join(root, '.vercel/project.json'), 'utf8')),
	);
	guard(
		link['projectId'] === releaseTargets.production.project &&
			link['orgId'] === team,
	);
	const config = object(
		JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')),
	);
	guard(object(config['git'])['deploymentEnabled'] === false);
	return head;
}
export async function controlledRelease(args: readonly string[]) {
	const options = parseReleaseArguments(args);
	if (options.mode === 'help')
		return {
			execute: false,
			externalRequests: 0,
			usage: 'node scripts/controlled-release.ts --inspect|--deploy --target staging|production',
		};
	const target = releaseTargets[options.target!],
		sha = requireLocal(),
		cli = cliPath();
	// Native context resolution must not silently link or select another project.
	command(process.execPath, [
		cli,
		'--non-interactive',
		'project',
		'inspect',
		target.name,
		'--scope',
		team,
	]).fill(0);
	const remoteMain = object(
		jsonCommand('gh', ['api', 'repos/irackson/givetogive/commits/main']),
	);
	guard(remoteMain['sha'] === sha);
	const runs = object(
		jsonCommand('gh', [
			'api',
			`repos/irackson/givetogive/actions/workflows/verify.yml/runs?branch=main&head_sha=${sha}&per_page=20`,
		]),
	);
	guard(Array.isArray(runs['workflow_runs']));
	const ciPassed = verifiedReleaseCi(runs['workflow_runs'] as CiRun[], sha);
	const settings = api(cli, `/v9/projects/${target.project}`),
		alias = api(cli, `/v4/aliases/${target.host}`);
	guard(
		settings['id'] === target.project &&
			settings['accountId'] === team &&
			settings['name'] === target.name &&
			settings['nodeVersion'] === '24.x' &&
			object(settings['ssoProtection'])['deploymentType'] ===
				target.protection &&
			alias['projectId'] === target.project,
	);
	const deployment = api(
			cli,
			`/v13/deployments/${String(object(alias['deployment'])['id'])}`,
		),
		metadata = object(deployment['meta']);
	guard(
		deployment['projectId'] === target.project &&
			deployment['readyState'] === 'READY',
	);
	const deployedSha = metadata['githubCommitSha'];
	guard(
		typeof deployedSha === 'string' && /^[a-f0-9]{40}$/.test(deployedSha),
	);
	const changedPaths = git(['diff', '--name-only', deployedSha, sha])
		.split('\n')
		.filter(Boolean);
	const changes = changedPaths.filter(releaseRelevantPath);
	const receipt = {
		observedAt: new Date().toISOString(),
		target: options.target,
		project: target.project,
		sourceSha: sha,
		deployedSha,
		ciPassed,
		releaseRelevantChanges: changes,
		deploymentNeeded: changes.length > 0,
		submitted: false,
	};
	if (options.mode === 'inspect' || !changes.length) return receipt;
	guard(ciPassed);
	const busy = api(cli, '/v6/deployments?limit=100');
	guard(Array.isArray(busy['deployments']));
	guard(
		!(busy['deployments'] as Record<string, unknown>[]).some(
			(d) =>
				Object.values(releaseTargets).some(
					(t) => t.project === d['projectId'],
				) &&
				['QUEUED', 'INITIALIZING', 'BUILDING'].includes(
					String(d['state'] ?? d['readyState']),
				),
		),
	);
	const runtimeBytes = command(process.execPath, [
		cli,
		'curl',
		'/api/trpc/billing.availability',
		'--deployment',
		`https://${target.host}`,
		'--scope',
		team,
		'--',
		'--silent',
		'--show-error',
		'--fail',
		'--max-time',
		'30',
	]);
	let gates: Record<string, unknown>;
	try {
		gates = object(
			object(object(JSON.parse(runtimeBytes.toString()))['result'])[
				'data'
			],
		);
		gates = object(gates['json']);
	} finally {
		runtimeBytes.fill(0);
	}
	guard(
		gates['environment'] === options.target && gates['livemode'] === false,
	);
	if (options.target === 'production')
		guard(
			gates['askPayments'] === false &&
				gates['subscriptions'] === false &&
				gates['funds'] === false,
		);
	const dry = object(
		jsonCommand(process.execPath, [
			cli,
			'deploy',
			'--dry',
			'--json',
			'--project',
			target.project,
			'--scope',
			team,
			'--yes',
		]),
	);
	guard(Array.isArray(dry['files']));
	const files = dry['files'] as { path: string; sha: string; size: number }[];
	guard(
		files.every(
			(f) => typeof f.path === 'string' && !privateDeploymentPath(f.path),
		) &&
			files.some((f) => f.path === 'vercel.json') &&
			files.some((f) => f.path === 'src/server/db/schema.ts'),
	);
	const uploadDigest = createHash('sha256')
		.update(
			JSON.stringify(
				files
					.filter((f) => f.size > 0)
					.map((f) => [f.path, f.sha])
					.sort(),
			),
		)
		.digest('hex');
	const authoredSourceDigest = releaseSourceDigest(root),
		lockDigest = createHash('sha256')
			.update(readFileSync(join(root, 'package-lock.json')))
			.digest('hex');
	requireLocal(sha);
	guard(
		object(
			jsonCommand('gh', [
				'api',
				'repos/irackson/givetogive/commits/main',
			]),
		)['sha'] === sha,
	);
	guard(
		object(api(cli, `/v4/aliases/${target.host}`)['deployment'])['id'] ===
			deployment['id'],
	);
	const state = join(root, 'tmp/controlled-releases');
	mkdirSync(state, { recursive: true });
	const lock = join(state, 'active.lock'),
		intent = join(state, `${options.target}-${sha}.json`);
	guard(!existsSync(intent));
	writeFileSync(
		lock,
		JSON.stringify({ target: options.target, sha, intent }),
		{ flag: 'wx' },
	);
	try {
		writeFileSync(
			intent,
			JSON.stringify(
				{
					...receipt,
					uploadDigest,
					authoredSourceDigest,
					lockDigest,
					state: 'requesting; reconcile provider before retry',
					retryAllowed: false,
				},
				null,
				2,
			),
			{ flag: 'wx' },
		);
		const submitted = object(
			jsonCommand(process.execPath, [
				cli,
				'deploy',
				'--prod',
				'--project',
				target.project,
				'--scope',
				team,
				'--yes',
				'--no-wait',
				'--json',
				'--meta',
				`controlledReleaseSha=${sha}`,
				'--meta',
				`controlledUploadDigest=${uploadDigest}`,
				'--meta',
				`verificationAuthoredSourceDigest=${authoredSourceDigest}`,
				'--meta',
				`verificationLockDigest=${lockDigest}`,
				'--meta',
				`verificationSourceDigest=${uploadDigest}`,
			]),
		);
		const value =
			submitted['deployment'] ?
				object(submitted['deployment'])
			:	submitted;
		guard(
			typeof value['id'] === 'string' &&
				/^dpl_[a-zA-Z0-9]+$/.test(value['id']),
		);
		const result = {
			...receipt,
			uploadDigest,
			authoredSourceDigest,
			lockDigest,
			submitted: true,
			deploymentId: value['id'],
			status: value['readyState'],
		};
		writeFileSync(intent, JSON.stringify(result, null, 2));
		guard(
			api(cli, `/v13/deployments/${value['id']}`)['projectId'] ===
				target.project,
		);
		// Keep the lease until a separate readback confirms terminal publication.
		return result;
	} catch {
		return fail();
	}
}
/** Readback is separate from submission and never retries a deployment. */
export function reconcileControlledRelease() {
	const cli = cliPath(),
		state = join(root, 'tmp/controlled-releases'),
		lock = join(state, 'active.lock');
	const lease = object(JSON.parse(readFileSync(lock, 'utf8'))),
		targetName = lease['target'];
	guard(targetName === 'production' || targetName === 'staging');
	const target = releaseTargets[targetName],
		sha = lease['sha'];
	guard(typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha));
	const intent = join(state, `${targetName}-${sha}.json`),
		receipt = object(JSON.parse(readFileSync(intent, 'utf8')));
	guard(
		receipt['sourceSha'] === sha &&
			receipt['project'] === target.project &&
			typeof receipt['deploymentId'] === 'string' &&
			/^dpl_[a-zA-Z0-9]+$/.test(receipt['deploymentId']),
	);
	const d = api(cli, `/v13/deployments/${receipt['deploymentId']}`);
	guard(d['projectId'] === target.project);
	const status = d['readyState'];
	guard(typeof status === 'string');
	const canonical =
		object(api(cli, `/v4/aliases/${target.host}`)['deployment'])['id'] ===
		d['id'];
	if (status === 'READY')
		guard(
			canonical &&
				object(d['meta'])['controlledReleaseSha'] === sha &&
				object(d['meta'])['controlledUploadDigest'] ===
					receipt['uploadDigest'] &&
				object(d['meta'])['verificationSourceDigest'] ===
					receipt['uploadDigest'] &&
				object(d['meta'])['verificationAuthoredSourceDigest'] ===
					receipt['authoredSourceDigest'] &&
				object(d['meta'])['verificationLockDigest'] ===
					receipt['lockDigest'],
		);
	if (['READY', 'ERROR', 'CANCELED'].includes(status)) {
		writeFileSync(
			join(state, `${targetName}-${sha}.terminal.json`),
			JSON.stringify({
				observedAt: new Date().toISOString(),
				deploymentId: d['id'],
				status,
				canonical,
			}),
			{ flag: 'wx' },
		);
		unlinkSync(lock);
	}
	return {
		deploymentId: d['id'],
		status,
		canonical,
		deploymentRetried: false,
	};
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	Promise.resolve()
		.then(async () =>
			process.argv.length === 3 && process.argv[2] === '--reconcile' ?
				reconcileControlledRelease()
			:	await controlledRelease(process.argv.slice(2)),
		)
		.then((result) => console.log(JSON.stringify(result)))
		.catch(() => {
			console.error(
				'Controlled release refused; no automatic retry. Private diagnostics withheld.',
			);
			process.exitCode = 1;
		});
}
