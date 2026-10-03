import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	browserAccounts,
	readCommunityCredentials,
	validateCommunity,
} from './community-config.ts';
import { parseActivity } from './activity.ts';

const { credentials, settings } = validateCommunity(
	readCommunityCredentials(
		process.env.SIM_CREDENTIALS ?? '.state/credentials.json',
	),
	{
		browserUsers: process.env.SIM_BROWSER_USERS,
		browserConcurrency: process.env.SIM_BROWSER_CONCURRENCY,
	},
);
const output =
	process.env.SIM_ACTIVITY_FILE ??
	`.state/runs/${credentials.runId}/activity.jsonl`;
const browserIds = new Set(
	browserAccounts(credentials, settings.browserUsers).map(
		(account) => account.id,
	),
);
const rows = credentials.agents.flatMap((account, index) => {
	const type = (['task', 'time', 'item', 'resource'] as const)[index % 4]!;
	const helper = {
		id: `help-${index}`,
		user: account.id,
		action: 'contribute',
		everySeconds: 60,
		ask: { match: { type } },
		amount: type === 'time' ? 5 : 1,
		note: 'Synthetic rehearsal: I can help with this part.',
	};
	return [
		{
			id: `browse-${index}`,
			user: account.id,
			action: 'browse',
			path: '/asks',
			everySeconds: 45,
		},
		...(browserIds.has(account.id) || index % 5 === 0 ?
			[
				{
					id: `post-${index}`,
					user: account.id,
					action: 'create_ask',
					everySeconds: 180,
					input: {
						title: `Community rehearsal ${type} ${index + 1}`,
						description:
							'Synthetic community request to test neighbors helping one another.',
						type,
						goalAmount: type === 'time' ? 60 : 5,
					},
				},
			]
		:	[]),
		helper,
		{
			id: `save-${index}`,
			user: account.id,
			action: 'save_ask',
			everySeconds: 120,
			ask: { match: { type } },
			saved: true,
		},
		{
			id: `deliver-${index}`,
			user: account.id,
			action: 'set_contribution_status',
			everySeconds: 90,
			status: 'completed',
			contribution: {
				match: {
					as: 'owner',
					ask: { match: { query: 'Community rehearsal', type } },
				},
			},
		},
		...(index % 5 === 1 ?
			[
				{
					id: `cancel-${index}`,
					user: account.id,
					action: 'set_contribution_status',
					everySeconds: 150,
					status: 'cancelled',
					contribution: {
						match: {
							as: 'contributor',
							ask: {
								match: { query: 'Community rehearsal', type },
							},
						},
					},
				},
			]
		:	[]),
	];
});
const source = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
parseActivity(source);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, source, { flag: 'wx' });
console.log(
	JSON.stringify({
		file: output,
		users: credentials.agents.length,
		lines: rows.length,
		normalUiAuth: true,
		paymentsIncluded: false,
	}),
);
