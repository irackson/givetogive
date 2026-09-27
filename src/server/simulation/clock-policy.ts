import { createHash } from 'node:crypto';
import { z } from 'zod';

export const clockCommandSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('create') }).strict(),
	z.object({ action: z.literal('read') }).strict(),
	z
		.object({
			action: z.literal('advance'),
			operationId: z.uuid(),
			frozenTime: z.number().int().positive(),
		})
		.strict(),
]);
export function clockCreateId(runId: string) {
	return createHash('sha256')
		.update(`simulation-clock:${runId}`)
		.digest('hex');
}
export function assertClockCohort(run: {
	id: string;
	agentCount: number;
	status: string;
}) {
	if (
		!/^[a-zA-Z0-9_-]{1,64}$/.test(run.id) ||
		!Number.isInteger(run.agentCount) ||
		run.agentCount < 1 ||
		run.agentCount > 3 ||
		!['created', 'running', 'paused'].includes(run.status)
	)
		throw new Error(
			'Clock testing requires a nonterminal cohort of one to three members.',
		);
}
export function verifyNamedClock(
	clock: {
		id: string;
		name: string | null;
		livemode: boolean;
		status: string;
		frozen_time: number;
	},
	runId: string,
	expectedId?: string,
) {
	if (
		!/^clock_[A-Za-z0-9]+$/.test(clock.id) ||
		(expectedId && clock.id !== expectedId) ||
		clock.livemode ||
		clock.name !== `givetogive:${runId}` ||
		!['ready', 'advancing'].includes(clock.status) ||
		!Number.isSafeInteger(clock.frozen_time)
	)
		throw new Error(
			'Test clock ownership or provider state does not match.',
		);
}
export function assertClockAdvance(
	current: number,
	requested: number,
	initial: number,
) {
	if (
		![current, requested, initial].every(Number.isSafeInteger) ||
		requested <= current ||
		requested - current > 32 * 86400 ||
		requested > initial + 366 * 86400
	)
		throw new Error(
			'Test clock advances must move forward at most 32 days per operation and one year per cohort.',
		);
}
