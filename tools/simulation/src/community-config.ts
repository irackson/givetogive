import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { assertStagingOrigin } from './config.ts';

export const communityCredentialsSchema = z
	.object({
		runId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
		origin: z.url(),
		databaseIdentity: z.string().min(1),
		mode: z.literal('scripted'),
		runnerToken: z.string().min(20),
		agents: z
			.array(
				z
					.object({
						id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
						userId: z.string().min(1),
						email: z.email(),
						password: z.string().min(1),
						targetTier: z
							.enum(['neighbor', 'supporter', 'sustainer'])
							.optional(),
					})
					.passthrough(),
			)
			.min(1)
			.max(280),
	})
	.passthrough()
	.superRefine((value, ctx) => {
		for (const field of ['id', 'userId', 'email'] as const)
			if (
				new Set(value.agents.map((user) => user[field])).size !==
				value.agents.length
			)
				ctx.addIssue({
					code: 'custom',
					message: `Every participant must have a unique ${field}.`,
				});
	});
export type CommunityCredentials = z.infer<typeof communityCredentialsSchema>;
export function readCommunityCredentials(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new Error(
			'Private community credential file is missing or malformed; contents withheld.',
		);
	}
}
/** Exercise all declared cohorts without claiming those labels are paid entitlement. */
export function browserAccounts(
	credentials: CommunityCredentials,
	count: number,
) {
	const groups = ['neighbor', 'supporter', 'sustainer', undefined].map(
		(tier) =>
			credentials.agents.filter((account) => account.targetTier === tier),
	);
	const selected: CommunityCredentials['agents'] = [];
	while (selected.length < count && groups.some((group) => group.length))
		for (const group of groups)
			if (group.length && selected.length < count)
				selected.push(group.shift()!);
	return selected;
}
export const communityOptionsSchema = z.object({
	browserUsers: z.coerce.number().int().min(1).max(30).default(3),
	browserConcurrency: z.coerce.number().int().min(1).max(30).default(3),
	apiConcurrency: z.coerce.number().int().min(1).max(30).default(4),
	durationSeconds: z.coerce.number().int().min(1).max(86400).default(3600),
	minimumFreeGiB: z.coerce.number().min(0.5).max(8).default(1),
});
export function validateCommunity(raw: unknown, options: unknown) {
	const credentials = communityCredentialsSchema.parse(raw);
	const settings = communityOptionsSchema.parse(options);
	assertStagingOrigin(credentials.origin);
	if (settings.browserUsers > credentials.agents.length)
		throw new Error(
			'Browser population exceeds provisioned independent accounts.',
		);
	if (settings.browserConcurrency > settings.browserUsers)
		throw new Error('Browser concurrency exceeds browser population.');
	return { credentials, settings };
}
