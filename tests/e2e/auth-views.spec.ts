import { expect, test } from '@playwright/test';
import { cleanMembers, login, makeMembers, rpc } from './fixtures';

test.describe('branded account recovery and sign-out', () => {
	test('a tokenless verification page explains missing links; invalid links do not request a second email', async ({ page }) => {
		await page.goto('/verify-email');
		await expect(page.getByText('No verification token was included', { exact: false })).toBeVisible();
		await page.goto('/verify-email?token=invalid_probe_token_not_a_real_secret');
		await expect(page.getByRole('heading', { name: 'Confirm your email.' })).toBeVisible();
		await expect(page.getByRole('alert').filter({ hasText: 'This verification link is invalid or has expired.' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send verification link' })).toHaveCount(0);
	});
	let members: Awaited<ReturnType<typeof makeMembers>>;
	test.beforeAll(async () => {
		members = await makeMembers();
	});
	test.afterAll(async () => {
		if (members) await cleanMembers(members.map(({ id }) => id));
	});

	test('error and signed-out views do not expose provider internals', async ({
		page,
	}) => {
		await page.goto('/api/auth/error?error=Configuration');
		await expect(page).toHaveURL(/\/auth-error/);
		await expect(
			page.getByRole('heading', { name: 'Let’s try that again.' }),
		).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Back to sign in' }),
		).toBeVisible();
		await expect(page.locator('main')).not.toContainText('Configuration');
		await page.goto('/signout');
		await expect(
			page.getByRole('heading', { name: 'You are signed out.' }),
		).toBeVisible();
	});

	test('mobile navigation reaches profile and sign-out; cancellation preserves and confirmation ends session', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await login(page, members[0]);
		const nav = page.getByRole('navigation', {
			name: 'Primary navigation',
		});
		await nav.getByRole('button', { name: 'My account' }).click();
		const menu = page.getByRole('menu', { name: 'Your account' });
		await expect(
			menu.getByRole('menuitem', { name: 'My profile & help' }),
		).toBeVisible();
		await expect(
			menu.getByRole('menuitem', { name: 'Sign out' }),
		).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await menu.getByRole('menuitem', { name: 'Sign out' }).click();
		await expect(
			page.getByRole('heading', { name: 'Stepping out for now?' }),
		).toBeVisible();
		await page.getByRole('link', { name: 'Stay signed in' }).click();
		await expect(page).toHaveURL(/\/asks$/);
		expect(
			(await (await page.request.get('/api/auth/session')).json()).user
				?.id,
		).toBe(members[0].id);
		await page.goto('/api/auth/signout');
		await expect(page).toHaveURL(/\/signout$/);
		await page
			.getByRole('button', { name: 'Sign out', exact: true })
			.click();
		await expect(page).toHaveURL(/\/$/);
		expect(
			(await (await page.request.get('/api/auth/session')).json())?.user,
		).toBeUndefined();
		await expect(
			nav.getByRole('link', { name: 'Sign in', exact: true }),
		).toBeVisible();
		const protectedRead = await rpc(
			page.request,
			'ask.getAsks',
			{ savedOnly: true },
			'get',
		);
		expect(protectedRead.status).toBe(401);
	});
});
