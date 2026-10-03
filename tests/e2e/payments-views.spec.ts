import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';

// These flows display temporary authenticator secrets and enter credentials.
// Never retain DOM snapshots, traces, videos, or failure screenshots for them.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

let members: Awaited<ReturnType<typeof makeMembers>>;
const createdRuns: string[] = [];

test.beforeAll(async () => {
	members = await makeMembers();
	await testSql`UPDATE givetogive_user SET role='admin' WHERE id=${members[2].id} AND is_synthetic=true`;
});

test.afterAll(async () => {
	if (members) {
		// A failed navigation may occur after a successful create response. Resolve
		// only this fixture administrator's exact IDs so cleanup still works.
		const owned = await testSql<
			{ id: string }[]
		>`SELECT id FROM givetogive_simulation_run WHERE created_by=${members[2].id}`;
		for (const run of owned)
			if (!createdRuns.includes(run.id)) createdRuns.push(run.id);
	}
	if (members && createdRuns.length) {
		await testSql`DELETE FROM givetogive_simulation_command WHERE run_id IN ${testSql(createdRuns)} AND actor_id=${members[2].id}`;
		await testSql`DELETE FROM givetogive_simulation_run WHERE id IN ${testSql(createdRuns)} AND created_by=${members[2].id}`;
	}
	if (members) await cleanMembers(members.map(({ id }) => id));
});

async function enrollAuthenticator(page: Page) {
	await page.goto('/account/security');
	await page
		.getByRole('button', { name: 'Set up authenticator', exact: true })
		.click();
	const key = page.getByLabel('Authenticator setup key', { exact: true });
	await expect(key).toBeVisible();
	const secret = await key.inputValue();
	// Assert only a boolean so even an assertion failure cannot print the secret.
	expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
	const code = await generate({ secret });
	await page
		.getByLabel('Six-digit authenticator code', { exact: true })
		.fill(code);
	await page
		.getByRole('button', { name: 'Confirm authenticator', exact: true })
		.click();
	await expect(
		page.getByText('Your authenticator is enabled.', { exact: false }),
	).toBeVisible();
	await expect(key).toHaveCount(0);
	return { secret, code };
}

