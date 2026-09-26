import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanMembers, login, makeMembers, rpc } from './fixtures';

// Explicitly opt in: this creates short-lived illustrative records in the target database.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test('capture the published GiveToGive walkthrough', async ({
	browser,
	page,
	baseURL,
}) => {
	test.skip(
		process.env['WALKTHROUGH_CAPTURE'] !== '1',
		'Walkthrough capture is an explicit release operation.',
	);
	test.setTimeout(15 * 60_000);
	if (!baseURL) throw new Error('A target base URL is required.');
	const directory = path.resolve('tmp/walkthrough');
	await mkdir(path.join(directory, 'images'), { recursive: true });
	const desktop = { width: 1440, height: 1000 };
	const mobile = { width: 390, height: 844 };
	const members = await makeMembers();
	const ownerContext = await browser.newContext({
		baseURL,
		viewport: desktop,
	});
	const helperContext = await browser.newContext({
		baseURL,
		viewport: desktop,
	});
	const owner = await ownerContext.newPage();
	const helper = await helperContext.newPage();
	const pages = [page, owner, helper];
	const errors: string[] = [];
	const shots: Array<{
		index: number;
		title: string;
		caption: string;
		route: string;
		image: string;
		viewport: { width: number; height: number };
		mobile: boolean;
		capturedAt: string;
	}> = [];
	const expectedBadPaths = new Set([
		'/walkthrough-page-not-found',
		'/asks/walkthrough-ask-not-found',
		'/members/walkthrough-member-not-found',
		'/api/trpc/user.verifyEmail',
		'/api/trpc/user.resetPassword',
	]);
	const safePath = (url: string) => {
		try {
			return new URL(url, baseURL).pathname;
		} catch {
			return '(unknown resource)';
		}
	};
	const safeMessage = (message: string) => {
		let result = message;
		for (const member of members) {
			result = result
				.replaceAll(member.email, '[test email]')
				.replaceAll(member.password, '[test password]');
		}
		return result.replace(/(token=)[^\s&]+/g, '$1[redacted]').slice(0, 500);
	};
	for (const surface of pages) {
		surface.setDefaultTimeout(20_000);
		surface.setDefaultNavigationTimeout(40_000);
		surface.on('pageerror', (error) =>
			errors.push(
				`Page error on ${safePath(surface.url())}: ${safeMessage(error.message)}`,
			),
		);
		surface.on('console', (message) => {
			if (message.type() !== 'error') return;
			const resource = safePath(message.location().url || surface.url());
			if (
				expectedBadPaths.has(resource) &&
				/Failed to load resource/.test(message.text())
			)
				return;
			const route = safePath(surface.url());
			if (
				route === '/verify-email' &&
				surface.url().includes('token=invalid-example') &&
				/user\.verifyEmail/.test(message.text())
			)
				return;
			if (
				route === '/reset-password' &&
				surface.url().includes('token=invalid-example') &&
				/user\.resetPassword/.test(message.text())
			)
				return;
			errors.push(
				`Console error on ${resource}: ${safeMessage(message.text())}`,
			);
		});
		surface.on('response', (response) => {
			if (response.status() < 400) return;
			const resource = safePath(response.url());
			if (
				expectedBadPaths.has(resource) &&
				[400, 404].includes(response.status())
			)
				return;
			errors.push(`HTTP ${response.status()} on ${resource}`);
		});
	}

	async function ready(surface: Page) {
		await expect(surface.locator('main h1')).toBeVisible();
		await expect(surface.locator('[data-nextjs-dialog]')).toHaveCount(0);
		await surface.evaluate(async () => {
			await document.fonts.ready;
			await Promise.all(
				Array.from(document.images).map(async (image) => {
					if (!image.complete)
						await new Promise<void>((resolve, reject) => {
							image.addEventListener('load', () => resolve(), {
								once: true,
							});
							image.addEventListener(
								'error',
								() =>
									reject(
										new Error(
											'A page image failed to load.',
										),
									),
								{ once: true },
							);
						});
					if (image.currentSrc && image.naturalWidth === 0)
						throw new Error('A page image is broken.');
				}),
			);
		});
	}
	async function navigate(surface: Page, route: string, section?: string) {
		await surface.goto(route, { waitUntil: 'networkidle' });
		await ready(surface);
		if (route.startsWith('/asks?') || route === '/asks') {
			await expect(surface.locator('.ask-results-bar')).not.toContainText(
				'Finding your matches',
			);
			await expect(surface.locator('.asks-loading')).toHaveCount(0);
		}
		if (section) await scrollSection(surface, section);
	}
	async function scrollSection(surface: Page, selector: string) {
		await expect(surface.locator(selector).first()).toBeVisible();
		await surface
			.locator(selector)
			.first()
			.evaluate((element) => {
				const top =
					element.getBoundingClientRect().top + window.scrollY;
				const header =
					document
						.querySelector('.site-header')
						?.getBoundingClientRect().height ?? 90;
				window.scrollTo({
					top: Math.max(top - header - 20, 0),
					behavior: 'instant',
				});
			});
	}
	async function capture(surface: Page, title: string, caption: string) {
		await ready(surface);
		// Fixture credentials are never part of walkthrough images, even if a future UI regresses.
		const visibleText = await surface.locator('body').innerText();
		for (const member of members) {
			expect(visibleText).not.toContain(member.email);
			expect(visibleText).not.toContain(member.password);
		}
		expect(
			await surface.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					window.innerWidth + 1,
			),
			`${title} horizontal overflow`,
		).toBe(true);
		const index = shots.length + 1;
		const filename = `${String(index).padStart(2, '0')}-${title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-$/, '')}.png`;
		const image = path.join(directory, 'images', filename);
		await surface.screenshot({
			path: image,
			fullPage: false,
			animations: 'disabled',
			mask: [surface.locator('input[type="password"]')],
			maskColor: '#fffdf8',
		});
		const url = new URL(surface.url());
		if (url.searchParams.has('token'))
			url.searchParams.set('token', 'invalid-example');
		shots.push({
			index,
			title,
			caption,
			route: `${url.pathname}${url.search}${url.hash}`,
			image,
			viewport: surface.viewportSize()!,
			mobile: surface.viewportSize()!.width < 650,
			capturedAt: new Date().toISOString(),
		});
		await writeFile(
			path.join(directory, 'manifest.json'),
			JSON.stringify(
				{
					title: 'GiveToGive — published site walkthrough',
					baseURL,
					capturedAt: new Date().toISOString(),
					fixtureDisclosure:
						'Alex Rivera, Jamie Brooks, and the illustrated Asks are temporary synthetic demonstration records. No real payment was made. All demonstration database records are removed after capture.',
					status: 'capturing',
					views: shots,
				},
				null,
				2,
			),
		);
	}
	async function mutation(surface: Page, procedure: string, input: unknown) {
		const result = await rpc(surface.request, procedure, input);
		expect(
			result.status,
			`${procedure}: ${JSON.stringify(result.error)}`,
		).toBe(200);
		return result.data!;
	}
	const examples = [
		{
			type: 'time',
			title: 'An hour for the community garden',
			goal: 60,
			description:
				'Help plant herbs and water the raised beds. Even fifteen minutes of your time would make a difference.',
		},
		{
			type: 'task',
			title: 'Help set up the neighborhood swap',
			goal: 2,
			description:
				'We need two helping hands to arrange tables and label the book corner before our neighborhood swap.',
		},
		{
			type: 'item',
			title: 'Books for the little free library',
			goal: 12,
			description:
				'Share a few gently loved books so neighbors of every age can find their next good read.',
		},
		{
			type: 'money',
			title: 'Repair the shared garden gate',
			goal: 250,
			description:
				'Neighbors are organizing a gate repair. Money offers are pledges arranged directly between members, not payments through GiveToGive.',
		},
		{
			type: 'resource',
			title: 'Share workshop space with neighbors',
			goal: 4,
			description:
				'Lend a few workshop sessions for neighbors to mend household items and learn practical repair skills together.',
		},
	] as const;
	const asks: Array<{
		type: string;
		title: string;
		id: number;
		slug: string;
	}> = [];
	let completed = false;
	try {
		await page.setViewportSize(desktop);
		await login(owner, members[0]);
		await login(helper, members[1]);
		await mutation(owner, 'user.updateProfile', {
			name: members[0].name,
			location: 'Riverside',
			bio: 'Gardener, book sharer, and believer in small acts of neighborly care.',
		});
		await mutation(helper, 'user.updateProfile', {
			name: members[1].name,
			location: 'Riverside',
			bio: 'I enjoy fixing things, sharing useful tools, and helping good ideas get started.',
		});
		for (const example of examples) {
			const result = await mutation(owner, 'ask.createAsk', {
				title: example.title,
				description: example.description,
				type: example.type,
				goalAmount: example.goal,
				currency: 'USD',
				difficulty: 2,
				estimatedMinutesToComplete: 30,
			});
			asks.push({
				type: example.type,
				title: example.title,
				id: Number(result['newlyCreatedAskId']),
				slug: String(result['newlyCreatedSlug']),
			});
		}
		const taskAsk = asks.find(({ type }) => type === 'task')!;
		const moneyAsk = asks.find(({ type }) => type === 'money')!;
		const itemAsk = asks.find(({ type }) => type === 'item')!;
		const resourceAsk = asks.find(({ type }) => type === 'resource')!;
		const delivered = await mutation(helper, 'ask.createContribution', {
			askId: itemAsk.id,
			amount: 3,
			note: 'Three favorite books, ready for another reader.',
		});
		await mutation(helper, 'ask.updateContributionStatus', {
			contributionId: delivered['contributionId'],
			status: 'completed',
		});
		const withdrawn = await mutation(helper, 'ask.createContribution', {
			askId: resourceAsk.id,
			amount: 1,
			note: 'I need to choose a different workshop date.',
		});
		await mutation(helper, 'ask.updateContributionStatus', {
			contributionId: withdrawn['contributionId'],
			status: 'cancelled',
		});
		await mutation(helper, 'ask.createContribution', {
			askId: resourceAsk.id,
			amount: 1,
			note: 'A Saturday workshop session for the neighborhood.',
		});

		await navigate(page, '/');
		await capture(
			page,
			'Home — welcome',
			'The published landing page: warm paper, cobalt, coral, and original mutual-aid artwork.',
		);
		await scrollSection(page, '.home-ways');
		await capture(
			page,
			'Home — ways to help',
			'Time, items, resources, and money pledges lead into filtered views of the community board.',
		);
		await scrollSection(page, '.home-invitation');
		await capture(
			page,
			'Home — community invitation',
			'The lower landing page and shared footer invite visitors to browse needs.',
		);
		await navigate(page, '/asks');
		await capture(
			page,
			'Noticeboard — introduction',
			'A public board of specific needs with clear goals.',
		);
		await scrollSection(page, '.asks-directory');
		await capture(
			page,
			'Noticeboard — filters and cards',
			'Search, status, difficulty, time, type, and contribution progress sit together on the board.',
		);
		for (const example of examples) {
			await navigate(
				page,
				`/asks?type=${example.type}`,
				'.asks-directory',
			);
			await expect(
				page.locator(`.ask-card--${example.type}`).first(),
			).toBeVisible();
			await capture(
				page,
				`Browse — ${example.type}`,
				`The ${example.type} type view uses the same shareable filters and type-specific units.`,
			);
		}
		await navigate(
			page,
			'/asks?type=task&status=not_started&difficulty=2&minutes=30&q=neighborhood',
			'.asks-directory',
		);
		await capture(
			page,
			'Browse — combined filters',
			'URL-backed filters combine keyword, type, status, maximum difficulty, and available time.',
		);
		await navigate(
			page,
			'/asks?q=walkthrough-no-results-example',
			'.asks-directory',
		);
		await expect(
			page.getByRole('heading', { name: 'Try a wider search.' }),
		).toBeVisible();
		await capture(
			page,
			'Browse — no matches',
			'An empty result gives a clear way to widen the search.',
		);
		await navigate(page, '/asks?saved=1', '.asks-directory');
		await capture(
			page,
			'Saved Asks — guest gate',
			'Saved lists are private and require a member account.',
		);

		for (const [route, title, caption] of [
			[
				'/signin',
				'Account — sign in',
				'Email/password and Discord are the available sign-in options.',
			],
			[
				'/signup',
				'Account — join',
				'New members create an account and confirm their email before password sign-in.',
			],
			[
				'/forgot-password',
				'Account — password recovery',
				'Members request a time-limited password reset link.',
			],
			[
				'/reset-password',
				'Account — missing reset link',
				'The reset form explains when a valid reset link is required.',
			],
			[
				'/verify-email',
				'Account — resend verification',
				'An unverified member can request a fresh email confirmation link.',
			],
			[
				'/auth-error',
				'Account — sign-in recovery',
				'A branded recovery page avoids exposing internal authentication errors.',
			],
			[
				'/signout',
				'Account — already signed out',
				'Signed-out visitors can return to browsing or sign in again.',
			],
		] as const) {
			await navigate(page, route);
			await capture(page, title, caption);
		}
		await navigate(page, '/verify-email?token=invalid-example-placeholder-not-an-auth-token');
		await expect(page.locator('main').getByRole('alert')).toBeVisible();
		await capture(
			page,
			'Account — invalid verification link',
			'Expired or invalid verification links fail safely. This uses a deliberately invalid placeholder.',
		);
		await navigate(page, '/reset-password?token=invalid-example-placeholder-not-an-auth-token');
		await page.getByLabel('New password').fill(members[2].password);
		await page.getByRole('button', { name: 'Update password' }).click();
		await expect(page.locator('main').getByRole('alert')).toBeVisible();
		await page.getByLabel('New password').fill('');
		await capture(
			page,
			'Account — invalid reset link',
			'Invalid reset tokens cannot change an account password. No credential is shown.',
		);
		for (const [route, title] of [
			['/walkthrough-page-not-found', 'Recovery — missing page'],
			['/asks/walkthrough-ask-not-found', 'Recovery — missing Ask'],
			[
				'/members/walkthrough-member-not-found',
				'Recovery — missing member',
			],
		] as const) {
			await navigate(page, route);
			await capture(
				page,
				title,
				'A friendly not-found view offers a useful path back into the site.',
			);
		}
		for (const ask of asks) {
			await navigate(page, `/asks/${ask.slug}`);
			await capture(
				page,
				`Ask detail — ${ask.type}`,
				'Public detail shows the owner, goal, remaining amount, status, and sign-in invitation. Money is explicitly an off-platform pledge.',
			);
		}
		await navigate(page, `/members/${members[1].id}`);
		await capture(
			page,
			'Member — public profile',
			'A public introduction, approximate location, honest trust signals, and completed contribution history.',
		);
		await scrollSection(page, '.profile-history');
		await capture(
			page,
			'Member — public contribution history',
			'Only completed contributions appear on the public profile; no email, pending offers, or cancelled offers are exposed here.',
		);

		await navigate(owner, '/asks?saved=1', '.asks-directory');
		await capture(
			owner,
			'Saved Asks — empty member list',
			'An account starts with an empty saved list and instructions for bookmarking.',
		);
		await mutation(owner, 'ask.setSaved', {
			askId: itemAsk.id,
			saved: true,
		});
		await mutation(owner, 'ask.setSaved', {
			askId: moneyAsk.id,
			saved: true,
		});
		await navigate(owner, '/asks?saved=1', '.asks-directory');
		await expect(owner.locator('.ask-card')).toHaveCount(2);
		await capture(
			owner,
			'Saved Asks — personal collection',
			'Bookmarks persist across visits and remain visible only to the member who saved them.',
		);
		await navigate(owner, '/asks', '.asks-directory');
		await owner
			.getByRole('button', { name: 'Post an ask', exact: true })
			.click();
		const createDialog = owner.getByRole('dialog');
		await expect(createDialog).toBeVisible();
		await capture(
			owner,
			'Create Ask — task form',
			'The creation dialog gathers title, description, goal, time estimate, and difficulty.',
		);
		await createDialog
			.getByLabel('Title', { exact: true })
			.fill('A small project for our block');
		await createDialog
			.getByRole('textbox', { name: /^Description/ })
			.fill(
				'Tell neighbors what you need, why it matters, and what a helpful contribution looks like.',
			);
		await createDialog.getByRole('combobox', { name: 'Ask type' }).click();
		await expect(owner.getByRole('listbox')).toBeVisible();
		await capture(
			owner,
			'Create Ask — type chooser',
			'Choose time, task, item, money, or resource.',
		);
		await owner.getByRole('option', { name: 'Time', exact: true }).click();
		await capture(
			owner,
			'Create Ask — time goal',
			'Time asks measure their goal in whole minutes.',
		);
		for (const type of ['Item', 'Resource', 'Money']) {
			await createDialog
				.getByRole('combobox', { name: 'Ask type' })
				.click();
			await owner
				.getByRole('option', { name: type, exact: true })
				.click();
			await capture(
				owner,
				`Create Ask — ${type.toLowerCase()} goal`,
				type === 'Money' ?
					'Money goals support currency and decimal amounts; this does not initiate a payment.'
				:	`${type} goals use whole units and support partial contributions.`,
			);
		}
		await createDialog
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await expect(createDialog).toHaveCount(0);
		await navigate(owner, `/asks/${taskAsk.slug}`);
		await capture(
			owner,
			'Ask owner — own detail',
			'An owner sees the request as theirs and cannot contribute to their own Ask.',
		);
		await owner.getByRole('button', { name: 'Edit this Ask' }).click();
		await expect(owner.getByRole('dialog')).toBeVisible();
		await capture(
			owner,
			'Ask owner — edit dialog',
			'Owners can revise details and goals while preserving the existing public link and pledged capacity.',
		);
		await owner
			.getByRole('dialog')
			.getByRole('textbox', { name: /^Description/ })
			.fill(
				'We need two helping hands to arrange tables and label the book corner. Meet at the community garden before the neighborhood swap.',
			);
		await owner
			.getByRole('dialog')
			.getByRole('button', { name: 'Save changes' })
			.click();
		await expect(owner.getByRole('dialog')).toHaveCount(0);
		await expect(
			owner.getByText(
				'Your Ask has been updated. Its link stays the same.',
			),
		).toBeVisible();
		await scrollSection(owner, '.ask-detail__content');
		await capture(
			owner,
			'Ask owner — updated details',
			'Successful edits provide confirmation and add an activity-history entry.',
		);

		await navigate(helper, `/asks/${taskAsk.slug}`);
		await helper
			.getByRole('button', { name: 'Offer a contribution' })
			.click();
		await helper.getByLabel('Amount (tasks)').fill('1');
		await helper
			.getByLabel('A note for the asker (optional)')
			.fill('I can help arrange the book tables.');
		await capture(
			helper,
			'Contribute — partial offer dialog',
			'A neighbor can pledge only part of the goal and leave a helpful note.',
		);
		await helper
			.getByRole('button', { name: 'Confirm contribution' })
			.click();
		await expect(helper.getByRole('dialog')).toHaveCount(0);
		await expect(helper.locator('.ask-detail__badges')).toContainText(
			'in progress',
		);
		await scrollSection(helper, '.ask-detail__content');
		await capture(
			helper,
			'Contribute — pending pledge',
			'A pledge reserves capacity. Delivery must still be confirmed before it counts as completed help.',
		);
		await helper
			.locator('.contribution-list')
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await expect(helper.getByRole('dialog')).toBeVisible();
		await capture(
			helper,
			'Contribute — cancellation confirmation',
			'Contributors confirm cancellation before their reserved amount is released.',
		);
		await helper
			.getByRole('dialog')
			.getByRole('button', { name: 'Cancel pledge', exact: true })
			.click();
		await expect(helper.getByRole('dialog')).toHaveCount(0);
		await expect(helper.locator('.ask-detail__badges')).toContainText(
			'not started',
		);
		await scrollSection(helper, '.activity-history');
		await capture(
			helper,
			'Ask history — cancellation recorded',
			'The activity timeline records posting, owner edits, offers, and cancellations without erasing history.',
		);
		await navigate(helper, `/asks/${taskAsk.slug}`);
		await helper
			.getByRole('button', { name: 'Offer a contribution' })
			.click();
		await helper.getByLabel('Amount (tasks)').fill('2');
		await helper
			.getByLabel('A note for the asker (optional)')
			.fill('I can now help with both setup tasks.');
		await helper
			.getByRole('button', { name: 'Confirm contribution' })
			.click();
		await expect(helper.getByRole('dialog')).toHaveCount(0);
		await expect(
			helper.getByText(
				'The goal is fully pledged. Delivery is still in progress.',
			),
		).toBeVisible();
		await helper.evaluate(() =>
			window.scrollTo({ top: 0, behavior: 'instant' }),
		);
		await capture(
			helper,
			'Contribute — fully pledged not completed',
			'A fully reserved goal stays in progress until the help is actually delivered.',
		);
		await helper
			.locator('.contribution-list')
			.getByRole('button', { name: 'Mark complete', exact: true })
			.click();
		await expect(helper.getByRole('dialog')).toBeVisible();
		await capture(
			helper,
			'Contribute — completion confirmation',
			'Members explicitly confirm delivery. Completed contributions cannot later be cancelled.',
		);
		await helper
			.getByRole('dialog')
			.getByRole('button', { name: 'Mark complete', exact: true })
			.click();
		await expect(helper.getByRole('dialog')).toHaveCount(0);
		await expect(
			helper.getByText('This Ask has been completed.'),
		).toBeVisible();
		await helper.evaluate(() =>
			window.scrollTo({ top: 0, behavior: 'instant' }),
		);
		await capture(
			helper,
			'Ask — completed goal',
			'The Ask becomes complete only when delivered contributions reach its goal.',
		);
		await scrollSection(helper, '.activity-history');
		await capture(
			helper,
			'Ask history — complete lifecycle',
			'A permanent chronological record shows how the Ask moved from need to completed help.',
		);
		await navigate(helper, `/asks/${moneyAsk.slug}`);
		await helper
			.getByRole('button', { name: 'Offer a contribution' })
			.click();
		await helper.getByLabel('Amount (USD)').fill('25');
		await capture(
			helper,
			'Contribute — money pledge dialog',
			'Decimal currency amounts are pledges only. GiveToGive does not charge, collect, or transfer funds.',
		);
		await helper
			.getByRole('dialog')
			.getByRole('button', { name: 'Not yet' })
			.click();

		await navigate(helper, `/members/${members[1].id}`);
		await capture(
			helper,
			'Member — private contribution overview',
			'An account owner sees completed, pledged, and cancelled offers plus their private pending count.',
		);
		await scrollSection(helper, '.profile-history');
		await capture(
			helper,
			'Member — private history statuses',
			'Your pending and cancelled activity stays private on your member profile. Ask-specific activity remains on its public detail page.',
		);
		await helper.getByRole('button', { name: 'Edit profile' }).click();
		await expect(helper.getByRole('dialog')).toBeVisible();
		await capture(
			helper,
			'Member — profile editor',
			'Name, short bio, and city or neighborhood are editable. The editor explains what is public and discourages home addresses.',
		);
		await helper
			.getByRole('dialog')
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await navigate(owner, '/signout');
		await capture(
			owner,
			'Account — sign-out confirmation',
			'Signing out is a deliberate action with a way to remain signed in.',
		);

		await page.setViewportSize(mobile);
		await helper.setViewportSize(mobile);
		for (const [surface, route, title, section] of [
			[page, '/', 'Mobile — home', undefined],
			[page, '/asks', 'Mobile — noticeboard', undefined],
			[
				page,
				'/asks?type=item',
				'Mobile — filters and cards',
				'.asks-directory',
			],
			[
				helper,
				`/asks/${moneyAsk.slug}`,
				'Mobile — Ask detail',
				undefined,
			],
			[
				helper,
				`/members/${members[1].id}`,
				'Mobile — member profile',
				undefined,
			],
			[
				helper,
				`/members/${members[1].id}`,
				'Mobile — contribution history',
				'.profile-history',
			],
		] as const) {
			await navigate(surface, route, section);
			await capture(
				surface,
				title,
				'The responsive published view at a 390-pixel phone width, with readable content and reachable member navigation.',
			);
		}
		expect(
			errors,
			'Unexpected browser or network errors during walkthrough capture',
		).toEqual([]);
		expect(shots.length).toBeGreaterThanOrEqual(50);
		completed = true;
	} finally {
		await ownerContext.close();
		await helperContext.close();
		await cleanMembers(members.map(({ id }) => id));
		await writeFile(
			path.join(directory, 'manifest.json'),
			JSON.stringify(
				{
					title: 'GiveToGive — published site walkthrough',
					baseURL,
					capturedAt: new Date().toISOString(),
					fixtureDisclosure:
						'Alex Rivera, Jamie Brooks, and the illustrated Asks were temporary synthetic demonstration records captured on the published site. No real payment was made. All demonstration database records were removed after capture.',
					status: completed ? 'complete' : 'incomplete',
					cleanup: 'complete',
					errors,
					views: shots,
				},
				null,
				2,
			),
		);
	}
});
