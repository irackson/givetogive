import { chromium, type Browser, type BrowserContext } from 'playwright';
import { z } from 'zod';
import { safeBrowsePath } from './browser.ts';
import {
	ActivitySelectionChanged,
	freshContributionTarget,
	freshContributionStatusTarget,
	type Activity,
	type Ask,
	type EntityRef,
} from './activity.ts';
import { protectionHeaders } from './protection.ts';
import { ApiRejection, UiObservationUnavailable, type UiSession } from './ui-session.ts';
import {
	BrowserWorkflowFailure, BrowserObservationUnavailable, BrowserApiRejection, observeContributionControl, observeContributionStatusControl, isBeforeMutationObservation,
	type BrowserObservationState,
} from './browser-observation.ts';
import { Semaphore } from './semaphore.ts';
import {
	BrowserMutationUnresolved,
	verifyBrowserMutationResponse,
} from './browser-response.ts';

const units = {
	time: 'minutes',
	task: 'tasks',
	item: 'items',
	resource: 'units',
} as const;
export class CommunityBrowser {
	readonly slots: Semaphore;
	private opening?: Promise<Browser>;
	private readonly launch: () => Promise<Browser>;
	constructor(concurrency: number, launch = () => chromium.launch({ headless: true })) {
		this.slots = new Semaphore(concurrency, 30);
		this.launch = launch;
	}
	async action(
		api: UiSession,
		line: Activity,
		ask?: Ask,
		bypass?: string,
		beforeMutation?: (procedure: string) => void,
		entity?: EntityRef,
		admit?: () => void,
	): Promise<EntityRef | undefined> {
		return this.slots.run(async () => {
			admit?.();
			const observation: BrowserObservationState = {
				phase: 'browser_open', mutationAdmitted: false, mutationSent: false,
				pageErrors: 0, consoleErrors: 0,
			};
			let context: BrowserContext | undefined;
			let admissionError: unknown;
			try {
				this.opening ??= this.launch();
				const browser = await this.opening;
				context = await browser.newContext({
					storageState: await api.context.storageState(),
					viewport: { width: 1280, height: 900 },
				});
				let rejectAdmission!: (error: unknown) => void;
				const admissionFailed = new Promise<never>(
					(__resolve, reject) => {
						rejectAdmission = reject;
					},
				);
				void admissionFailed.catch(() => undefined);
				let resolveMutation!: () => void;
				let rejectMutation!: (error: unknown) => void;
				const mutationVerified = new Promise<void>(
					(resolve, reject) => {
						resolveMutation = resolve;
						rejectMutation = reject;
					},
				);
				void mutationVerified.catch(() => undefined);
				const expected =
					line.action === 'create_ask' ? 'ask.createAsk'
					: line.action === 'save_ask' ? 'ask.setSaved'
					: line.action === 'contribute' ? 'ask.createContribution'
					: line.action === 'set_contribution_status' ?
						'ask.updateContributionStatus'
					:	undefined;
				await context.route('**/*', async (route) => {
					const sameOrigin =
						new URL(route.request().url()).origin === api.origin;
					if (
						sameOrigin &&
						route.request().method() === 'POST' &&
						new URL(route.request().url()).pathname.startsWith(
							'/api/trpc/',
						)
					) {
						if (
							!expected ||
							new URL(route.request().url()).pathname !==
								`/api/trpc/${expected}` ||
							observation.mutationSent
						) {
							await route.abort();
							return;
						}
						try {
							observation.phase = 'mutation_admission';
							beforeMutation?.(expected);
							observation.mutationAdmitted = true;
							observation.mutationSent = true;
							observation.phase = 'mutation_request';
						} catch (error) {
							admissionError = error;
							rejectAdmission(error);
							await route.abort();
							return;
						}
						// Capture the one real UI request before forwarding its response.
						// Chromium can discard a streaming body during success navigation.
						// No retries/redirects: an uncertain mutation stays uncertain.
						let response;
						try {
							response = await route.fetch({
								headers: {
									...route.request().headers(),
									...protectionHeaders(bypass),
								},
								maxRetries: 0,
								maxRedirects: 0,
								timeout: 30000,
							});
							const body = await response.body();
							observation.phase = 'mutation_response';
							let failure: unknown;
							try {
								await verifyBrowserMutationResponse(
									response.status(),
									route.request().headers()['trpc-accept'] ??
										'',
									body,
								);
							} catch (error) {
								failure = error;
							}
							await route.fulfill({ response, body });
							if (failure) rejectMutation(failure);
							else resolveMutation();
						} catch {
							rejectMutation(
								new BrowserMutationUnresolved(
									'response-forwarding',
								),
							);
							await route.abort().catch(() => undefined);
						} finally {
							await response?.dispose();
						}
						return;
					}
					if (route.request().isNavigationRequest() && !sameOrigin)
						await route.abort();
					else
						await route.continue({
							headers: {
								...route.request().headers(),
								...(sameOrigin ?
									protectionHeaders(bypass)
								:	{}),
							},
						});
				});
				await context.setExtraHTTPHeaders({});
				// Bypass attaches only to this origin, including the context API verification.
				const headers = protectionHeaders(bypass);
				observation.phase = 'identity';
				const response = await context.request.get(
					`${api.origin}/api/auth/session`,
					{ headers, maxRedirects: 0 },
				);
				try {
					const value = await response.json();
					if (value?.user?.id !== api.userId)
						throw new Error(
							'Browser identity does not match its controller.',
						);
				} finally {
					await response.dispose();
				}
				const page = await context.newPage();
				page.on('pageerror', () => {
					observation.pageErrors++;
				});
				page.on('console', (message) => {
					if (message.type() === 'error') observation.consoleErrors++;
				});
				const checked = <T>(value: T): T => {
					// Never log raw console bodies: they can contain private server responses.
					if (observation.pageErrors || observation.consoleErrors)
						throw new BrowserWorkflowFailure(observation);
					return value;
				};
				const confirmMutation = async (
					click: () => Promise<unknown>,
				) => {
					checked(undefined);
					observation.phase = 'mutation_admission';
					let timer: ReturnType<typeof setTimeout> | undefined;
					const deadline = new Promise<never>((__resolve, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new BrowserMutationUnresolved(
										'request-response-timeout',
									),
								),
							30000,
						);
					});
					try {
						await Promise.race([
							Promise.all([mutationVerified, click()]),
							admissionFailed,
							deadline,
						]);
					} finally {
						clearTimeout(timer);
					}
					observation.phase = 'ui_transition';
					// The decoded response is not enough: callers still wait for the
					// UI transition and verify the exact entity with their own API.
				};
				if (line.action === 'browse') {
					observation.phase = 'navigation';
					await page.goto(safeBrowsePath(line.path, api.origin).href);
					observation.phase = 'browse_view';
					await page.locator('main').waitFor();
					await page
						.getByRole('form', { name: 'Filter Asks' })
						.waitFor();
					await page
						.getByText('Loading the noticeboard…', { exact: true })
						.waitFor({ state: 'hidden' });
					return checked(undefined);
				}
				if (line.action === 'create_ask') {
					observation.phase = 'navigation';
					await page.goto(`${api.origin}/asks`);
					observation.phase = 'create_form';
					await page
						.getByRole('button', {
							name: 'Post an ask',
							exact: true,
						})
						.click();
					await page
						.getByLabel('Title', { exact: true })
						.fill(line.input.title);
					await page
						.getByLabel('Description', { exact: true })
						.fill(line.input.description);
					await page
						.getByRole('combobox', {
							name: 'Ask type',
							exact: true,
						})
						.click();
					const label =
						line.input.type[0]!.toUpperCase() +
						line.input.type.slice(1);
					await page
						.getByRole('option', { name: label, exact: true })
						.click();
					await page
						.getByLabel(`Goal (${units[line.input.type]})`, {
							exact: true,
						})
						.fill(String(line.input.goalAmount));
					await page
						.getByLabel(/^Estimated minutes to complete$/i)
						.fill(String(line.input.estimatedMinutesToComplete));
					await page.getByRole('slider').press('Home');
					for (let i = 1; i < line.input.difficulty; i++)
						await page.getByRole('slider').press('ArrowRight');
					await confirmMutation(() =>
						page
							.getByRole('button', {
								name: 'Create Ask',
								exact: true,
							})
							.click(),
					);
					await page.waitForURL((url) =>
						/^\/asks\/[^/]+$/.test(url.pathname),
					);
					observation.phase = 'entity_verification';
					const result = z
						.object({
							id: z.number().int().positive(),
							createdById: z.string(),
						})
						.parse(
							await api.query('ask.getAsk', {
								slug: decodeURIComponent(
									new URL(page.url()).pathname
										.split('/')
										.at(-1)!,
								),
							}),
						);
					if (result.createdById !== api.userId)
						throw new Error(
							'Created Ask ownership does not match this browser account.',
						);
					return checked({ kind: 'ask', id: result.id });
				}
				if (line.action === 'set_contribution_status') {
					observation.phase = 'contribution_history';
					if (!entity?.askId || entity.kind !== 'contribution')
						throw new Error(
							'Browser contribution history needs its exact parent Ask reference.',
						);
					await page.goto(`${api.origin}/asks/${entity.askId}`);
					const row = page.locator(
						`[data-contribution-id="${entity.id}"]`,
					);
					const dialog = page.getByRole('dialog');
					await observeContributionStatusControl(observation,
						() => freshContributionStatusTarget(api, entity, line.status),
						async () => {
							await row.waitFor();
							await row.getByRole('button', {
								name: line.status === 'completed' ? 'Mark complete' : 'Cancel',
								exact: true,
							}).click();
							await dialog.waitFor();
						}, admit);
					await confirmMutation(() =>
						dialog
							.getByRole('button', {
								name:
									line.status === 'completed' ?
										'Mark complete'
									:	'Cancel pledge',
								exact: true,
							})
							.click(),
					);
					await dialog.waitFor({ state: 'hidden' });
					observation.phase = 'entity_verification';
					const detail = (await api.query('ask.getAsk', {
						id: entity.askId,
					})) as {
						contributions: Array<{ id: number; status: string }>;
					};
					if (
						detail.contributions.find(
							(item) => item.id === entity.id,
						)?.status !== line.status
					)
						throw new Error(
							'Contribution history does not match the browser confirmation.',
						);
					return checked(entity);
				}
				if (!ask)
					throw new Error(
						'This browser action needs its selected Ask.',
					);
				if (line.action === 'save_ask') {
					observation.phase = 'saved_view';
					const detail = z
						.object({
							title: z.string(),
							slug: z.string(),
							saved: z.boolean().optional(),
						})
						.parse(await api.query('ask.getAsk', { id: ask.id }));
					await page.goto(
						`${api.origin}/asks?q=${encodeURIComponent(detail.title)}`,
					);
					// Titles are not unique, especially across simulation runs. Target the
					// canonical entity link so a click cannot save a different matching Ask.
					const card = page.locator('.ask-card').filter({
						has: page.locator(
							`a[href=${JSON.stringify(`/asks/${encodeURIComponent(detail.slug)}`)}]`,
						),
					});
					await card.waitFor();
					const button = card.getByRole('button', {
						name: new RegExp(line.saved ? '^Save ' : '^Remove '),
					});
					if (await button.count())
						await confirmMutation(() => button.click());
					await card
						.getByRole('button', {
							name:
								line.saved ?
									`Remove ${detail.title} from saved Asks`
								:	`Save ${detail.title}`,
							exact: true,
						})
						.waitFor();
					observation.phase = 'entity_verification';
					const saved = (await api.query('ask.getAsks', {
						query: detail.title,
						savedOnly: true,
					})) as Array<{ id: number }>;
					if (saved.some((item) => item.id === ask.id) !== line.saved)
						throw new Error(
							'Saved state did not match the UI action.',
						);
					return checked({ kind: 'ask', id: ask.id });
				}
				if (line.action === 'contribute') {
					observation.phase = 'contribution_target';
					if (ask.type === 'money')
						throw new Error(
							'Use the dedicated sandbox payment scenario for monetary Checkout.',
						);
					await freshContributionTarget(api, ask.id, line.amount);
					const before = (await api.query('ask.getAsk', {
						id: ask.id,
					})) as { contributions: Array<{ id: number }> };
					const known = new Set(
						before.contributions.map((item) => item.id),
					);
					observation.phase = 'contribution_view';
					await page.goto(`${api.origin}/asks/${ask.id}`);
					await page.locator('.ask-detail').waitFor();
					const offer = page.getByRole('button', {
						name: 'Offer a contribution',
						exact: true,
					});
					await observeContributionControl(
						observation,
						() => freshContributionTarget(api, ask.id, line.amount),
						async () => (await offer.count()) === 1 && await offer.isVisible(),
						async () => {
							await page.reload();
							await page.locator('.ask-detail').waitFor();
						},
						admit,
					);
					observation.phase = 'contribution_form';
					await offer.click();
					await page
						.getByRole('dialog')
						.getByLabel(`Amount (${units[ask.type]})`)
						.fill(String(line.amount));
					if (line.note)
						await page
							.getByLabel('A note for the asker (optional)')
							.fill(line.note);
					await confirmMutation(() =>
						page
							.getByRole('button', {
								name: 'Confirm contribution',
								exact: true,
							})
							.click(),
					);
					await page.getByRole('dialog').waitFor({ state: 'hidden' });
					observation.phase = 'entity_verification';
					const after = (await api.query('ask.getAsk', {
						id: ask.id,
					})) as {
						contributions: Array<{
							id: number;
							contributorId: string;
						}>;
					};
					const created = after.contributions.filter(
						(item) =>
							!known.has(item.id) &&
							item.contributorId === api.userId,
					);
					if (created.length !== 1)
						throw new Error(
							'Could not establish one authoritative browser contribution result.',
						);
					return checked({
						kind: 'contribution',
						id: created[0]!.id,
						askId: ask.id,
					});
				}
				throw new Error(
					'Browser workflow is not implemented for this action yet.',
				);
			} catch (error) {
				if (observation.pageErrors || observation.consoleErrors)
					throw new BrowserWorkflowFailure(observation);
				if (admissionError !== undefined && error === admissionError) throw error;
				if (error instanceof BrowserWorkflowFailure) throw error;
				if (error instanceof ApiRejection) throw new BrowserApiRejection(error, observation);
				if (error instanceof ActivitySelectionChanged) throw error;
				if (error instanceof UiObservationUnavailable && isBeforeMutationObservation(observation))
					throw new BrowserObservationUnavailable(observation);
				// Playwright errors can embed DOM text, URLs or form values. Keep
				// public telemetry phase-only; never persist their raw diagnostics.
				throw new BrowserWorkflowFailure(observation);
			} finally {
				try { await context?.close(); }
				catch {
					observation.phase = 'context_close';
					throw new BrowserWorkflowFailure(observation);
				}
			}
		});
	}
	async close() {
		if (this.opening) await (await this.opening).close();
	}
}