test('a deterministic simulation record waits for local provisioning and cannot pretend to start agents', async ({
	page,
}) => {
	await login(page, members[2]);
	const runs = await rpc(page.request, 'admin.simulations', undefined, 'get');
	test.skip(
		!runs.data?.['enabled'],
		'Simulation provisioning is only enabled in isolated staging.',
	);
	await page.goto('/admin/simulations');
	await page
		.getByRole('button', { name: 'Create simulation run', exact: true })
		.click();
	await page
		.getByLabel('Run name', { exact: true })
		.fill(`Browser fixture ${members[2].id}`);
	await page.getByRole('combobox', { name: 'Simulation mode' }).click();
	await page
		.getByRole('option', {
			name: 'Deterministic scenarios · repeatable regression',
			exact: true,
		})
		.click();
	await page.getByRole('combobox', { name: 'Total independent accounts' }).click();
	await page.getByRole('option', { name: '10', exact: true }).click();
	const createdResponse = page.waitForResponse(
		(response) =>
			response.url().includes('admin.createSimulation') &&
			response.request().method() === 'POST',
	);
	await page
		.getByRole('button', { name: 'Create run record', exact: true })
		.click();
	const response = await createdResponse;
	if (new URL(page.url()).protocol !== 'https:') {
		// The loopback production wrapper deliberately uses an HTTP APP_URL.
		// Creation must retain the distinct HTTPS staging guard, not silently
		// start a simulator against an origin that the runner cannot attest.
		expect(response.ok()).toBe(false);
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page).toHaveURL(/\/admin\/simulations$/);
		const [created] =
			await testSql`SELECT count(*)::int AS count FROM givetogive_simulation_run WHERE created_by=${members[2].id}`;
		expect(created?.['count']).toBe(0);
		return;
	}
	expect(response.ok()).toBe(true);
	await expect(page).toHaveURL(/\/admin\/simulations\/[a-f0-9-]+$/);
	const runId = new URL(page.url()).pathname.split('/').at(-1)!;
	createdRuns.push(runId);
	await expect(
		page.getByRole('heading', {
			name: 'A run record is not a running neighborhood.',
		}),
	).toBeVisible();
	await expect(
		page.getByText('Deterministic scenario run', { exact: false }),
	).toBeVisible();
	await expect(
		page.getByText(
			'node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id',
			{ exact: false },
		),
	).toContainText(runId);
	await expect(
		page.getByRole('button', { name: 'Request start', exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Apply pace', exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole('heading', { name: '0 of 0 registered agents' }),
	).toBeVisible();
	const [run] =
		await testSql`SELECT status,mode,agent_count,started_at FROM givetogive_simulation_run WHERE id=${runId} AND created_by=${members[2].id}`;
	expect(run?.['status']).toBe('created');
	expect(run?.['mode']).toBe('deterministic');
	expect(run?.['agent_count']).toBe(10);
	expect(run?.['started_at']).toBeNull();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test('guests must sign in for private giving, account, and admin pages', async ({
	page,
	request,
}) => {
	for (const path of [
		'/giving',
		'/account/billing',
		'/account/receiving',
		'/account/security',
		'/admin',
	]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/signin\?/);
		const url = new URL(page.url());
		expect(url.searchParams.get('callbackUrl')).toBe(path);
		await expect(
			page.getByRole('button', { name: 'Sign in', exact: true }),
		).toBeVisible();
	}
	await page.goto(`/giving/${members[0].id}`);
	await expect(page).toHaveURL(/\/signin\?/);
	expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/giving');
	expect(
		(await rpc(request, 'admin.overview', undefined, 'get')).status,
	).toBe(401);
	expect(
		(await rpc(request, 'billing.myOverview', undefined, 'get')).status,
	).toBe(401);
});

test('ordinary members cannot read admin pages or call financial admin procedures', async ({
	page,
}) => {
	await login(page, members[0]);
	for (const path of [
		'/admin',
		'/admin/activity',
		'/admin/payments',
		'/admin/users',
		'/admin/simulations',
	]) {
		await page.goto(path);
		await expect(
			page.getByRole('heading', { name: 'This page is not here.' }),
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'GiveToGive operations' }),
		).toHaveCount(0);
	}
	expect(
		(await rpc(page.request, 'admin.overview', undefined, 'get')).status,
	).toBe(403);
	expect(
		(await rpc(page.request, 'admin.activity', { limit: 10 }, 'get'))
			.status,
	).toBe(403);
	expect(
		(await rpc(page.request, 'billing.adminReconcile', undefined)).status,
	).toBe(403);
	expect(
		(await rpc(page.request, 'security.elevate', { code: '000000' }))
			.status,
	).toBe(403);
});

