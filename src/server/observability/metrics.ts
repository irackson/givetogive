import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { requestMetrics } from '@/server/db/operations-schema';
import { applicationEnvironment } from '@/lib/environment';

export async function recordRequestMetric(
	procedure: string,
	succeeded: boolean,
	elapsedMs: number,
) {
	// Exclude observer polling and internal transaction callers from these HTTP/RSC measurements.
	if (
		procedure.startsWith('admin.') ||
		!/^[a-zA-Z][a-zA-Z0-9.]{0,99}$/.test(procedure)
	)
		return;
	const duration = Math.min(3_600_000, Math.max(0, Math.round(elapsedMs)));
	if (!Number.isFinite(duration)) return;
	try {
		await db
			.insert(requestMetrics)
			.values({
				environment: applicationEnvironment(),
				bucketStart: new Date(Math.floor(Date.now() / 60_000) * 60_000),
				procedure,
				outcome: succeeded ? 'success' : 'error',
				durationSumMs: duration,
				durationMaxMs: duration,
			})
			.onConflictDoUpdate({
				target: [
					requestMetrics.environment,
					requestMetrics.bucketStart,
					requestMetrics.procedure,
					requestMetrics.outcome,
				],
				set: {
					count: sql`${requestMetrics.count} + 1`,
					durationSumMs: sql`${requestMetrics.durationSumMs} + ${duration}`,
					durationMaxMs: sql`greatest(${requestMetrics.durationMaxMs}, ${duration})`,
				},
			});
	} catch {
		// Observability must never undo a completed financial or application mutation.
		console.warn('Request metrics could not be persisted.');
	}
}
