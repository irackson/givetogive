// Run only a private source snapshot against the reviewed production-data copy.
// No migration, seeding, provider credential or deployment operation lives here.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
import { releaseRehearsalEnvironment, verifyReleaseRehearsalBinding, RELEASE_REHEARSAL_TARGET } from './release-rehearsal-environment.ts';
import { readMigrationFiles, verifyMigrationHistory } from './migration-history.ts';
import { releaseSourceDigest, releaseGeneratedWorkflowDigest } from './release-rehearsal-fingerprint.mjs';

const command = process.argv[2], snapshotName = process.argv[3];
const port = Number(process.argv[4] ?? 3111);
let phase = 'configuration', connection, child;
try {
	if (!['check', 'build', 'start'].includes(command ?? '') || !/^release-(old-e2cd44d|current-[a-f0-9]{12})$/.test(snapshotName ?? ''))
		throw new Error('Expected an explicit private rehearsal snapshot and command.');
	const snapshot = resolve('tmp', snapshotName), parent = resolve('tmp');
	if (!snapshot.startsWith(`${parent}\\`) && !snapshot.startsWith(`${parent}/`))
		throw new Error('Snapshot escaped the private workspace directory.');
	if (!existsSync(snapshot) || lstatSync(snapshot).isSymbolicLink()) throw new Error('Snapshot is unavailable.');
	// Next loads env files from the project directory. Refuse any fallback file,
	// including an accidentally copied production .env.local or environment file.
	if (readdirSync(snapshot).some(name => /^\.env($|\.)/.test(name) && name !== '.env.example'))
		throw new Error('Rehearsal snapshots cannot contain environment files.');
	const env = releaseRehearsalEnvironment(process.env, port);
	phase = 'live-copy-binding';
	connection = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice() {},
		connection: { default_transaction_read_only: true, statement_timeout: 15000, lock_timeout: 3000 } });
	const [binding] = await connection`select current_database() as database,current_setting('neon.project_id',true) as project,current_setting('neon.branch_id',true) as branch`;
	verifyReleaseRehearsalBinding(binding);
	const history = verifyMigrationHistory(readMigrationFiles(), await connection`select hash,created_at from drizzle.__drizzle_migrations order by created_at,id`);
	if (history.appliedMigrationCount !== 19 || history.pendingMigrations.length)
		throw new Error('The copied schema is not ready for app compatibility testing.');
	await connection.end(); connection = undefined;
	const sourceDigest = releaseSourceDigest(snapshot);
	if (command === 'check') {
		console.log(JSON.stringify({ rehearsal: 'preflight-passed', snapshot: snapshotName, sourceDigest,
			targetBranch: RELEASE_REHEARSAL_TARGET.branch, migrations: history.appliedMigrationCount,
			paymentsDisabled: true, externalEmailDisabled: true, simulationDisabled: true, productionWrites: false,
			appCompatibilityVerified: false }));
	} else {
		phase = 'resource-admission';
		const avoidedPid = Number(process.env.REHEARSAL_AVOID_PID ?? 0);
		if (Number.isSafeInteger(avoidedPid) && avoidedPid > 0) {
			let live = false;
			try { process.kill(avoidedPid, 0); live = true; }
			catch (error) { if (error.code !== 'ESRCH') throw error; }
			if (live) throw new Error('The selected acceptance process must finish before rehearsal.');
		}
		const minimumGiB = command === 'build' ? 4 : 1.5;
		if (freemem() < minimumGiB * 2 ** 30) throw new Error('Insufficient measured memory headroom for rehearsal.');
		const manifestPath = join(snapshot, '.release-rehearsal-build.json');
		if (command === 'start') {
			phase = 'built-source-binding';
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			if (manifest.sourceDigest !== sourceDigest || manifest.targetBranch !== RELEASE_REHEARSAL_TARGET.branch ||
				(manifest.generatedWorkflowDigest ?? null) !== releaseGeneratedWorkflowDigest(snapshot) ||
				manifest.buildId !== readFileSync(join(snapshot, '.next', 'BUILD_ID'), 'utf8').trim())
				throw new Error('The private production build does not match this source snapshot.');
		}
		phase = command;
		const cli = join(snapshot, 'node_modules', 'next', 'dist', 'bin', 'next');
		if (!existsSync(cli)) throw new Error('Install the snapshot lockfile dependencies first.');
		// Diagnostics are counted, not serialized: baseline Auth.js/database errors
		// may contain private SQL parameters. Inspect a broken boundary separately.
		child = spawn(process.execPath, [cli, command,
			...(command === 'start' ? ['--hostname', '127.0.0.1', '--port', String(port)] : [])],
			{ cwd: snapshot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let diagnosticChunks = 0;
		child.stdout.on('data', () => {});
		child.stderr.on('data', () => { diagnosticChunks++; });
		console.log(JSON.stringify({ rehearsal: 'process-started', command, snapshot: snapshotName,
			childPid: child.pid, port: command === 'start' ? port : undefined, sourceDigest,
			paymentsDisabled: true, externalEmailDisabled: true, productionWrites: false }));
		const stop = () => { child?.kill('SIGTERM'); };
		process.once('SIGINT', stop); process.once('SIGTERM', stop);
		const code = await new Promise((resolveCode, reject) => {
			child.once('error', () => reject(new Error('Rehearsal process failed to launch.')));
			child.once('exit', (exitCode) => resolveCode(exitCode ?? 1));
		});
		process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
		if (code !== 0) throw new Error('The rehearsal process did not finish successfully.');
		if (command === 'build') {
			if (releaseSourceDigest(snapshot) !== sourceDigest) throw new Error('Authored source changed during the build.');
			writeFileSync(manifestPath, JSON.stringify({ observedAt: new Date().toISOString(), sourceDigest,
				generatedWorkflowDigest: releaseGeneratedWorkflowDigest(snapshot),
				targetBranch: RELEASE_REHEARSAL_TARGET.branch, buildId: readFileSync(join(snapshot, '.next', 'BUILD_ID'), 'utf8').trim(),
				paymentsDisabled: true, externalEmailDisabled: true, diagnosticChunks }, null, 2));
		}
		console.log(JSON.stringify({ rehearsal: 'process-finished', command, code, diagnosticChunks,
			productionWrites: false, browserCompatibilityVerified: false }));
	}
} catch {
	console.error(JSON.stringify({ rehearsal: 'incomplete', phase, productionWrites: false, privateDetails: 'withheld' }));
	process.exitCode = 1;
} finally { await connection?.end(); }
