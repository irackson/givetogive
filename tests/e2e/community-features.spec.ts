import { test, expect, type Page } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { makeMembers, cleanMembers, login, rpc, testSql } from './fixtures';

let members: Awaited<ReturnType<typeof makeMembers>>;
const description = 'Neighbors can share practical help and make this community project happen.';

test.beforeAll(async () => { members = await makeMembers(); });
test.afterAll(async () => { if (members) await cleanMembers(members.map((member) => member.id)); });

async function createAsk(page: Page, suffix: string, type = 'task', goalAmount = 2) {
	const result = await rpc(page.request, 'ask.createAsk', {
		title: `Community release ${members[0].id.slice(0, 8)} ${suffix}`, description,
		type, goalAmount, currency: 'USD', difficulty: 2, estimatedMinutesToComplete: 30,
	});
	expect(result.status, JSON.stringify(result.error)).toBe(200);
	return { id: Number(result.data?.['newlyCreatedAskId']), slug: String(result.data?.['newlyCreatedSlug']) };
}

test('public routes, invalid links, type filters, mobile navigation and protected APIs', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	for (const route of ['/', '/asks', '/signin', '/signup', '/forgot-password', '/reset-password', '/verify-email']) {
		const response = await page.goto(route);
		expect(response?.status()).toBe(200);
		await expect(page.locator('main h1')).toBeVisible();
		await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
	}
	for (const route of ['/a-page-that-does-not-exist', '/asks/missing-ask-release-check', '/members/missing-member-release-check']) {
		await page.goto(route);
		await expect(page.getByRole('heading', { name: /This page is not here|This neighbor could not be found/ })).toBeVisible();
	}
	for (const type of ['time', 'task', 'item', 'money', 'resource']) {
		await page.goto(`/asks?type=${type}`);
		await expect(page.locator('.ask-card').first()).toBeVisible();
		const result = await rpc(page.request, 'ask.getAsks', { type }, 'get');
		expect(result.status).toBe(200);
		for (const ask of result.data as unknown as { type: string; saved: boolean }[]) {
			expect(ask.type).toBe(type);
			expect(ask.saved).toBe(false);
		}
	}
	await page.goto('/asks?q=absolutely-no-matching-release-asks');
	await expect(page.locator('.ask-card')).toHaveCount(0);
	await page.goto('/asks?saved=1');
	await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
	expect((await rpc(page.request, 'ask.setSaved', { askId: 1, saved: true })).status).toBe(401);
	expect((await rpc(page.request, 'user.updateProfile', { name: 'Unauthorized' })).status).toBe(401);
	await page.setViewportSize({ width: 390, height: 844 });
	for (const route of ['/', '/asks', '/signin', `/members/${members[0].id}`]) {
		await page.goto(route);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), route).toBe(true);
	}
	expect(errors).toEqual([]);
});

