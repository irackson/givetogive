import { z } from 'zod';
import type { CommunityCredentials } from './community-config.ts';
import { inspectCommunityManifest } from './community-control.ts';
import { controlSchema } from './protocol.ts';

const reviewSchema = z.object({
	runId: z.string().min(1),
	priorControllerId: z.uuid(),
	recoveredControllerId: z.uuid(),
	status: z.literal('paused'),
	controllerId: z.null(),
	online: z.literal(false),
	stopCommandId: z.string().regex(/^\d{1,15}$/),
	observedAt: z.iso.datetime(),
}).strict();

/** Normal-admin read receipt is an operator review, never a member credential. */
export function assertCommunityCheckpoint(
	rawManifest: unknown,
	credentials: CommunityCredentials,
	browserUsers: number,
	rawReview: unknown,
	priorControllerId: string | undefined,
	pendingMutations: number,
	pendingTelemetry: number,
	now = Date.now(),
) {
	const manifest = inspectCommunityManifest(rawManifest, credentials, browserUsers);
	const parsed = reviewSchema.safeParse(rawReview);
	if (!parsed.success) throw new Error('A current normal-admin recovery and stop review is required.');
	const review = parsed.data;
	const age = now - Date.parse(review.observedAt);
	if (manifest.runStatus !== 'paused' || review.runId !== credentials.runId ||
		review.priorControllerId !== priorControllerId || review.recoveredControllerId !== priorControllerId ||
		age < 0 || age > 120_000)
		throw new Error('Checkpoint review differs from the exact recovered paused run or is stale.');
	if (pendingMutations || pendingTelemetry)
		throw new Error('Review unresolved mutations and sync retained telemetry before checkpoint.');
	return review;
}

/** Only the explicitly reviewed queued stop is applied; no member work is exposed. */
export function reviewedCheckpointStop(raw: unknown, stopCommandId: string) {
	const batch = controlSchema.parse(raw);
	const stop = batch.commands.find(command => command.id === stopCommandId && command.type === 'stop');
	if (!stop) throw new Error('The reviewed queued stop is unavailable; checkpoint remains paused.');
	return stop;
}
