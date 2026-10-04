import { z } from 'zod';
import type { CommunityCredentials } from './community-config.ts';
import { inspectCommunityManifest } from './community-control.ts';
import { controlSchema } from './protocol.ts';

const commonReviewFields = {
	runId: z.string().min(1),
	priorControllerId: z.uuid(),
	status: z.literal('paused'),
	controllerId: z.null(),
	online: z.literal(false),
	stopCommandId: z.string().regex(/^\d{1,15}$/),
	observedAt: z.iso.datetime(),
};
const recoveredReviewSchema = z.object({
	...commonReviewFields,
	recoveredControllerId: z.uuid(),
}).strict();
const releaseBindingSchema = z.object({
	controllerJournalId: z.uuid(),
	programDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const acknowledgedReviewSchema = z.object({
	...commonReviewFields,
	releaseKind: z.literal('acknowledged-release'),
	lastControllerId: z.uuid(),
	...releaseBindingSchema.shape,
}).strict();
const reviewSchema = z.union([recoveredReviewSchema, acknowledgedReviewSchema]);

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
	// The runner manifest does not expose release settings. An acknowledged-release
	// receipt additionally needs an independent binding from the retained local journals;
	// programDigest is the controller's digest of BOTH journals, not the activity digest.
	expectedReleaseBinding?: unknown,
) {
	const manifest = inspectCommunityManifest(rawManifest, credentials, browserUsers);
	const parsed = reviewSchema.safeParse(rawReview);
	if (!parsed.success) throw new Error('A current normal-admin recovery and stop review is required.');
	const review = parsed.data;
	const age = now - Date.parse(review.observedAt);
	if (manifest.runStatus !== 'paused' || review.runId !== credentials.runId ||
		review.priorControllerId !== priorControllerId ||
		age < 0 || age > 120_000)
		throw new Error('Checkpoint review differs from the exact paused run or is stale.');
	if ('releaseKind' in review) {
		const binding = releaseBindingSchema.safeParse(expectedReleaseBinding);
		if (!binding.success || review.lastControllerId !== priorControllerId ||
			review.controllerJournalId !== binding.data.controllerJournalId ||
			review.programDigest !== binding.data.programDigest)
			throw new Error('Acknowledged release differs from the retained controller and journal binding.');
	} else if (review.recoveredControllerId !== priorControllerId) {
		throw new Error('Checkpoint review differs from the exact recovered paused run.');
	}
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