test('contributions reserve capacity, complete only after delivery, cancel safely, and reject unauthorized writes', async ({ browser, page }) => {
	await login(page, members[0]);
	const ask = await createAsk(page, 'lifecycle');
	const context = await browser.newContext();
	const neighbor = await context.newPage();
	const otherContext = await browser.newContext();
	const other = await otherContext.newPage();
	try {
		await login(neighbor, members[1]);
		await login(other, members[2]);
		expect((await rpc(page.request, 'ask.createContribution', { askId: ask.id, amount: 1 })).status).toBe(400);
		await neighbor.goto(`/asks/${ask.slug}`);
		await neighbor.getByRole('button', { name: 'Offer a contribution' }).click();
		await neighbor.getByLabel('Amount (tasks)').fill('2');
		await neighbor.getByLabel('A note for the asker (optional)').fill('I can help with both tasks.');
		await neighbor.getByRole('button', { name: 'Confirm contribution' }).click();
		await expect(neighbor.getByRole('dialog')).toHaveCount(0);
		const [contribution] = await testSql`SELECT id FROM givetogive_ask_contribution WHERE ask_id=${ask.id}`;
		const id = Number(contribution!['id']);
		let detail = await rpc(page.request, 'ask.getAsk', { id: ask.id }, 'get');
		expect(detail.data?.['status']).toBe('in_progress');
		expect(detail.data?.['completedAmount']).toBe(0);
		const otherDetail = await rpc(other.request, 'ask.getAsk', { id: ask.id }, 'get');
		expect(JSON.stringify(otherDetail.data)).not.toContain('I can help with both tasks.');
		expect(JSON.stringify(detail.data)).toContain('I can help with both tasks.');
		expect((await rpc(other.request, 'ask.updateContributionStatus', { contributionId: id, status: 'completed' })).status).toBe(403);
		expect((await rpc(other.request, 'ask.updateAsk', { askId: ask.id, title: 'Unauthorized edit' })).status).toBe(403);
		expect((await rpc(page.request, 'ask.updateAsk', { askId: ask.id, goalAmount: 1 })).status).toBe(400);
		expect((await rpc(other.request, 'ask.createContribution', { askId: ask.id, amount: 1 })).status).toBe(400);
		// A full pledge can be cancelled. This reopens capacity for other neighbors.
		expect((await rpc(neighbor.request, 'ask.updateContributionStatus', { contributionId: id, status: 'cancelled' })).status).toBe(200);
		expect((await rpc(neighbor.request, 'ask.updateContributionStatus', { contributionId: id, status: 'cancelled' })).status).toBe(200);
		detail = await rpc(page.request, 'ask.getAsk', { id: ask.id }, 'get');
		expect(detail.data?.['status']).toBe('not_started');
		// Competing full-goal pledges cannot overfill the Ask.
		const race = await Promise.all([
			rpc(neighbor.request, 'ask.createContribution', { askId: ask.id, amount: 2 }),
			rpc(other.request, 'ask.createContribution', { askId: ask.id, amount: 2 }),
		]);
		expect(race.map((result) => result.status).sort()).toEqual([200, 400]);
		const winner = race.find((result) => result.status === 200)!;
		const activeId = Number(winner.data?.['contributionId']);
		await page.goto(`/asks/${ask.slug}`);
		await page.getByRole('button', { name: /mark complete/i }).click();
		const dialog = page.getByRole('dialog');
		if (await dialog.count()) await dialog.getByRole('button', { name: /mark complete|confirm/i }).click();
		await expect.poll(async () => (await rpc(page.request, 'ask.getAsk', { id: ask.id }, 'get')).data?.['status']).toBe('complete');
		expect((await rpc(page.request, 'ask.updateContributionStatus', { contributionId: activeId, status: 'completed' })).status).toBe(200);
		const winnerPage = race[0]!.status === 200 ? neighbor : other;
		expect((await rpc(winnerPage.request, 'ask.updateContributionStatus', { contributionId: activeId, status: 'cancelled' })).status).toBe(400);
		expect((await rpc(page.request, 'ask.updateAsk', { askId: ask.id, title: 'Updated community project', goalAmount: 3 })).status).toBe(200);
		detail = await rpc(page.request, 'ask.getAsk', { id: ask.id }, 'get');
		expect(detail.data?.['status']).toBe('in_progress');
		expect(detail.data?.['slug']).toBe(ask.slug);
		const activities = await testSql`SELECT type FROM givetogive_ask_activity WHERE ask_id=${ask.id}`;
		expect(activities.filter((row) => row['type'] === 'contribution_completed')).toHaveLength(1);
		expect(activities.filter((row) => row['type'] === 'contribution_cancelled')).toHaveLength(1);
		expect(activities.map((row) => row['type'])).toContain('ask_updated');
	} finally { await context.close(); await otherContext.close(); }
});

