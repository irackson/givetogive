/** Bound card rendering, never the run totals or live activity population. */
export const SIMULATION_MEMBER_PAGE_SIZE = 24;

export function simulationMemberPage<
	T extends { id: string; name: string; tier: string; state: string },
>(
	agents: readonly T[],
	options: {
		tier?: string;
		state?: string;
		search?: string;
		page?: number;
	} = {},
) {
	const search = options.search?.trim().toLowerCase() ?? '';
	const filtered = agents
		.filter(
			(agent) =>
				(!options.tier || agent.tier === options.tier) &&
				(!options.state || agent.state === options.state) &&
				(!search ||
					agent.name.toLowerCase().includes(search) ||
					agent.id.toLowerCase().includes(search)),
		)
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name, 'en') ||
				a.id.localeCompare(b.id, 'en'),
		);
	const pages = Math.ceil(filtered.length / SIMULATION_MEMBER_PAGE_SIZE);
	const requested = Number.isSafeInteger(options.page) ? options.page! : 0;
	const page = Math.max(0, Math.min(requested, Math.max(0, pages - 1)));
	const offset = page * SIMULATION_MEMBER_PAGE_SIZE;
	const items = filtered.slice(offset, offset + SIMULATION_MEMBER_PAGE_SIZE);
	return {
		items,
		total: filtered.length,
		page,
		pages,
		start: items.length ? offset + 1 : 0,
		end: offset + items.length,
	};
}
