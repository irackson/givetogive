import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let members: Awaited<ReturnType<typeof makeMembers>>;
let askId: number;
const caseId = randomUUID();
const caseKey = `e2e-operator-${caseId}`;
const summary = `Synthetic operator review fixture ${caseId}`;
const title = `Synthetic payment control ${caseId}`;

test.beforeAll(async () => {
	members = await makeMembers();
	await testSql`UPDATE givetogive_user SET role='admin' WHERE id=${members[2].id} AND is_synthetic=true`;
	const [ask] =
		await testSql`INSERT INTO givetogive_ask (title,slug,description,type,goal_amount,currency,difficulty,estimated_minutes_to_complete,created_by)
		VALUES (${title},${`e2e-control-${caseId}`},'Synthetic UI fixture, no paid records or provider claims.','money',10000,'USD',1,1,${members[0].id}) RETURNING id`;
	askId = Number(ask!['id']);
	await testSql`INSERT INTO givetogive_payment_ask_settings(ask_id,goal_amount) VALUES(${askId},10000)`;
	await testSql`INSERT INTO givetogive_payment_case(id,key,category,summary) VALUES(${caseId},${caseKey},'synthetic_operator_test',${summary})`;
});
test.afterAll(async () => {
	if (askId)
		await testSql`DELETE FROM givetogive_payment_ask_settings WHERE ask_id=${askId}`;
	await testSql`DELETE FROM givetogive_payment_case WHERE id=${caseId} AND key=${caseKey}`;
	if (members) await cleanMembers(members.map(({ id }) => id));
	// Append-only operational events remain as an honest isolated-test history.
});

test('ordinary members cannot review cases or control payment acceptance', async ({
	page,
}) => {
	await login(page, members[0]);
	expect(
		(await rpc(page.request, 'cases.history', { caseId, limit: 30 }, 'get'))
			.status,
	).toBe(403);
	expect(
		(
			await rpc(page.request, 'cases.review', {
				caseId,
				operationId: randomUUID(),
				decision: 'acknowledge',
				note: 'Unauthorized review must be refused.',
			})
		).status,
	).toBe(403);
	expect(
		(await rpc(page.request, 'paymentControls.asks', { limit: 25 }, 'get'))
			.status,
	).toBe(403);
	expect(
		(
			await rpc(page.request, 'paymentControls.setAskPaused', {
				askId,
				operationId: randomUUID(),
				paused: true,
				expectedPaused: false,
				expectedRevision: 0,
				reason: 'Unauthorized payment control must be refused.',
			})
		).status,
	).toBe(403);
});

test('admin case review records history without resolving or hiding the case', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.name));
	await login(page, members[2]);
	await page.goto('/admin/payments');
	await page
		.locator('li')
		.filter({ has: page.getByText(summary, { exact: true }) })
		.getByRole('button', { name: 'Review case', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText(/does not resolve this case/)).toBeVisible();
	const note =
		'Acknowledged synthetic case and retained the original unresolved state.';
	await dialog.getByLabel('Review note', { exact: true }).fill(note);
	await dialog
		.getByRole('button', { name: 'Record review', exact: true })
		.click();
	await expect(
		dialog.getByText('Review recorded. Financial state was not changed.'),
	).toBeVisible();
	await expect(dialog.getByText(note, { exact: true })).toBeVisible();
	await dialog.getByRole('combobox', { name: 'Review action' }).click();
	await page
		.getByRole('option', {
			name: 'Escalate for investigation',
			exact: true,
		})
		.click();
	await dialog
		.getByLabel('Review note', { exact: true })
		.fill('Escalated synthetic case for further operator investigation.');
	await dialog
		.getByRole('button', { name: 'Record review', exact: true })
		.click();
	await expect(dialog.getByText('Escalated', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText(summary, { exact: true })).toBeVisible();
	const [row] =
		await testSql`SELECT resolved_at FROM givetogive_payment_case WHERE id=${caseId}`;
	expect(row!['resolved_at']).toBeNull();
	expect(errors).toEqual([]);
});

test('admin pauses and resumes new Ask reservations with an audited reason', async ({
	page,
}) => {
	await login(page, members[2]);
	await page.goto('/admin/payments');
	await page
		.getByLabel('Find a payment-enabled Ask', { exact: true })
		.fill(title);
	await page
		.getByRole('button', { name: 'Search Asks', exact: true })
		.click();
	await page
		.getByRole('button', { name: 'Pause new payments', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await expect(
		dialog.getByText(/does not cancel an already-open Checkout/),
	).toBeVisible();
	await dialog
		.getByLabel('Reason for this change', { exact: true })
		.fill('Pause new synthetic reservations while operator checks run.');
	await dialog
		.getByRole('button', { name: 'Pause new payments', exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Resume new payments', exact: true }),
	).toBeVisible();
	let [state] =
		await testSql`SELECT paused_at FROM givetogive_payment_ask_settings WHERE ask_id=${askId}`;
	expect(state!['paused_at']).not.toBeNull();
	await page
		.getByRole('button', { name: 'Resume new payments', exact: true })
		.click();
	await dialog
		.getByLabel('Reason for this change', { exact: true })
		.fill('Synthetic operator review complete; resume new reservations.');
	await dialog
		.getByRole('button', { name: 'Resume new payments', exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	[state] =
		await testSql`SELECT paused_at FROM givetogive_payment_ask_settings WHERE ask_id=${askId}`;
	expect(state!['paused_at']).toBeNull();
	const events =
		await testSql`SELECT action FROM givetogive_operation_event WHERE actor_id=${members[2].id} AND entity_type='ask' AND entity_id=${String(askId)} ORDER BY id`;
	expect(events.map((event) => event['action'])).toEqual([
		'ask_payments_paused',
		'ask_payments_resumed',
	]);
});
