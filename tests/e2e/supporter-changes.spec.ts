import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';

// These are real browser/authorization checks, not evidence of paid provider
// upgrades. Never synthesize paid subscriptions or coverage for these tests.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let members: Awaited<ReturnType<typeof makeMembers>>;

test.beforeAll(async () => {
	members = await makeMembers();
});
test.afterAll(async () => {
	if (members) await cleanMembers(members.map(({ id }) => id));
});

test('membership changes require an authenticated account', async ({
	request,
}) => {
	const operationId = randomUUID();
	for (const [procedure, input, method] of [
		['billing.listSupporterChanges', { limit: 50 }, 'get'],
		['billing.supporterChangeStatus', { operationId }, 'get'],
		[
			'billing.previewSupporterChange',
			{
				operationId,
				subscriptionId: 'sub_unknownE2E',
				action: 'upgrade',
				expectedRevision: 0,
			},
			'post',
		],
		['billing.confirmSupporterChange', { operationId }, 'post'],
	] as const) {
		expect((await rpc(request, procedure, input, method)).status).toBe(401);
	}
});

test('a free member sees honest billing and recognition without upgrade controls', async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.name));
	await login(page, members[0]);
	await page.goto('/account/billing');
	await expect(
		page.getByRole('heading', { name: 'No membership to change yet.' }),
	).toBeVisible();
	await expect(
		page.getByText('Current paid recognition', { exact: true }),
	).toBeVisible();
	await expect(page.getByText('Neighbor', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', {
			name: 'Preview Sustainer upgrade',
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		page.getByRole('button', {
			name: 'Preview period-end cancellation',
			exact: true,
		}),
	).toHaveCount(0);
	const list = await rpc(
		page.request,
		'billing.listSupporterChanges',
		{ limit: 50 },
		'get',
	);
	expect(list.status).toBe(200);
	expect(list.data).toEqual([]);
	await page.goto('/support');
	await expect(
		page.getByText('Your current recognition: Neighbor.', { exact: true }),
	).toBeVisible();
	expect(pageErrors).toEqual([]);
});

test('unknown change IDs cannot be read or confirmed and create no financial record', async ({
	page,
}) => {
	await login(page, members[1]);
	const operationId = randomUUID();
	expect(
		(
			await rpc(
				page.request,
				'billing.supporterChangeStatus',
				{ operationId },
				'get',
			)
		).status,
	).toBe(404);
	const confirm = await rpc(page.request, 'billing.confirmSupporterChange', {
		operationId,
	});
	// A disabled payment gate may reject before the operation lookup. Neither
	// path is success and neither is permission to create a replacement charge.
	expect([404, 412]).toContain(confirm.status);
	const [payments] =
		await testSql`SELECT count(*)::int AS count FROM givetogive_payment WHERE actor_id=${members[1].id}`;
	const [subscriptions] =
		await testSql`SELECT count(*)::int AS count FROM givetogive_payment_subscription WHERE actor_id=${members[1].id}`;
	expect(payments?.['count']).toBe(0);
	expect(subscriptions?.['count']).toBe(0);
});

test('recognition reconciliation details stay private to the profile owner', async ({
	page,
	request,
}) => {
	await login(page, members[2]);
	const own = await rpc(
		page.request,
		'user.getProfile',
		{ id: members[2].id, page: 1 },
		'get',
	);
	expect(own.status).toBe(200);
	expect(own.data?.['ownRecognitionStatus']).toBe('ready');
	expect(own.data?.['ownSupporterTier']).toBe('neighbor');
	await page.goto(`/members/${members[2].id}`);
	await page
		.getByRole('button', { name: 'Edit profile', exact: true })
		.click();
	await expect(
		page
			.getByRole('dialog')
			.getByText(/You currently participate as a free Neighbor/),
	).toBeVisible();
	const publicProfile = await rpc(
		request,
		'user.getProfile',
		{ id: members[2].id, page: 1 },
		'get',
	);
	expect(publicProfile.status).toBe(200);
	expect(publicProfile.data).not.toHaveProperty('ownRecognitionStatus');
	expect(publicProfile.data).not.toHaveProperty('ownSupporterTier');
	expect(publicProfile.data?.['supporterTier']).toBeNull();
});

test('unverifiable clock evidence shows pending, never a free downgrade, only to its owner', async ({
	page,
	request,
}) => {
	// Deliberately invalid, failed operational evidence tests the fail-closed UI.
	// No clock, provider account, subscription, payment or paid coverage is made.
	await testSql`INSERT INTO givetogive_operation_event
		(external_id, environment, actor_id, entity_type, action, outcome, summary)
		VALUES (${`e2e-invalid-clock-${randomUUID()}`}, ${process.env['APP_ENV']!}, ${members[1].id},
		'simulation_clock', 'simulation_clock_bind', 'failed',
		'Deliberately malformed synthetic UI fixture; no Stripe clock was created.')`;
	await login(page, members[1]);
	await page.goto('/account/billing');
	await expect(
		page.getByText('Reconciliation pending', { exact: true }),
	).toBeVisible();
	await expect(page.getByText('Neighbor', { exact: true })).toHaveCount(0);
	await page.goto('/support');
	await expect(
		page.getByText(
			'Your paid recognition is being reconciled. This does not mean your membership has been downgraded.',
			{ exact: true },
		),
	).toBeVisible();
	await page.goto(`/members/${members[1].id}`);
	await page
		.getByRole('button', { name: 'Edit profile', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await expect(
		dialog.getByText(/Your paid recognition is being reconciled/),
	).toBeVisible();
	await expect(
		dialog.getByText(/You currently participate as a free Neighbor/),
	).toHaveCount(0);
	const own = await rpc(
		page.request,
		'user.getProfile',
		{ id: members[1].id, page: 1 },
		'get',
	);
	expect(own.data?.['ownRecognitionStatus']).toBe('pending');
	const publicProfile = await rpc(
		request,
		'user.getProfile',
		{ id: members[1].id, page: 1 },
		'get',
	);
	expect(publicProfile.data).not.toHaveProperty('ownRecognitionStatus');
	expect(publicProfile.data?.['supporterTier']).toBeNull();
	// The failed, explicitly synthetic marker remains in append-only audit
	// history; exact temporary member identities are removed by afterAll.
});
