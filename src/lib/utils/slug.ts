const MAX_SLUG_LENGTH = 256;
const MAX_SLUG_BASE_LENGTH = 240;

export function createSlugBase(title: string) {
	const slug = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[\u2018\u2019']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_SLUG_BASE_LENGTH)
		.replace(/-+$/g, '');

	const base = slug || 'ask';
	// Numeric paths are reserved for legacy ID lookup. Keep the creation
	// action name available without making a member's Ask link ambiguous.
	if (/^\d+$/.test(base) || base === 'create') {
		return `ask-${base}`.slice(0, MAX_SLUG_BASE_LENGTH);
	}
	return base;
}

export function createSlugCandidate(base: string, sequence: number) {
	if (sequence <= 1) return base.slice(0, MAX_SLUG_LENGTH);

	const suffix = `-${sequence}`;
	const trimmedBase = base
		.slice(0, MAX_SLUG_LENGTH - suffix.length)
		.replace(/-+$/g, '');

	return `${trimmedBase || 'ask'}${suffix}`;
}
