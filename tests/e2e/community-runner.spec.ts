import { test, expect } from '@playwright/test';
import { makeMembers, cleanMembers } from './fixtures';
import { type ApiRejection, UiSession } from '../../tools/simulation/src/ui-session';
import { verifyBrowserMutationResponse } from '../../tools/simulation/src/browser-response';
import superjson from 'superjson';
import { CommunityBrowser } from '../../tools/simulation/src/community-browser';
import { protectionSecret } from '../../tools/simulation/src/protection';
import {
	parseActivity,
	executeActivity,
	type EntityRef,
} from '../../tools/simulation/src/activity';

let members: Awaited<ReturnType<typeof makeMembers>>;
test.beforeAll(async () => {
	members = await makeMembers();
});
test.afterAll(async () => {
	if (members) await cleanMembers(members.map((member) => member.id));
});

test('real normal-auth browser and script accounts discover, save, contribute, cancel and complete each other’s activity', async ({
	baseURL,
}) => {
	test.setTimeout(180000);
	if (new URL(baseURL!).protocol === 'https:')
		process.env['SIM_PROTECTION_BYPASS_FILE'] ??=
			'tools/simulation/.state/protection.json';
	const bypass = protectionSecret();
	const sessions: UiSession[] = [];
	const browsers = new CommunityBrowser(2);
	try {
		for (const member of members)
			sessions.push(
				await UiSession.signIn(
					baseURL!,
					{
						...member,
						userId: member.id,
					},
					bypass,
				),
			);
		const refs = new Map<string, EntityRef>();
		const title = `Runner browser ask ${members[0].id.slice(0, 8)}`;
		const rows = parseActivity(
			[
				{
					id: 'post',
					user: 'owner',
					action: 'create_ask',
					ref: 'neighbor-help',
					input: {
						title,
						description:
							'Synthetic neighbors need three small tasks done together.',
						type: 'task',
						goalAmount: 3,
					},
				},
				{
					id: 'script-offer',
					user: 'helper',
					action: 'contribute',
					ref: 'script-pledge',
					ask: { match: { query: title, type: 'task' } },
					amount: 1,
				},
				{
					id: 'duplicate-title',
					user: 'helper',
					action: 'create_ask',
					ref: 'title-duplicate',
					input: {
						title,
						description:
							'A different synthetic Ask deliberately shares this title.',
						type: 'task',
						goalAmount: 3,
					},
				},
				{
					id: 'save',
					user: 'browser',
					action: 'save_ask',
					ask: { ref: 'neighbor-help' },
					saved: true,
				},
				{
					id: 'browser-offer',
					user: 'browser',
					action: 'contribute',
					ref: 'browser-pledge',
					ask: { ref: 'neighbor-help' },
					amount: 1,
				},
				{
					id: 'cancel',
					user: 'browser',
					action: 'set_contribution_status',
					contribution: {
						match: {
							as: 'contributor',
							ask: { ref: 'neighbor-help' },
						},
					},
					status: 'cancelled',
				},
				{
					id: 'complete',
					user: 'owner',
					action: 'set_contribution_status',
					contribution: {
						match: { as: 'owner', ask: { ref: 'neighbor-help' } },
					},
					status: 'completed',
				},
				{ id: 'browse', user: 'browser', action: 'browse' },
			]
				.map((row) => JSON.stringify(row))
				.join('\n'),
		);
		const actors = {
			owner: sessions[0]!,
			helper: sessions[1]!,
			browser: sessions[2]!,
		};
		const admitted: string[] = [];
		for (const line of rows) {
			const session = actors[line.user as keyof typeof actors];
			const result = await executeActivity(session, line, refs, {
				beforeMutation: (procedure) => {
					admitted.push(procedure);
				},
				...(line.user !== 'helper' ?
					{
						browserAction: (activity, ask, admission, entity) =>
							browsers.action(
								session,
								activity,
								ask,
								bypass,
								admission,
								entity,
							),
					}
				:	{}),
			});
			expect(result.outcome).toBe('success');
			if (line.ref && result.entity) refs.set(line.ref, result.entity);
		}
		const detail = (await actors.owner.query('ask.getAsk', {
			id: refs.get('neighbor-help')!.id,
		})) as {
			createdById: string;
			contributedAmount: number;
			completedAmount: number;
			contributions: Array<{ id: number; status: string }>;
		};
		expect(detail.createdById).toBe(members[0].id);
		const saved = (await actors.browser.query('ask.getAsks', {
			query: title,
			savedOnly: true,
		})) as Array<{ id: number }>;
		expect(saved.map((ask) => ask.id)).toEqual([
			refs.get('neighbor-help')!.id,
		]);
		expect(refs.get('title-duplicate')!.id).not.toBe(
			refs.get('neighbor-help')!.id,
		);
		expect(detail.contributedAmount).toBe(1);
		expect(detail.completedAmount).toBe(1);
		expect(
			detail.contributions.find(
				(row) => row.id === refs.get('browser-pledge')!.id,
			)?.status,
		).toBe('cancelled');
		expect(admitted).toEqual([
			'ask.createAsk',
			'ask.createContribution',
			'ask.createAsk',
			'ask.setSaved',
			'ask.createContribution',
			'ask.updateContributionStatus',
			'ask.updateContributionStatus',
		]);
		// The script fills the last slot after selection but before the browser
		// acts. A confirmed stale target must wait, never halt or submit again.
		const raceAsk = (await actors.owner.mutate('ask.createAsk', {
			title: `${title} stale target`,
			description:
				'Synthetic race: one remaining task is filled while a browser navigates.',
			type: 'task',
			goalAmount: 1,
			difficulty: 2,
			estimatedMinutesToComplete: 30,
		})) as { newlyCreatedAskId: number };
		const [raceLine] = parseActivity(
			JSON.stringify({
				id: 'stale-help',
				user: 'browser',
				action: 'contribute',
				ask: { id: raceAsk.newlyCreatedAskId },
				amount: 1,
			}),
		);
		let browserAdmissions = 0;
		const raceResult = await executeActivity(
			actors.browser,
			raceLine!,
			refs,
			{
				beforeMutation() {
					browserAdmissions++;
				},
				browserAction: async (line, selected, admission, entity) => {
					await actors.helper.mutate('ask.createContribution', {
						askId: selected!.id,
						amount: 1,
					});
					return browsers.action(
						actors.browser,
						line,
						selected,
						bypass,
						admission,
						entity,
					);
				},
			},
		);
		expect(raceResult.outcome).toBe('waiting');
		expect(browserAdmissions).toBe(0);
		const raceDetail = (await actors.browser.query('ask.getAsk', {
			id: raceAsk.newlyCreatedAskId,
		})) as { contributions: Array<{ contributorId: string }> };
		expect(
			raceDetail.contributions.map((item) => item.contributorId),
		).toEqual([members[1].id]);
		// Real server failure on the same stream transport used by the UI:
		// HTTP 200 and application/json still contain an authoritative rejection.
		const rejectedResponse = await actors.browser.context.post(
			`${baseURL}/api/trpc/ask.createContribution?batch=1`,
			{
				headers: { 'trpc-accept': 'application/jsonl' },
				data: {
					0: superjson.serialize({
						askId: raceAsk.newlyCreatedAskId,
						amount: 1,
					}),
				},
				maxRedirects: 0,
			},
		);
		try {
			expect(rejectedResponse.status()).toBe(200);
			expect(rejectedResponse.headers()['content-type']).toContain(
				'application/json',
			);
			await expect(
				verifyBrowserMutationResponse(
					rejectedResponse.status(),
					'application/jsonl',
					await rejectedResponse.body(),
				),
			).rejects.toMatchObject({
				status: 400,
				code: 'BAD_REQUEST',
			} satisfies Partial<ApiRejection>);
		} finally {
			await rejectedResponse.dispose();
		}
		const afterRejection = (await actors.browser.query('ask.getAsk', {
			id: raceAsk.newlyCreatedAskId,
		})) as typeof raceDetail;
		expect(afterRejection.contributions).toEqual(raceDetail.contributions);
		await expect(
			actors.helper.mutate('admin.createSimulation', {}),
		).rejects.toThrow('allowlist');
		await expect(
			UiSession.signIn(
				baseURL!,
				{
					...members[0],
					userId: members[1].id,
				},
				bypass,
			),
		).rejects.toThrow('identity');
	} finally {
		await Promise.allSettled(sessions.map((session) => session.close()));
		await browsers.close();
	}
});
