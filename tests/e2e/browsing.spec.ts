import { expect, test } from '@playwright/test';
import { cleanMembers, makeMembers, rpc, testSql } from './fixtures';

let members: Awaited<ReturnType<typeof makeMembers>>;
let marker: string;

test.beforeAll(async () => {
	members = await makeMembers();
	marker = `browse-${members[0].id}`;
	const variants = [
		{ type: 'time', minutes: 30, difficulty: 1, status: 'not_started' },
		{ type: 'time', minutes: 45, difficulty: 3, status: 'not_started' },
		{ type: 'time', minutes: 60, difficulty: 5, status: 'not_started' },
		{ type: 'task', minutes: 30, difficulty: 2, status: 'not_started' },
		{ type: 'item', minutes: 20, difficulty: 2, status: 'in_progress' },
	];
	for (const [index, variant] of variants.entries()) {
		const [ask] = await testSql`
			INSERT INTO givetogive_ask (title, slug, description, type, goal_amount,
				difficulty, estimated_minutes_to_complete, status, created_by)
			VALUES (${`${marker} ${index}`}, ${`${marker}-${index}`},
				${'Synthetic browsing fixture for release verification.'}, ${variant.type}, 2,
				${variant.difficulty}, ${variant.minutes}, ${variant.status}, ${members[0].id})
			RETURNING id`;
		if (variant.status === 'in_progress') {
			await testSql`INSERT INTO givetogive_ask_contribution
				(ask_id, contributor_id, amount, status)
				VALUES (${Number(ask!['id'])}, ${members[1].id}, 1, 'pledged')`;
		}
	}
});

test.afterAll(async () => {
	if (members) await cleanMembers(members.map((member) => member.id));
});

test('URL filters apply together, retain custom minutes, clear, and restore with browser Back', async ({
	page,
}) => {
	await page.goto(`/asks?q=${encodeURIComponent(marker)}&minutes=45`);
	const form = page.getByRole('form', { name: 'Filter Asks' });
	const search = form.getByRole('searchbox', { name: 'Search' });
	const status = form.getByRole('combobox', { name: 'Status' });
	const difficulty = form.getByRole('combobox', { name: 'Difficulty' });
	const minutes = form.getByRole('combobox', { name: 'Time needed' });
	await expect(minutes).toHaveValue('45');
	await expect(minutes.locator('option:checked')).toHaveText(
		'45 minutes or less',
	);
	await expect(page.locator('.ask-card')).toHaveCount(4);
	await status.selectOption('not_started');
	await difficulty.selectOption('2');
	await form.getByRole('button', { name: 'Apply filters' }).click();
	await expect(page).toHaveURL(/status=not_started/);
	await expect(page.locator('.ask-card')).toHaveCount(2);
	await expect(minutes).toHaveValue('45');
	await page
		.getByRole('navigation', { name: 'Browse by Ask type' })
		.getByRole('link', { name: 'Time', exact: true })
		.click();
	await expect(page).toHaveURL(/type=time/);
	await expect(page.locator('.ask-card')).toHaveCount(1);
	await expect(page.locator('.ask-card h3')).toHaveText(`${marker} 0`);
	const filteredUrl = page.url();
	await form.getByRole('link', { name: 'Clear filters' }).click();
	await expect(page).toHaveURL(/\/asks$/);
	await expect(search).toHaveValue('');
	await expect(status).toHaveValue('');
	await expect(difficulty).toHaveValue('');
	await expect(minutes).toHaveValue('');
	await page.goBack();
	await expect(page).toHaveURL(filteredUrl);
	await expect(search).toHaveValue(marker);
	await expect(status).toHaveValue('not_started');
	await expect(difficulty).toHaveValue('2');
	await expect(minutes).toHaveValue('45');
	await expect(page.locator('.ask-card')).toHaveCount(1);
});

test('literal wildcard searches do not broaden matches, and status filters match persisted progress', async ({
	page,
}) => {
	const literal = await rpc(
		page.request,
		'ask.getAsks',
		{ query: `${marker}%` },
		'get',
	);
	expect(literal.status).toBe(200);
	expect(literal.data).toEqual([]);
	await page.goto(`/asks?q=${encodeURIComponent(marker)}&status=in_progress`);
	await expect(page.locator('.ask-card')).toHaveCount(1);
	await expect(page.locator('.ask-card h3')).toHaveText(`${marker} 4`);
	await expect(page.locator('.ask-card__status')).toHaveText('In progress');
	await page
		.getByRole('combobox', { name: 'Status' })
		.selectOption('complete');
	await page.getByRole('button', { name: 'Apply filters' }).click();
	await expect(
		page.getByRole('heading', { name: 'Try a wider search.' }),
	).toBeVisible();
	await expect(page.locator('.ask-card')).toHaveCount(0);
});
