import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	releaseRelevantPath,
	privateDeploymentPath,
	verifiedReleaseCi,
	parseReleaseArguments,
	releaseTargets,
} from '../../scripts/controlled-release.ts';
test('checkpoint/tooling changes do not qualify as app releases; runtime and deployment config do', () => {
	for (const path of [
		'docs/AGENT-HANDOFF.md',
		'tests/unit/asks.test.ts',
		'tools/simulation/src/runner.ts',
		'scripts/capture.ts',
		'.github/workflows/verify.yml',
		'src/app/.well-known/workflow/route.ts',
	])
		assert.equal(releaseRelevantPath(path), false);
	for (const path of [
		'src/app/page.tsx',
		'src\\server\\auth\\tokens.ts',
		'public/hero.png',
		'package.json',
		'package-lock.json',
		'vercel.json',
		'.vercelignore',
		'.npmrc',
		'next.config.ts',
	])
		assert.equal(releaseRelevantPath(path), true);
});
test('deploy inputs reject credentials, private state, tests and generated workflow files', () => {
	for (const path of [
		'.env.local',
		'.env.production.hosted',
		'.github/workflows/verify.yml',
		'tmp/x.json',
		'tools/simulation/.state/credentials.json',
		'x.pem',
		'output/pdf/x.pdf',
		'src/app/.well-known/workflow/route.ts',
	])
		assert.equal(privateDeploymentPath(path), true);
	for (const path of ['src/app/page.tsx', 'public/hero.png', 'vercel.json'])
		assert.equal(privateDeploymentPath(path), false);
});
test('CI requires exact main SHA, successful terminal first attempt and trusted event', () => {
	const sha = 'a'.repeat(40),
		run = {
			head_sha: sha,
			head_branch: 'main',
			event: 'push',
			status: 'completed',
			conclusion: 'success',
			run_attempt: 1,
		};
	assert.equal(verifiedReleaseCi([run], sha), true);
	for (const change of [
		{ head_sha: 'b'.repeat(40) },
		{ head_branch: 'feature' },
		{ event: 'pull_request' },
		{ status: 'in_progress' },
		{ conclusion: 'failure' },
		{ run_attempt: 2 },
	])
		assert.equal(verifiedReleaseCi([{ ...run, ...change }], sha), false);
	assert.equal(verifiedReleaseCi([], sha), false);
});
test('only explicit two-project scope is accepted and default invocation is inert', () => {
	assert.equal(parseReleaseArguments([]).mode, 'help');
	assert.equal(
		parseReleaseArguments(['--inspect', '--target', 'staging']).target,
		'staging',
	);
	assert.equal(
		parseReleaseArguments(['--deploy', '--target', 'production']).mode,
		'deploy',
	);
	for (const args of [
		['--deploy'],
		['--deploy', '--target', 'other'],
		['--deploy', '--target', 'production', '--force'],
	])
		assert.throws(() => parseReleaseArguments(args));
	assert.deepEqual(Object.keys(releaseTargets).sort(), [
		'production',
		'staging',
	]);
	const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
	assert.equal(config.git.deploymentEnabled, false);
	const output = JSON.parse(
		execFileSync(process.execPath, ['scripts/controlled-release.ts'], {
			encoding: 'utf8',
		}),
	);
	assert.equal(output.execute, false);
	assert.equal(output.externalRequests, 0);
});
