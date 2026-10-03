import {
	expect,
	test,
	type BrowserContext,
	type Locator,
	type Page,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { RouterOutputs } from '../../src/trpc/react';
import { cleanMembers, login, makeMembers, rpc, testSql } from './fixtures';
import { captureSimulationRunId, captureStorageState, createCaptureDirectory } from './capture-safety';

// Explicit, staging-only artifact generation. Never retain authentication DOM,
// TOTP setup, credentials, raw network traces, or a protection-bypass header.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(15 * 60_000);

test('capture the accessible payment and operations staging walkthrough', async ({
	browser,
	baseURL,
}) => {
	test.skip(
		process.env['PAYMENTS_WALKTHROUGH_CAPTURE'] !== '1',
		'Opt-in screenshot capture.',
	);
	if (
		process.env['APP_ENV'] !== 'staging' ||
		baseURL !== 'https://givetogive-staging.vercel.app'
	) {
		throw new Error(
			'This walkthrough requires the exact protected staging deployment.',
		);
	}
	const simulationRunId = captureSimulationRunId(process.env['WALKTHROUGH_SIMULATION_RUN_ID']);
	const storageState = await captureStorageState(baseURL, process.cwd(), process.env['APP_ENV']);
	const directory = await createCaptureDirectory(process.cwd(), process.env['WALKTHROUGH_CAPTURE_ROOT'], 'payments-staging');
	const members = await makeMembers();
	const operatorCaseId = randomUUID();
	const operatorCaseKey = `walkthrough-operator-${operatorCaseId}`;
	const operatorCaseSummary =
		'Synthetic walkthrough case — no payment or recovery claim.';
	let operatorAskId: number | undefined;
	const operatorAskTitle =
		'Synthetic walkthrough Ask — new-payment control demonstration';
	const contexts: BrowserContext[] = [];
	const desktop = { width: 1440, height: 1000 };
	const mobile = { width: 390, height: 844 };
	const views: {
		index: number;
		title: string;
		caption: string;
		route: string;
		image: string;
		viewport: { width: number; height: number };
		mobile: boolean;
		capturedAt: string;
	}[] = [];
	const omitted: { route: string; reason: string }[] = [];
	const diagnostics: {
		kind: string;
		route: string;
		status?: number;
		source?: string;
	}[] = [];
	const expectedResponses: {
		route: string;
		status: number;
		reason: string;
	}[] = [];
	const expectedMemberDenial = new WeakSet<Page>();
	let phase = 'fixture setup';
	let availability: RouterOutputs['billing']['availability'] | undefined;
	let status = 'capturing';
	let cleanup = 'pending';
	const observedRuns: {
		id: string;
		mode: string;
		status: string;
		registeredAgents: number;
	}[] = [];
	const manifest = () => ({
		title: 'GiveToGive — partial staging walkthrough',
		baseURL,
		environment: 'staging',
		origin: new URL(baseURL).origin,
		simulationRunPin: simulationRunId ?? null,
		capturedAt: new Date().toISOString(),
		status,
		cleanup,
		phase,
		fixtureDisclosure:
			'Actual protected staging UI and database records. Three temporary synthetic accounts were created; one received the administrator role. One explicitly synthetic unpaid Ask and one nonfinancial operator-review case demonstrate controls. No payments, balances, paid tiers, or agent actions were fabricated. Screenshots mask email addresses. Fixture records are cleaned up; append-only audit events remain as a truthful test history.',
		fixtureUserIds: members.map(({ id }) => id),
		verificationBoundary:
			'This is an accessible-view walkthrough, not completed Stripe acceptance or a live-production launch. Disabled or empty states are genuine. A screenshot of a control does not prove its external payment flow.',
		paymentAvailability:
			availability ?
				{
					enabled: availability.enabled,
					askPayments: availability.askPayments,
					subscriptions: availability.subscriptions,
					funds: availability.funds,
					environment: availability.environment,
					livemode: availability.livemode,
				}
			:	null,
		unmetStripeFlows: [
			'Provider-authenticated Checkout success, cancellation, decline, and 3DS/SCA.',
			'Connected-recipient onboarding, verification requirements, transfers, and payouts.',
			'Paid Supporter/Sustainer changes, renewals, failed invoices, and cancellation through the customer portal.',
			'Verified receipts, partial/full refunds, dispute outcomes, fund allocation, and recovery after real provider events.',
			'Hosted signed webhook delivery and reconciliation with the configured Stripe sandbox.',
		],
		aliases: {
			'/account': '/account/billing',
			'/billing': '/account/billing',
			'/receiving': '/account/receiving',
		},
		observedRuns,
		omitted,
		expectedResponses,
		diagnostics,
		views,
	});
	async function saveManifest() {
		await writeFile(
			path.join(directory, 'manifest.json'),
			JSON.stringify(manifest(), null, 2),
		);
	}
	async function newPage() {
		// Explicitly supply the validated host-only staging bootstrap cookie.
		// Do not add global extraHTTPHeaders; Stripe/OAuth must never see it.
		const context = await browser.newContext({
			baseURL: baseURL!,
			storageState,
			viewport: desktop,
		});
		contexts.push(context);
		context.setDefaultNavigationTimeout(30_000);
		context.setDefaultTimeout(15_000);
		const page = await context.newPage();
		const currentRoute = () =>
			new URL(page.url() === 'about:blank' ? baseURL! : page.url())
				.pathname;
		page.on('pageerror', () =>
			diagnostics.push({
				kind: 'browser-page-error',
				route: currentRoute(),
			}),
		);
		page.on('console', (message) => {
			if (message.type() === 'error') {
				const location = message.location().url;
				const resource =
					location ? new URL(location, baseURL).pathname : '';
				if (
					expectedMemberDenial.has(page) &&
					resource === '/admin' &&
					/Failed to load resource.*404/.test(message.text())
				) {
					expectedResponses.push({
						route: '/admin',
						status: 404,
						reason: 'Browser console reports the intentionally denied member navigation.',
					});
					return;
				}
				diagnostics.push({
					kind: 'browser-console-error',
					route: currentRoute(),
					source: resource,
				});
			}
		});
		page.on('response', (response) => {
			const url = new URL(response.url());
			if (url.origin === baseURL && response.status() >= 400) {
				if (
					expectedMemberDenial.has(page) &&
					url.pathname === '/admin' &&
					response.status() === 404
				) {
					expectedResponses.push({
						route: '/admin',
						status: 404,
						reason: 'Ordinary member access denied; page displays the expected not-found boundary.',
					});
					return;
				}
				diagnostics.push({
					kind: 'server-response-error',
					route: url.pathname,
					status: response.status(),
				});
			}
		});
		return page;
	}
	async function ready(page: Page) {
		await expect(page.locator('main h1').first()).toBeVisible();
		await expect(page.locator('.payment-loading')).toHaveCount(0);
		await expect(page.locator('.asks-loading')).toHaveCount(0);
		await expect(page.locator('nextjs-portal')).toHaveCount(0);
		await page.evaluate(async () => {
			await document.fonts.ready;
		});
		await expect
			.poll(async () =>
				page
					.locator('img')
					.evaluateAll((images) =>
						images.every(
							(image) => (image as HTMLImageElement).complete,
						),
					),
			)
			.toBe(true);
	}
	async function navigate(page: Page, route: string) {
		phase = `navigate ${route}`;
		await page.goto(route, { waitUntil: 'domcontentloaded' });
		await ready(page);
	}
	async function capture(
		page: Page,
		title: string,
		caption: string,
		focus?: Locator,
	) {
		phase = `capture ${title}`;
		await ready(page);
		if (focus) {
			await focus.evaluate((element) => {
				element.scrollIntoView({ block: 'start', behavior: 'instant' });
				window.scrollBy({
					top: -(
						(document
							.querySelector('header')
							?.getBoundingClientRect().height ?? 80) + 16
					),
					behavior: 'instant',
				});
			});
			await expect(focus).toBeInViewport();
		}
		// Enrollment is intentionally not opened. Fail with a boolean, never
		// print a secret or assertion snapshot containing one.
		expect(
			(await page
				.getByLabel('Authenticator setup key', { exact: true })
				.count()) === 0,
		).toBe(true);
		const body = await page.locator('body').innerText();
		expect(members.every((member) => !body.includes(member.password))).toBe(
			true,
		);
		expect(
			!/\b(?:sk|rk)_(?:live|test)_\w+|\bwhsec_\w+|\b(?:pi|cs)_\w+_secret_\w+/.test(
				body,
			),
		).toBe(true);
		const index = views.length + 1;
		const name = `${String(index).padStart(2, '0')}-${title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-$/, '')}.png`;
		const image = path.join(directory, 'images', name);
		await page.screenshot({
			path: image,
			fullPage: false,
			animations: 'disabled',
			caret: 'hide',
			maskColor: '#e7dfd0',
			mask: [
				page.locator(
					'input[type="password"], input[autocomplete="one-time-code"], [href^="otpauth:"]',
				),
				page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
			],
		});
		const url = new URL(page.url());
		const viewport = page.viewportSize()!;
		views.push({
			index,
			title,
			caption,
			route: url.pathname + url.search,
			image,
			viewport,
			mobile: viewport.width < 600,
			capturedAt: new Date().toISOString(),
		});
		await saveManifest();
	}
	async function cancelDialog(page: Page, name = 'Cancel') {
		await page
			.getByRole('dialog')
			.getByRole('button', { name, exact: true })
			.click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	}
	try {
		await testSql`UPDATE givetogive_user SET role='admin' WHERE id=${members[2].id} AND is_synthetic=true`;
		const [operatorAsk] =
			await testSql`INSERT INTO givetogive_ask (title,slug,description,type,goal_amount,currency,difficulty,estimated_minutes_to_complete,created_by)
			VALUES (${operatorAskTitle},${`walkthrough-control-${operatorCaseId}`},'Synthetic unpaid Ask for operator control screenshots only. No provider or payment record exists.','money',10000,'USD',1,1,${members[0].id}) RETURNING id`;
		operatorAskId = Number(operatorAsk!['id']);
		await testSql`INSERT INTO givetogive_payment_ask_settings(ask_id,goal_amount) VALUES(${operatorAskId},10000)`;
		await testSql`INSERT INTO givetogive_payment_case(id,key,category,summary) VALUES(${operatorCaseId},${operatorCaseKey},'synthetic_walkthrough',${operatorCaseSummary})`;
		await saveManifest();
		const guest = await newPage();
		await navigate(guest, '/');
		const availabilityResult = await rpc(
			guest.request,
			'billing.availability',
			undefined,
			'get',
		);
		expect(availabilityResult.status).toBe(200);
		availability =
			availabilityResult.data as unknown as RouterOutputs['billing']['availability'];
		expect(availability.environment).toBe('staging');
		expect(availability.livemode).toBe(false);
		await capture(
			guest,
			'Home — the neighborhood',
			'Published staging home. Money-help wording follows this environment’s actual payment gates.',
		);
		await navigate(guest, '/asks?type=money');
		await capture(
			guest,
			'Money Asks — browse',
			'Existing synthetic money Asks. Off-platform pledges are not Stripe-confirmed payments.',
		);
		await capture(
			guest,
			'Money Asks — available cards',
			'Fully loaded money-Ask cards and type-specific progress. Legacy pledges remain distinct from verified Stripe payments.',
			guest.locator('.ask-card-grid'),
		);
		const existingMoneyAskLink = guest
			.locator(
				`a.ask-card__link:not([href="/asks/walkthrough-control-${operatorCaseId}"])`,
			)
			.first();
		if (await existingMoneyAskLink.count()) {
			await navigate(
				guest,
				(await existingMoneyAskLink.getAttribute('href'))!,
			);
			await capture(
				guest,
				'Money Ask — detail',
				'An actual existing staging Ask. Any progress shown is labeled according to its payment-enabled or legacy pledge model.',
			);
		}
		await navigate(guest, '/support');
		await capture(
			guest,
			'Support — three equal welcomes',
			'Neighbor is free; Supporter and Sustainer are optional paid tiers. Displayed plans are not proof of active subscriptions.',
		);
		await guest
			.getByText('Where does my membership go?', { exact: true })
			.click();
		await guest
			.getByText('Does paying get my Ask more attention?', {
				exact: true,
			})
			.click();
		await capture(
			guest,
			'Support — plain-language details',
			'Open membership explanations: operating support is separate from Ask/fund gifts, and payment buys no receiving priority.',
			guest.locator('.payment-faq'),
		);
		await navigate(guest, '/funds');
		await capture(
			guest,
			'Community funds',
			'The actual fund listing, including its honest empty or disabled state. No balance was seeded for this walkthrough.',
		);
		const fundLinks = await guest
			.locator('a[href^="/funds/"]')
			.evaluateAll((links) =>
				links
					.map((link) => link.getAttribute('href'))
					.filter((href): href is string => !!href),
			);
		for (const route of [...new Set(fundLinks)].slice(0, 3)) {
			await navigate(guest, route);
			await capture(
				guest,
				'Community fund — public record',
				'An existing fund’s real totals and public allocation history. This capture does not create or allocate money.',
			);
		}
		if (!fundLinks.length)
			omitted.push({
				route: '/funds/[slug]',
				reason: availability.funds ? 'No actual public fund is visible to this capture; no fictional fund or balance was created.' : 'Funds are disabled by the genuine staging gate; this does not assert that no historical fund record exists.',
			});
		await navigate(guest, '/giving');
		await expect(guest).toHaveURL(/\/signin\?/);
		await capture(
			guest,
			'Private giving — sign-in boundary',
			'Guests are redirected before private giving records are queried.',
		);

		const member = await newPage();
		phase = 'sign in fresh member';
		await login(member, members[0]);
		await navigate(member, '/support');
		await capture(
			member,
			'Support — signed-in availability',
			'This real synthetic Neighbor sees the actual subscription gate. No paid membership was created.',
			member.locator('.support-card').first(),
		);
		await navigate(member, '/giving');
		await capture(
			member,
			'Your giving — genuine empty history',
			'A new synthetic Neighbor has zero verified payments and no fabricated receipts.',
		);
		await member.getByRole('button', { name: 'My account' }).click();
		await capture(
			member,
			'Account navigation — open menu',
			'One menu connects profile, saved Asks, giving, membership, receiving, and account security.',
		);
		await member.keyboard.press('Escape');
		await navigate(member, '/giving?checkout=success');
		await capture(
			member,
			'Giving — a return is not proof of payment',
			'The return-page explanation is shown without creating a payment. The history remains empty and no success is invented.',
		);
		omitted.push({
			route: '/giving/[id]',
			reason: 'The new capture account has no owned financial or Checkout record. Existing historical test accounts and their unpaid/expired records require separately authorized authentication; none are impersonated for this capture.',
		});
		for (const [route, title, caption] of [
			[
				'/account/billing',
				'Membership and billing',
				'Actual free Neighbor status. Portal access and subscription actions follow real availability.',
			],
			[
				'/account/receiving',
				'Receiving help',
				`Actual Connect readiness. Staging Ask payments are ${availability.askPayments ? 'enabled' : 'disabled'} and funds are ${availability.funds ? 'enabled' : 'disabled'}; onboarding follows these gates, not merely whether Stripe test credentials exist.`,
			],
			[
				'/account/security',
				'Account security',
				'Authenticator setup and session-revocation entry points. No setup key or code is displayed or captured.',
			],
		] as const) {
			await navigate(member, route);
			await capture(member, title, caption);
		}
		await member
			.getByRole('button', { name: 'Revoke all sessions', exact: true })
			.click();
		await capture(
			member,
			'Security — session-revocation confirmation',
			'Safe open confirmation only; Keep sessions is chosen afterward.',
		);
		await cancelDialog(member, 'Keep sessions');
		await navigate(member, `/members/${members[0].id}`);
		await capture(
			member,
			'Member profile — Neighbor',
			'This temporary synthetic profile has no paid badge and no invented contribution history.',
		);
		await member
			.getByRole('button', { name: 'Edit profile', exact: true })
			.click();
		await capture(
			member,
			'Profile — badge privacy option',
			'The profile editor offers an opt-in paid badge; opting in alone never grants a paid tier. No changes are submitted.',
		);
		await cancelDialog(member);
		expectedMemberDenial.add(member);
		await navigate(member, '/admin');
		await expect(
			member.getByRole('heading', { name: 'This page is not here.' }),
		).toBeVisible();
		await capture(
			member,
			'Administration — member access denied',
			'An ordinary authenticated member cannot see the administrator dashboard.',
		);
		expectedMemberDenial.delete(member);

		const admin = await newPage();
		phase = 'sign in fresh administrator';
		await login(admin, members[2]);
		await navigate(admin, '/admin');
		await capture(
			admin,
			'Operations — actual environment overview',
			'Live-query metrics from isolated staging, including synthetic activity. This is not production fundraising performance.',
		);
		await expect(
			admin.getByText('Thirty days, in context.', { exact: true }),
		).toBeVisible();
		await capture(
			admin,
			'Operations — measured trends',
			'Daily net giving and request timing use measured records. Missing latency is not rendered as a fabricated zero.',
			admin.getByText('Thirty days, in context.', { exact: true }),
		);
		await admin
			.getByText('Definitions and exact daily measurements', {
				exact: true,
			})
			.click();
		await capture(
			admin,
			'Operations — definitions and daily table',
			'Open metric definitions and exact UTC daily values make the chart auditable.',
			admin.getByText('Definitions and exact daily measurements', {
				exact: true,
			}),
		);
		await navigate(admin, '/admin/activity');
		await capture(
			admin,
			'Activity — live audit feed',
			'Real server-recorded events, separate from model intentions and provider confirmations. Live polling is not a fabricated replay.',
		);
		const details = admin
			.getByText('Recorded details', { exact: true })
			.first();
		if (await details.count()) {
			await details.click();
			await capture(
				admin,
				'Activity — open recorded details',
				'An actual event’s allowlisted details. No private tokens or model reasoning are added.',
				details,
			);
		}
		const older = admin.getByRole('button', {
			name: 'Older activity →',
			exact: true,
		});
		if (await older.count()) {
			await older.click();
			await expect(
				admin.getByRole('heading', {
					name: 'Activity archive',
					exact: true,
				}),
			).toBeVisible();
			await capture(
				admin,
				'Activity — historical records',
				'The older-activity view stops live polling and requests a real cursor page.',
			);
		}
		await navigate(admin, '/admin/users');
		await capture(
			admin,
			'Members — administrator directory',
			'Actual registered accounts with synthetic labels. Email addresses are masked in the exported walkthrough.',
		);
		await navigate(admin, `/admin/users/${members[0].id}`);
		await capture(
			admin,
			'Member — account and receiving review',
			'A real temporary Neighbor account: public profile, private account facts, receiving readiness, subscriptions, and action history.',
		);
		await admin
			.getByRole('button', { name: 'Freeze account', exact: true })
			.click();
		await capture(
			admin,
			'Member — freeze confirmation',
			'Safe open confirmation with a required reason and elevation requirement. No account is frozen.',
		);
		await cancelDialog(admin);
		await navigate(admin, '/admin/payments');
		await capture(
			admin,
			'Payments — recovery and records',
			'Actual payment/recovery queues. Empty queues do not prove that provider-backed acceptance has passed. Reconciliation is not triggered.',
		);
		await admin
			.getByText('Authorize sensitive actions', { exact: true })
			.click();
		await capture(
			admin,
			'Payments — sensitive-action boundary',
			'Administrator elevation is required for sensitive operations. This fresh admin is not enrolled during capture.',
			admin.getByText('Authorize sensitive actions', { exact: true }),
		);
		await admin
			.locator('li')
			.filter({
				has: admin.getByText(operatorCaseSummary, { exact: true }),
			})
			.getByRole('button', { name: 'Review case', exact: true })
			.click();
		await capture(
			admin,
			'Payments — case review dialog',
			'Explicit synthetic nonfinancial case. The open dialog records acknowledgement or escalation only; it cannot mark money recovered. No review is submitted.',
		);
		await admin
			.getByRole('dialog')
			.getByRole('combobox', { name: 'Review action' })
			.click();
		await admin
			.getByRole('option', {
				name: 'Escalate for investigation',
				exact: true,
			})
			.click();
		await capture(
			admin,
			'Payments — escalation option',
			'The escalation choice still requires a private note and appropriate authorization. This screenshot creates no recovery claim or operator event.',
		);
		await cancelDialog(admin, 'Close');
		await admin
			.getByLabel('Find a payment-enabled Ask', { exact: true })
			.fill(operatorAskTitle);
		await admin
			.getByRole('button', { name: 'Search Asks', exact: true })
			.click();
		await capture(
			admin,
			'Payments — per-Ask controls',
			`One synthetic unpaid Ask demonstrates the new-payment reservation control. Actual staging gates: Ask payments ${availability.askPayments ? 'on' : 'off'}, Supporter subscriptions ${availability.subscriptions ? 'on' : 'off'}, funds ${availability.funds ? 'on' : 'off'}.`,
			admin.getByText('Ask payment controls', { exact: true }),
		);
		await admin
			.getByRole('button', { name: 'Pause new payments', exact: true })
			.click();
		await capture(
			admin,
			'Payments — pause confirmation',
			'Open confirmation explains that existing Checkouts may still settle and refunds/recovery continue. The action is canceled without modifying this Ask.',
		);
		await cancelDialog(admin);
		omitted.push({
			route: '/admin/payments/[id]',
			reason: 'The new capture fixtures have no financial record; existing historical financial records are not selected or fabricated by this capture. The generic operator-review dialog uses an explicitly synthetic nonfinancial case. Refund states still require genuine provider-confirmed refundable payments.',
		});
		await navigate(admin, '/admin/funds');
		await capture(
			admin,
			'Funds — allocation workspace',
			'Available funds, reservations, and allocation controls reflect the actual environment and enabled features.',
		);
		const createFund = admin.getByRole('button', {
			name: 'Create a community fund',
			exact: true,
		});
		if (await createFund.isEnabled()) {
			await createFund.click();
			await capture(
				admin,
				'Funds — create dialog',
				'A safe open form only. No fund is created and no money is allocated.',
			);
			await cancelDialog(admin);
		} else
			omitted.push({
				route: '/admin/funds#dialogs',
				reason: 'Fund creation/allocation is disabled by the genuine environment gate; disabled controls were not bypassed.',
			});
		await navigate(admin, '/account/security');
		await capture(
			admin,
			'Administrator security',
			'Administrator setup and short-lived elevation entry points. Authenticator secrets are deliberately excluded.',
		);
		await navigate(admin, '/admin/simulations');
		await capture(
			admin,
			'Simulations — real run history',
			'Independent synthetic agents share bounded local inference. Run names, statuses, and populations are actual records.',
		);
		const createRun = admin.getByRole('button', {
			name: 'Create simulation run',
			exact: true,
		});
		if (await createRun.isEnabled()) {
			await createRun.click();
			await capture(
				admin,
				'Simulations — create a test neighborhood',
				'The open form distinguishes autonomous model actions from deterministic scenarios. Creating a record does not start a process.',
			);
			await cancelDialog(admin);
		}
		const runsResponse = await rpc(
			admin.request,
			'admin.simulations',
			undefined,
			'get',
		);
		expect(runsResponse.status).toBe(200);
		const runs =
			runsResponse.data as unknown as RouterOutputs['admin']['simulations'];
		const run = simulationRunId ? runs.items.find((item) => item.id === simulationRunId) : undefined;
		if (simulationRunId) expect(run, 'The explicitly pinned run must be present in the normal administrator run list.').toBeDefined();
		if (run) {
			const detailResponse = await rpc(
				admin.request,
				'admin.simulation',
				{ id: run.id },
				'get',
			);
			expect(detailResponse.status).toBe(200);
			const detail =
				detailResponse.data as unknown as RouterOutputs['admin']['simulation'];
			observedRuns.push({
				id: run.id,
				mode: detail.run.mode,
				status: detail.run.status,
				registeredAgents: detail.agents.length,
			});
			await navigate(admin, `/admin/simulations/${run.id}`);
			await capture(
				admin,
				'Simulation — control room',
				`Actual ${detail.run.mode} run, observed state ${detail.run.status}, with ${detail.agents.length} registered agents. No command is submitted by the capture.`,
			);
			const stop = admin.getByRole('button', {
				name: 'Stop & checkpoint',
				exact: true,
			});
			if (await stop.isEnabled()) {
				await stop.click();
				await capture(
					admin,
					'Simulation — stop confirmation',
					'Safe open confirmation only. Keep running is chosen afterward, and no runner command is submitted.',
				);
				await cancelDialog(admin, 'Keep running');
			} else
				omitted.push({
					route: `/admin/simulations/${run.id}#stop`,
					reason: 'The run does not currently permit a stop command; the disabled control was not bypassed.',
				});
			const grid = admin.getByRole('heading', {
				name: `${detail.agents.length} of ${detail.agents.length} registered agents`,
				exact: true,
			});
			if (await grid.count())
				await capture(
					admin,
					'Simulation — individual agents',
					'Each card is a stored independent agent with a real current state and click-through history. Cohort labels do not prove a paid subscription.',
					grid,
				);
			const agent = detail.agents[0];
			if (agent) {
				await navigate(
					admin,
					`/admin/simulations/${run.id}/agents/${agent.id}`,
				);
				await capture(
					admin,
					'Simulation — one agent and its intentions',
					'An actual synthetic agent’s persona, reported state, completed cycles, and historical events. This is not private model chain-of-thought.',
				);
			}
		} else
			omitted.push({
				route: '/admin/simulations/[id]',
				reason: 'WALKTHROUGH_SIMULATION_RUN_ID was not set. No arbitrary historical run was selected, and no fake running simulation was inserted.',
			});
		const completedRun = run?.status === 'completed' ? run : undefined;
		if (completedRun) {
			const result = await rpc(
				admin.request,
				'admin.simulation',
				{ id: completedRun.id },
				'get',
			);
			expect(result.status).toBe(200);
			const completed =
				result.data as unknown as RouterOutputs['admin']['simulation'];
			await navigate(admin, `/admin/simulations/${completedRun.id}`);
			await capture(
				admin,
				'Simulation — completed run',
				`Actual completed ${completed.run.mode} run with ${completed.agents.length} registered agents. Terminal controls remain disabled; retained events document the work.`,
			);
			const completedAgent =
				completed.agents.find((agent) => agent.cycles > 0) ??
				completed.agents[0];
			if (completedAgent) {
				await navigate(
					admin,
					`/admin/simulations/${completedRun.id}/agents/${completedAgent.id}`,
				);
				await capture(
					admin,
					'Simulation — completed agent history',
					'An actual completed agent’s cycle count and retained activity, separate from merely seeded accounts.',
				);
				await capture(
					admin,
					'Simulation — completed recorded actions',
					'Persisted server-recorded events from the completed run. Historical actions are real staging operations, not fictional successful payments.',
					admin.getByRole('heading', {
						name: 'Recorded actions',
						exact: true,
					}),
				);
			}
		} else omitted.push({ route: '/admin/simulations/[id]#completed', reason: 'The explicitly selected run is not completed, or no run was pinned. No unrelated completed history is substituted for this state.' });
		for (const [page, route, title, caption] of [
			[
				guest,
				'/support',
				'Mobile — supporter plans',
				'390-pixel public layout with the same honest tier and availability information.',
			],
			[
				member,
				'/giving',
				'Mobile — private giving',
				'Actual empty giving history and responsive account navigation.',
			],
			[
				member,
				'/account/security',
				'Mobile — account security',
				'Security entry points remain usable on a narrow screen; no secrets are displayed.',
			],
			[
				admin,
				'/admin',
				'Mobile — administrator overview',
				'Actual measurements and navigation at 390 pixels. Wide data tables keep their own scrolling region.',
			],
			[
				admin,
				run ? `/admin/simulations/${run.id}` : '/admin/simulations',
				'Mobile — simulation control room',
				'The actual run/control state on a narrow viewport; no background agent is started by this capture.',
			],
		] as const) {
			await page.setViewportSize(mobile);
			await navigate(page, route);
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						window.innerWidth,
				),
			).toBe(true);
			await capture(page, title, caption);
		}
		status = diagnostics.length ? 'captured-with-diagnostics' : 'captured';
	} catch (error) {
		status = 'capture-incomplete';
		// Preserve only a classification, not the raw error/call log: locators or
		// URLs around sign-in could otherwise disclose entered credentials.
		diagnostics.push({
			kind: error instanceof Error ? error.name : 'capture-error',
			route: 'capture',
			source:
				error instanceof Error ?
					(error.stack
						?.match(
							/(?:payments-walkthrough\.spec|fixtures)\.ts:\d+:\d+/g,
						)
						?.join(', ') ?? phase)
				:	phase,
		});
		throw new Error(
			'Staging walkthrough capture did not complete. See the redacted manifest and the last captured view.',
		);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
		try {
			if (operatorAskId)
				await testSql`DELETE FROM givetogive_payment_ask_settings WHERE ask_id=${operatorAskId}`;
			await testSql`DELETE FROM givetogive_payment_case WHERE id=${operatorCaseId} AND key=${operatorCaseKey}`;
			await cleanMembers(members.map(({ id }) => id));
			cleanup =
				'temporary capture accounts removed; append-only audit events retained';
		} catch {
			cleanup =
				'cleanup failed; exact temporary account IDs require operator review';
			status = 'capture-incomplete';
			throw new Error(
				'Walkthrough fixture cleanup failed. No broad deletion was attempted.',
			);
		} finally {
			await saveManifest();
		}
	}
});
