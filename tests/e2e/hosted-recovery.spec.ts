import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('hosted recovery workflow executes an empty staging queue to completion', async ({
	page,
	baseURL,
}) => {
	test.skip(
		process.env['HOSTED_RECOVERY_SMOKE'] !== '1',
		'Explicit hosted execution probe; not a payment test.',
	);
	test.setTimeout(120_000);
	expect(baseURL).toBe('https://givetogive-staging.vercel.app');
	expect(process.env['APP_ENV']).toBe('staging');
	const [queue] = await testSql`SELECT
		(SELECT count(*)::int FROM givetogive_payment) AS payments,
		(SELECT count(*)::int FROM givetogive_payment_webhook_inbox) AS webhooks,
		(SELECT count(*)::int FROM givetogive_fund_allocation) AS allocations`;
	if (Object.values(queue!).some((count) => Number(count) !== 0))
		throw new Error(
			'This probe requires genuinely empty staging financial queues.',
		);
	const members = await makeMembers();
	try {
		await testSql`UPDATE givetogive_user SET role='admin' WHERE id=${members[0].id} AND is_synthetic=true`;
		await login(page, members[0]);
		const started = await rpc(
			page.request,
			'billing.adminReconcile',
			undefined,
		);
		expect(started.status).toBe(200);
		const runId = String(started.data?.['runId'] ?? '');
		expect(/^w?run_[A-Za-z0-9]+$/.test(runId)).toBe(true);
		let status: string | undefined;
		await expect
			.poll(
				async () => {
					const { stdout } = await promisify(execFile)(
						process.execPath,
						[
							'node_modules/workflow/bin/run.js',
							'inspect',
							'run',
							runId,
							'--backend',
							'vercel',
							'--project',
							'prj_HvlFV1kKHVsML73nlsJAFQNA7grP',
							'--team',
							'team_TXid48wU77cfhEg28L3EyLpn',
							'--env',
							'production',
							'--json',
						],
						{
							windowsHide: true,
							timeout: 20_000,
							// This checkout intentionally stays linked to production. Prevent the
							// Workflow CLI from re-inferring it when a project name is absent.
							env: {
								...process.env,
								WORKFLOW_VERCEL_PROJECT_NAME:
									'givetogive-staging',
							},
						},
					);
					const result: unknown = JSON.parse(stdout);
					if (
						!result ||
						typeof result !== 'object' ||
						!('status' in result)
					)
						throw new Error(
							'Unexpected hosted workflow metadata shape.',
						);
					status = String(result.status);
					return status;
				},
				{ timeout: 90_000, intervals: [1_000, 3_000, 5_000] },
			)
			.toBe('completed');
		await mkdir('tmp/payments-verification', { recursive: true });
		await writeFile(
			'tmp/payments-verification/hosted-recovery.json',
			JSON.stringify(
				{
					runId,
					status,
					checkedAt: new Date().toISOString(),
					origin: baseURL,
					disclosure:
						'Actual hosted durable workflow; empty synthetic financial queues, no Stripe calls or payment lifecycle claims.',
				},
				null,
				2,
			),
		);
		console.log(
			`Hosted empty-queue recovery verified: ${runId} (${status}).`,
		);
	} finally {
		await cleanMembers(members.map(({ id }) => id));
	}
});
