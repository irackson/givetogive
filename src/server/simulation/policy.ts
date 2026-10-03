import { createHash } from 'node:crypto';

export const simulationScopes = {
	read: 'member:read',
	asks: 'asks:write',
	contributions: 'contributions:write',
	payments: 'payments:prepare',
	runnerRead: 'simulation:read',
	runnerEvents: 'simulation:events',
	clock: 'simulation:clock',
} as const;

export function hashSimulationToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}
export function bearerToken(headers: Headers) {
	const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(
		headers.get('authorization') ?? '',
	);
	if (!match?.[1]) throw new Error('AUTH_REQUIRED');
	return match[1];
}
export function stableInputHash(value: unknown): string {
	function canonical(input: unknown): unknown {
		if (Array.isArray(input)) return input.map(canonical);
		if (input && typeof input === 'object')
			return Object.fromEntries(
				Object.entries(input)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, child]) => [key, canonical(child)]),
			);
		return input;
	}
	return createHash('sha256')
		.update(JSON.stringify(canonical(value)))
		.digest('hex');
}
export function safeSimulationText(text: string) {
	return text
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
		.replace(/(?:sk|rk|whsec|g2g)_[A-Za-z0-9_-]{12,}/g, '[redacted]')
		.replace(/\b[a-f0-9]{64}\b/gi, '[credential hash redacted]')
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
		.slice(0, 500);
}
const safeDataKeys = new Set([
	'tool',
	'outcome',
	'cycles',
	'actions',
	'failures',
	'queueLatencyMs',
	'actionLatencyMs',
	'population',
	'mode',
	'model',
	'ramFreeGiB',
	'ramTotalGiB',
	'inferenceActive',
	'inferenceQueued',
	'inferenceConcurrency',
	'browserActive',
	'browserQueued',
	'browserConcurrency',
	'browserUsers',
	'scriptedUsers',
	'apiActive',
	'apiQueued',
	'driver',
	'lineId',
	'iteration',
	'entityId',
	'entityKind',
	'askId',
	'gpuUsedMiB',
	'gpuTotalMiB',
	'gpuUtilizationPercent',
	'gpuMetricsAvailable',
	'commandId',
]);
export function sanitizeSimulationData(data: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(data)
			.filter(
				([key, value]) =>
					safeDataKeys.has(key) &&
					(typeof value === 'string' ||
						typeof value === 'boolean' ||
						(typeof value === 'number' &&
							Number.isFinite(value) &&
							value >= 0 &&
							value <= 1_000_000_000_000)),
			)
			.map(([key, value]) => [
				key,
				typeof value === 'string' ? safeSimulationText(value) : value,
			]),
	);
}

export async function boundedJson(
	request: Request,
	maxBytes = 65_536,
): Promise<unknown> {
	const declared = request.headers.get('content-length');
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
		throw new Error('BODY_TOO_LARGE');
	if (
		!/^application\/json(?:\s*;|$)/i.test(
			request.headers.get('content-type') ?? '',
		)
	)
		throw new Error('JSON_REQUIRED');
	const reader = request.body?.getReader();
	if (!reader) throw new Error('JSON_REQUIRED');
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.byteLength;
			if (length > maxBytes) {
				await reader.cancel();
				throw new Error('BODY_TOO_LARGE');
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
