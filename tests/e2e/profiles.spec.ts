import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { makeMembers, cleanMembers, testSql as sql } from './fixtures';

let members: Awaited<ReturnType<typeof makeMembers>>;
let memberId: string;
let askerId: string;
let email: string;
let password: string;
const slug = `profile-e2e-${randomUUID()}`;
let askId: number;

test.beforeAll(async () => {
	members = await makeMembers();
	({ id: memberId, email, password } = members[0]);
	askerId = members[1].id;
	await sql`update givetogive_user set name = 'Profile Test Neighbor', joined_at = null where id = ${memberId}`;
	await sql`update givetogive_user set email_verified = null where id = ${askerId}`;
	const [ask] = await sql<{ id: number }[]>`
		insert into givetogive_ask (slug, title, description, difficulty, estimated_minutes_to_complete, created_by, goal_amount, type)
		values (${slug}, 'Profile history fixture', 'An isolated Ask for checking profile history.', 1, 30, ${askerId}, 30, 'task')
		returning id
	`;
	askId = ask!.id;
	for (const status of [
		...Array<string>(21).fill('completed'),
		'pledged',
		'cancelled',
	]) {
		await sql`
			insert into givetogive_ask_contribution (ask_id, contributor_id, amount, note, status)
			values (${askId}, ${memberId}, 1, 'Private fixture note', ${status})
		`;
	}
});

test.afterAll(async () => {
	if (members) await cleanMembers(members.map((member) => member.id));
});

test('public profile limits history and never exposes account secrets', async ({
	page,
	request,
}) => {
	const response = await request.get('/api/trpc/user.getProfile', {
		params: { input: JSON.stringify({ json: { id: memberId } }) },
	});
	expect(response.ok()).toBeTruthy();
	const body = await response.text();
	expect(body).not.toContain(email);
	expect(body).not.toContain('hashedPassword');
	expect(body).not.toContain('Private fixture note');
	expect(body).not.toContain('pledged');
	expect(body).not.toContain('cancelled');
	await page.goto(`/members/${memberId}`);
	await expect(
		page.getByRole('heading', { name: 'Profile Test Neighbor' }),
	).toBeVisible();
	await expect(page.locator('.profile-history__list > li')).toHaveCount(20);
	await expect(page.getByText('Completed', { exact: true })).toHaveCount(20);
	await page.getByRole('link', { name: 'Next →', exact: true }).click();
	await expect(page.locator('.profile-history__list > li')).toHaveCount(1);
	await expect(page.getByText('Page 2 of 2')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Edit profile' }),
	).toHaveCount(0);
	await expect(page.getByText(/Member since/)).toHaveCount(0);
	await expect(
		page.getByText('Email confirmed', { exact: true }),
	).toBeVisible();
	await page.goto(`/members/${askerId}`);
	await expect(
		page.getByText('Email confirmed', { exact: true }),
	).toHaveCount(0);
});

test('owner can edit public fields and inspect private contribution states', async ({
	page,
	request,
}) => {
	await page.goto(`/signin?callbackUrl=/members/${memberId}`);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Profile Test Neighbor' }),
	).toBeVisible();
	await expect(page.locator('.profile-history__list > li')).toHaveCount(20);
	await expect(page.getByText('Pledged', { exact: true })).toBeVisible();
	await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Edit profile' }).click();
	await page.getByLabel('Name').fill('Unsaved name');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Edit profile' }).click();
	await expect(page.getByLabel('Name')).toHaveValue('Profile Test Neighbor');
	await page.getByLabel('Name').fill('Updated Neighbor');
	await page.getByLabel('Neighborhood or city').fill('Brooklyn');
	await page
		.getByRole('textbox', { name: 'About you', exact: true })
		.fill('I enjoy sharing useful tools with neighbors.');
	await page.getByRole('button', { name: 'Save profile' }).click();
	await expect(
		page.getByRole('heading', { name: 'Updated Neighbor' }),
	).toBeVisible();
	await expect(page.getByText('Brooklyn', { exact: true })).toBeVisible();
	await expect(
		page.getByText('Profile saved.', { exact: true }),
	).toBeVisible();

	const anonymousUpdate = await request.post('/api/trpc/user.updateProfile', {
		data: { json: { name: 'Unauthorized name', bio: '', location: '' } },
	});
	expect(anonymousUpdate.status()).toBe(401);
	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'Updated Neighbor' }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'My account' }).click();
	await expect(
		page.getByRole('menuitem', { name: 'My profile & help' }),
	).toBeVisible();
	await page.keyboard.press('Escape');
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test('unknown profile has a useful not-found view', async ({ page }) => {
	await page.goto(`/members/${randomUUID()}`);
	await expect(
		page.getByRole('heading', {
			name: 'This neighbor could not be found.',
		}),
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Back to the community board' }),
	).toBeVisible();
});
