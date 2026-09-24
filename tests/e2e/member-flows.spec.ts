import { expect, test, type Page } from '@playwright/test';

const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const password = 'E2e-password-2026!';
const replacementPassword = 'New-e2e-password-2026!';
const owner = {
	email: `givetogive-e2e-owner-${runId}@example.com`,
	name: 'E2E Ask Owner',
};
const neighbor = {
	email: `givetogive-e2e-neighbor-${runId}@example.com`,
	name: 'E2E Neighbor',
};
const askTitle = `E2E porch repair ${runId}`;

async function signUp(page: Page, member: typeof owner) {
	await page.goto('/signup');
	await page.getByLabel('Name').fill(member.name);
	await page.getByLabel('Email').fill(member.email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByText('Account created.')).toBeVisible();
	await expect(
		page.getByText('Email delivery is not configured yet.'),
	).toHaveCount(0);
}

async function verifyEmailFromPreview(page: Page) {
	await page
		.getByRole('link', { name: 'Open the development verification link' })
		.click();
	await expect(page.getByText('Email verified. You can now sign in.')).toBeVisible();
}

async function signIn(page: Page, email: string, value = password) {
	await page.goto('/signin');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(value);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/$/);
}

test.describe.serial('GiveToGive member flows', () => {
	test('renders every public route without a framework error', async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text());
		});

		for (const route of [
			'/',
			'/asks',
			'/signin',
			'/signup',
			'/forgot-password',
			'/reset-password',
			'/verify-email',
		]) {
			await page.goto(route);
			await expect(page.locator('body')).not.toBeEmpty();
			await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
		}
		await expect(page.getByRole('heading', { name: 'Resend verification.' })).toBeVisible();
		expect(consoleErrors).toEqual([]);
	});

	test('recovers an unverified sign-in, verifies email, and signs in', async ({ page }) => {
		await signUp(page, owner);
		await page.goto('/signin');
		await page.getByLabel('Email').fill(owner.email);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		const error = page
			.getByRole('alert')
			.filter({ hasText: "We couldn't sign you in." });
		await expect(error).toContainText('resend your verification email');
		await error.getByRole('link', { name: 'Resend verification' }).click();
		await expect(page).toHaveURL(/\/verify-email$/);
		await page.getByLabel('Email').fill(owner.email);
		await page.getByRole('button', { name: 'Send verification link' }).click();
		await expect(
			page.getByText('If that account still needs verification'),
		).toBeVisible();
		await verifyEmailFromPreview(page);
		await signIn(page, owner.email);
		await expect(page.getByText('Welcome back, E2E.')).toBeVisible();
	});

	test('creates an Ask and lets another verified member contribute', async ({
		browser,
		page,
	}) => {
		await signIn(page, owner.email);
		await page.goto('/asks');
		await page.getByRole('button', { name: 'Post an ask' }).click();
		await page.getByLabel('Title').fill(askTitle);
		await page
			.getByLabel('Description')
			.fill('A small porch repair needs two neighbors with basic tools.');
		await page.getByLabel('Goal (tasks)').fill('2');
		await page.getByRole('button', { name: 'Create Ask' }).click();
		await expect(page.getByRole('heading', { name: askTitle })).toBeVisible();
		const askUrl = page.url();
		await expect(page.getByText('This is your Ask.')).toBeVisible();

		const neighborContext = await browser.newContext();
		const neighborPage = await neighborContext.newPage();
		try {
			await signUp(neighborPage, neighbor);
			await verifyEmailFromPreview(neighborPage);
			await signIn(neighborPage, neighbor.email);
			await neighborPage.goto(askUrl);
			await neighborPage
				.getByRole('button', { name: 'Offer a contribution' })
				.click();
			await expect(
				neighborPage.getByRole('heading', { name: 'Your part of the help' }),
			).toBeVisible();
			await neighborPage.getByLabel('Amount (tasks)').fill('1');
			await neighborPage
				.getByLabel('A note for the asker (optional)')
				.fill('I can bring the right screws and lend a hand.');
			await neighborPage
				.getByRole('button', { name: 'Confirm contribution' })
				.click();
			await expect(
				neighborPage.getByText('I can bring the right screws and lend a hand.'),
			).toBeVisible();
			await expect(neighborPage.getByText('in progress')).toBeVisible();
		} finally {
			await neighborContext.close();
		}
	});

	test('resets a password through the emailed development link', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.getByLabel('Email').fill(owner.email);
		await page.getByRole('button', { name: 'Send reset link' }).click();
		await expect(
			page.getByText('If an account exists for that email'),
		).toBeVisible();
		await page
			.getByRole('link', { name: 'Open the development reset link' })
			.click();
		await page.getByLabel('New password').fill(replacementPassword);
		await page.getByRole('button', { name: 'Update password' }).click();
		await expect(
			page.getByText('Your password has been updated. You can sign in now.'),
		).toBeVisible();
		await signIn(page, owner.email, replacementPassword);
	});
});
