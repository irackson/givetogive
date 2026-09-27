import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';

// Browser authentication/authorization only. No payment, subscription or paid
// coverage fixtures are fabricated; provider cancellation is a separate test.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let members: Awaited<ReturnType<typeof makeMembers>>;
test.beforeAll(async () => {
	members = await makeMembers();
});
test.afterAll(async () => {
	if (members) await cleanMembers(members.map((member) => member.id));
});

async function restrictedSignIn(page: Page, member: (typeof members)[number]) {
	await page.goto('/signin?callbackUrl=/admin');
	await page.getByLabel('Email').fill(member.email);
	await page.getByLabel('Password').fill(member.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/account\/billing$/);
	await expect(
		page.getByText('Restricted billing access', { exact: true }),
	).toBeVisible();
}

test('a fresh verified frozen sign-in is billing-only while old sessions and ordinary APIs remain revoked', async ({
	page,
	browser,
}) => {
	test.setTimeout(90_000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.name));
	await testSql`UPDATE givetogive_user SET role='admin' WHERE id=${members[0].id}`;
	await login(page, members[0]);
	const oldState = await page.context().storageState();
	await testSql`UPDATE givetogive_user SET frozen_at=now(), session_version=session_version+1 WHERE id=${members[0].id}`;
	expect(
		(await rpc(page.request, 'billing.myOverview', undefined, 'get'))
			.status,
	).toBe(401);
	await restrictedSignIn(page, members[0]);
	const session = await (await page.request.get('/api/auth/session')).json();
	expect(session.access).toBe('billing_only');
	const overview = await rpc(
		page.request,
		'billing.myOverview',
		undefined,
		'get',
	);
	expect(overview.status).toBe(200);
	expect(overview.data?.['subscriptions']).toEqual([]);
	// No recurring-fund row means no cancellation action or provider handoff.
	await expect(
		page.getByRole('button', { name: /^Cancel renewal for / }),
	).toHaveCount(0);
	const unknownFund = await rpc(
		page.request,
		'billing.createFundCancellationPortal',
		{ subscriptionId: 'sub_not_owned_by_this_member' },
	);
	expect([404, 412]).toContain(unknownFund.status);
	expect(unknownFund.data).toBeUndefined();
	expect(
		(await rpc(page.request, 'billing.mySubscriptions', undefined, 'get'))
			.data,
	).toEqual([]);
	expect(
		(
			await rpc(
				page.request,
				'billing.listSupporterChanges',
				{ limit: 20 },
				'get',
			)
		).data,
	).toEqual([]);
	for (const [procedure, input, method] of [
		['security.me', undefined, 'get'],
		['billing.myRecipient', undefined, 'get'],
		['billing.adminOperations', undefined, 'get'],
		['billing.createPortal', undefined, 'post'],
		[
			'billing.createCheckout',
			{ operationId: randomUUID(), kind: 'supporter', tier: 'supporter' },
			'post',
		],
		[
			'user.updateProfile',
			{ name: 'Forbidden rename', bio: '', location: '' },
			'post',
		],
		['ask.setSaved', { askId: 1, saved: true }, 'post'],
	] as const)
		expect([401, 403]).toContain(
			(await rpc(page.request, procedure, input, method)).status,
		);
	const oldContext = await browser.newContext({
		storageState: oldState,
		baseURL: new URL(page.url()).origin,
	});
	try {
		expect(
			(
				await rpc(
					oldContext.request,
					'billing.myOverview',
					undefined,
					'get',
				)
			).status,
		).toBe(401);
	} finally {
		await oldContext.close();
	}
	await expect(
		page.getByRole('navigation', { name: 'Your account', exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'My account' })).toHaveCount(
		0,
	);
	await expect(
		page.getByRole('link', { name: 'Compare memberships', exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole('link', { name: /View payments and receipts/ }),
	).toHaveCount(0);
	await expect(
		page.getByRole('button', {
			name: /upgrade|downgrade|resumption|Payment details & invoices/i,
		}),
	).toHaveCount(0);
	await page
		.getByRole('link', { name: /Sign out of restricted access/ })
		.click();
	await expect(
		page.getByRole('heading', { name: 'Stepping out for now?' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	expect(
		(await rpc(page.request, 'billing.myOverview', undefined, 'get'))
			.status,
	).toBe(401);
	expect(
		(
			await rpc(page.request, 'billing.createFundCancellationPortal', {
				subscriptionId: 'sub_not_owned_by_this_member',
			})
		).status,
	).toBe(401);
	expect(errors).toEqual([]);
});

test('restricted billing identity never becomes a public profile owner or another member billing reader', async ({
	page,
}) => {
	await testSql`UPDATE givetogive_user SET frozen_at=now(), session_version=session_version+1 WHERE id=${members[1].id}`;
	await restrictedSignIn(page, members[1]);
	for (const member of [members[1], members[2]]) {
		const profile = await rpc(
			page.request,
			'user.getProfile',
			{ id: member.id, page: 1 },
			'get',
		);
		expect(profile.status).toBe(200);
		expect(profile.data?.['isOwner']).toBe(false);
		expect(profile.data).not.toHaveProperty('ownRecognitionStatus');
		expect(profile.data).not.toHaveProperty('ownSupporterTier');
		expect(profile.data).not.toHaveProperty('email');
	}
	expect(
		(
			await rpc(
				page.request,
				'billing.supporterChangeStatus',
				{ operationId: randomUUID() },
				'get',
			)
		).status,
	).toBe(404);
	expect(
		(
			await rpc(
				page.request,
				'billing.listSupporterChanges',
				{ subscriptionId: 'sub_someone_else', limit: 20 },
				'get',
			)
		).data,
	).toEqual([]);
	await page.goto(`/members/${members[1].id}`);
	await expect(
		page.getByRole('button', { name: 'Edit profile', exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'My account' })).toHaveCount(
		0,
	);
	await page.goto('/account/security');
	// The denied ordinary page goes through sign-in, which safely routes an
	// already-authenticated restricted identity back to its billing-only area.
	await expect(page).toHaveURL(/\/account\/billing$/);
	await expect(
		page.getByText('Restricted billing access', { exact: true }),
	).toBeVisible();
	const [records] = await testSql`SELECT
		(SELECT count(*)::int FROM givetogive_payment WHERE actor_id IN (${members[0].id},${members[1].id},${members[2].id})) AS payments,
		(SELECT count(*)::int FROM givetogive_payment_subscription WHERE actor_id IN (${members[0].id},${members[1].id},${members[2].id})) AS subscriptions`;
	expect(records?.['payments']).toBe(0);
	expect(records?.['subscriptions']).toBe(0);
});

test('frozen unverified accounts cannot use restricted billing sign-in', async ({
	page,
}) => {
	await testSql`UPDATE givetogive_user SET frozen_at=now(), email_verified=NULL, session_version=session_version+1 WHERE id=${members[2].id}`;
	await page.goto('/signin');
	await page.getByLabel('Email').fill(members[2].email);
	await page.getByLabel('Password').fill(members[2].password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: "We couldn't sign you in." }),
	).toBeVisible();
	expect(
		(await rpc(page.request, 'billing.myOverview', undefined, 'get'))
			.status,
	).toBe(401);
});