test('profiles keep email private and saves persist per member with refresh and URL filters', async ({ browser, page }) => {
	await login(page, members[0]);
	const ask = await createAsk(page, 'bookmarked');
	await page.goto(`/members/${members[0].id}`);
	await page.getByRole('button', { name: 'Edit profile' }).click();
	await page.getByLabel('Name').fill('Alex Rivera');
	await page.getByLabel('Neighborhood or city').fill('Riverside');
	await page.getByRole('textbox', { name: 'About you', exact: true }).fill('I enjoy fixing bikes and sharing garden tools.');
	await page.getByRole('button', { name: 'Save profile' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByText('Riverside', { exact: true })).toBeVisible();
	await page.goto(`/asks?q=${encodeURIComponent(`Community release ${members[0].id.slice(0, 8)} bookmarked`)}`);
	const card = page.locator('.ask-card').filter({ has: page.getByRole('heading', { name: /bookmarked/ }) });
	await expect(card).toHaveCount(1);
	await card.getByRole('button', { name: /save/i }).click();
	await expect(card.getByRole('button', { name: /unsave|remove/i })).toBeVisible();
	await page.goto('/asks?saved=1');
	await expect(page.locator('.ask-card')).toHaveCount(1);
	await page.reload();
	await expect(page.locator('.ask-card')).toHaveCount(1);
	const guestContext = await browser.newContext();
	const guest = await guestContext.newPage();
	try {
		await guest.goto(`/members/${members[0].id}`);
		await expect(guest.getByText('Riverside', { exact: true })).toBeVisible();
		await expect(guest.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
		const profile = await rpc(guest.request, 'user.getProfile', { id: members[0].id }, 'get');
		expect(profile.status).toBe(200);
		expect(JSON.stringify(profile.data)).not.toContain(members[0].email);
		expect(JSON.stringify(profile.data)).not.toContain('hashedPassword');
		await login(guest, members[1]);
		await guest.goto('/asks?saved=1');
		await expect(guest.locator('.ask-card')).toHaveCount(0);
	} finally { await guestContext.close(); }
	await page.locator('.ask-card').getByRole('button', { name: /unsave|remove/i }).click();
	await expect(page.locator('.ask-card')).toHaveCount(0);
	expect((await rpc(page.request, 'ask.setSaved', { askId: ask.id, saved: false })).status).toBe(200);
});

test('all Ask types use correct units, money precision and collision-safe stable links', async ({ browser, page }) => {
	await login(page, members[0]);
	const context = await browser.newContext();
	const neighbor = await context.newPage();
	try {
		await login(neighbor, members[1]);
		for (const type of ['time', 'task', 'item', 'resource', 'money']) {
			const ask = await createAsk(page, `units-${type}`, type, type === 'money' ? 1.25 : 2);
			const amount = type === 'money' ? 0.25 : 1;
			const contribution = await rpc(neighbor.request, 'ask.createContribution', { askId: ask.id, amount });
			expect(contribution.status).toBe(200);
			const result = await rpc(page.request, 'ask.getAsk', { id: ask.id }, 'get');
			expect(result.data?.['contributedAmount']).toBe(type === 'money' ? 25 : 1);
			expect((await rpc(neighbor.request, 'ask.createContribution', { askId: ask.id, amount: type === 'money' ? 0.001 : 0.5 })).status).toBe(400);
		}
		const first = await createAsk(page, 'same-title');
		const second = await createAsk(page, 'same-title');
		expect(first.slug).not.toBe(second.slug);
	} finally { await context.close(); }
});

test('password reset tokens are single-use even under concurrent requests', async ({ page }) => {
	const token = randomBytes(32).toString('hex');
	const hash = createHash('sha256').update(token).digest('hex');
	await testSql`INSERT INTO givetogive_auth_token (user_id,purpose,token_hash,expires_at) VALUES (${members[2].id},'password_reset',${hash},${new Date(Date.now() + 60_000)})`;
	const results = await Promise.all([
		rpc(page.request, 'user.resetPassword', { token, password: members[2].password }),
		rpc(page.request, 'user.resetPassword', { token, password: members[2].password }),
	]);
	expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
	expect((await rpc(page.request, 'user.resetPassword', { token, password: members[2].password })).status).toBe(400);
});