test('disabled payments are explicit and a new member has genuine empty giving records', async ({
	page,
}) => {
	const available = await rpc(
		page.request,
		'billing.availability',
		undefined,
		'get',
	);
	expect(available.status).toBe(200);
	test.skip(
		Boolean(available.data?.['enabled']),
		'This case verifies the intentionally disabled-payment configuration.',
	);
	await login(page, members[1]);
	await expect(
		page.getByRole('link', { name: /03 Money pledges/ }),
	).toContainText('Ask payments are not enabled here');
	await page.goto('/support');
	const unavailable = page.getByRole('button', {
		name: 'Subscriptions not yet available',
		exact: true,
	});
	await expect(unavailable).toHaveCount(2);
	await expect(unavailable.nth(0)).toBeDisabled();
	await expect(unavailable.nth(1)).toBeDisabled();
	await expect(page.getByRole('note')).toContainText('No real money moves.');
	await page.goto('/funds');
	await expect(
		page.getByText(
			'Community-fund payments are not enabled in this environment.',
			{ exact: false },
		),
	).toBeVisible();
	await page.goto('/account/receiving');
	await expect(
		page.getByRole('button', { name: 'Set up receiving with Stripe' }),
	).toBeDisabled();
	await expect(
		page.getByText(
			'Recipient onboarding is not enabled in this environment yet.',
		),
	).toBeVisible();
	await page.goto('/account/billing');
	await expect(page.getByText('Neighbor', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'No recurring commitments.' }),
	).toBeVisible();
	await page.goto('/giving?checkout=success');
	await expect(
		page.getByRole('heading', {
			name: 'Your first gift starts with a neighbor.',
		}),
	).toBeVisible();
	await expect(
		page.getByText('A return to this page is not proof of payment;', {
			exact: false,
		}),
	).toBeVisible();
	const summary = await rpc(
		page.request,
		'billing.myOverview',
		undefined,
		'get',
	);
	expect(summary.data?.['paidGiving']).toBe(0);
	expect(summary.data?.['pendingGiving']).toBe(0);
	expect(summary.data?.['completedContributions']).toBe(0);
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test('badge preference persists without inventing a paid tier or exposing the preference publicly', async ({
	page,
	request,
}) => {
	const member = members[1];
	await login(page, member);
	await page.goto(`/members/${member.id}`);
	await page.getByRole('button', { name: 'Edit profile' }).click();
	const checkbox = page.getByRole('checkbox', {
		name: 'Show my supporter badge on my public profile',
	});
	await checkbox.check();
	await page
		.getByRole('button', { name: 'Save profile', exact: true })
		.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.reload();
	await page.getByRole('button', { name: 'Edit profile' }).click();
	await expect(checkbox).toBeChecked();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.locator('.profile-supporter-badge')).toHaveCount(0);
	const own = await rpc(
		page.request,
		'user.getProfile',
		{ id: member.id },
		'get',
	);
	expect(own.data?.['showSupporterBadge']).toBe(true);
	expect(own.data?.['ownSupporterTier']).toBe('neighbor');
	expect(own.data?.['supporterTier']).toBeNull();
	const publicProfile = await rpc(
		request,
		'user.getProfile',
		{ id: member.id },
		'get',
	);
	expect(publicProfile.status).toBe(200);
	expect(publicProfile.data?.['supporterTier']).toBeNull();
	expect(publicProfile.data).not.toHaveProperty('showSupporterBadge');
	expect(publicProfile.data).not.toHaveProperty('ownSupporterTier');
});

test('a member enrolls an authenticator without leaking its secret into audit events', async ({
	page,
}) => {
	await login(page, members[0]);
	const { secret, code } = await enrollAuthenticator(page);
	const me = await rpc(page.request, 'security.me', undefined, 'get');
	expect(me.data?.['totpEnabled']).toBe(true);
	expect(me.data).not.toHaveProperty('secret');
	expect(
		(await rpc(page.request, 'security.confirmTotp', { code })).status,
	).toBe(400);
	expect((await rpc(page.request, 'security.beginTotp', {})).status).toBe(
		409,
	);
	const rows =
		await testSql`SELECT action,details,summary FROM givetogive_operation_event WHERE actor_id=${members[0].id}`;
	expect(rows.some((row) => row['action'] === 'totp_enrolled')).toBe(true);
	expect(rows.some((row) => JSON.stringify(row).includes(secret))).toBe(
		false,
	);
	await expect(
		page.getByRole('heading', { name: 'Confirm sensitive actions.' }),
	).toHaveCount(0);
});

test('admin elevation rejects reused authenticator codes and does not persist elevation tokens', async ({
	page,
}) => {
	await login(page, members[2]);
	const { secret, code } = await enrollAuthenticator(page);
	const field = page.getByLabel('Authenticator code', { exact: true });
	await field.fill(code);
	await page
		.getByRole('button', {
			name: 'Authorize sensitive actions',
			exact: true,
		})
		.click();
	await expect(
		page.getByText('Invalid or already used authenticator code.'),
	).toBeVisible();
	// Exercise the supported one-step clock-skew tolerance without waiting or changing clocks.
	const nextCode = await generate({
		secret,
		epoch: Math.floor(Date.now() / 1000) + 30,
	});
	await field.fill(nextCode);
	await page
		.getByRole('button', {
			name: 'Authorize sensitive actions',
			exact: true,
		})
		.click();
	await expect(
		page.getByText('Sensitive actions authorized until', { exact: false }),
	).toBeVisible();
	expect(
		(await rpc(page.request, 'security.elevate', { code: nextCode }))
			.status,
	).toBe(403);
	expect(
		await page.evaluate(() =>
			[...Object.keys(localStorage), ...Object.keys(sessionStorage)].some(
				(key) => /elevation|admin.token/i.test(key),
			),
		),
	).toBe(false);
	await page.reload();
	await expect(
		page.getByText('Sensitive actions authorized until', { exact: false }),
	).toHaveCount(0);
	const rows =
		await testSql`SELECT details,summary FROM givetogive_operation_event WHERE actor_id=${members[2].id}`;
	expect(rows.some((row) => JSON.stringify(row).includes(secret))).toBe(
		false,
	);
});

