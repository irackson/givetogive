import { ASK_TYPES } from './asks.ts';

export const ASK_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export const ASK_FILTER_KEYS = [
	'type',
	'q',
	'status',
	'difficulty',
	'minutes',
	'saved',
] as const;
export const ASK_STATUS_LABELS = {
	not_started: 'Not started',
	in_progress: 'In progress',
	complete: 'Complete',
};

function boundedInteger(value: string | null, min: number, max: number) {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= min && number <= max ?
			number
		:	undefined;
}

/** Keep direct links, server prefetches, and client navigation in agreement. */
export function parseAskFilters(params: Pick<URLSearchParams, 'get'>) {
	return {
		type: ASK_TYPES.find((type) => type === params.get('type')),
		status: ASK_STATUSES.find((status) => status === params.get('status')),
		maxDifficulty: boundedInteger(params.get('difficulty'), 1, 5),
		maxMinutes: boundedInteger(params.get('minutes'), 1, 10_000),
		query: params.get('q')?.trim().slice(0, 100) || undefined,
		savedOnly: params.get('saved') === '1',
	};
}

export function askFilterHref(
	pathname: string,
	currentParams: string,
	changes: Partial<
		Record<(typeof ASK_FILTER_KEYS)[number], string | undefined>
	>,
) {
	const params = new URLSearchParams(currentParams);
	for (const [name, value] of Object.entries(changes)) {
		if (value) params.set(name, value);
		else params.delete(name);
	}
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}