test('revoking sessions signs out this browser and rejects another existing session', async ({
	page,
	browser,
}) => {
	await login(page, members[0]);
	const other = await browser.newContext({
		baseURL: new URL(page.url()).origin,
	});
	try {
		const otherPage = await other.newPage();
		await login(otherPage, members[0]);
		expect(
			(await rpc(other.request, 'security.me', undefined, 'get')).status,
		).toBe(200);
		await page.goto('/account/security');
		await page
			.getByRole('button', { name: 'Revoke all sessions', exact: true })
			.click();
		await expect(
			page.getByRole('dialog', { name: 'Sign out on every device?' }),
		).toBeVisible();
		await page
			.getByRole('button', { name: 'Keep sessions', exact: true })
			.click();
		expect(
			(await rpc(page.request, 'security.me', undefined, 'get')).status,
		).toBe(200);
		await page
			.getByRole('button', { name: 'Revoke all sessions', exact: true })
			.click();
		await page
			.getByRole('button', { name: 'Revoke and sign out', exact: true })
			.click();
		await expect(page).toHaveURL(/\/signin$/);
		expect(
			(await rpc(other.request, 'security.me', undefined, 'get')).status,
		).toBe(401);
		const [row] =
			await testSql`SELECT session_version FROM givetogive_user WHERE id=${members[0].id}`;
		expect(Number(row?.['session_version'])).toBeGreaterThan(0);
	} finally {
		await other.close();
	}
});

test('admin analytics display actual database totals, exact definitions, and empty checkout state', async ({
	page,
}) => {
	await login(page, members[2]);
	await page.goto('/admin');
	await expect(
		page.getByRole('heading', { name: 'GiveToGive operations' }),
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Thirty days, in context.' }),
	).toBeVisible();
	await expect(page.getByRole('note')).toContainText('synthetic environment');
	const overview = await rpc(
		page.request,
		'admin.overview',
		undefined,
		'get',
	);
	expect(overview.status).toBe(200);
	const metrics = overview.data?.['metrics'] as Array<{
		key: string;
		value: number;
		definition: string;
	}>;
	const [actual] = await testSql`SELECT
		(SELECT count(*)::int FROM givetogive_user) AS members,
		(SELECT coalesce(sum(greatest(0,recipient_amount-refunded_recipient_amount-disputed_amount)),0)::bigint
		 FROM givetogive_payment WHERE livemode=false AND paid_at IS NOT NULL AND kind<>'supporter'
		 AND status IN ('succeeded','partially_refunded','refunded','disputed')) AS net,
		(SELECT count(*)::int FROM givetogive_payment WHERE livemode=false AND checkout_id IS NOT NULL) AS checkouts`;
	expect(metrics.find((metric) => metric.key === 'members')?.value).toBe(
		Number(actual?.['members']),
	);
	expect(metrics.find((metric) => metric.key === 'net_giving')?.value).toBe(
		Number(actual?.['net']),
	);
	expect(metrics.every((metric) => metric.definition.length > 10)).toBe(true);
	if (Number(actual?.['checkouts']) === 0) {
		await expect(
			page.locator('.payment-metric').filter({
				has: page.getByRole('heading', {
					name: 'Checkout completion',
					exact: true,
				}),
			}),
		).toContainText('No checkouts');
	}
	await page
		.getByText('Definitions and exact daily measurements', { exact: true })
		.click();
	const table = page.getByRole('table', {
		name: 'Daily metrics in UTC; missing latency means no measured request, not zero milliseconds.',
	});
	await expect(table).toBeVisible();
	await expect(table.locator('tbody tr')).toHaveCount(30);
	await expect(table).toContainText('Not measured');
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});
