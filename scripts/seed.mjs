import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is required to seed the database');
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const fakeUsers = [
	{
		id: 'seed-user-maya',
		name: 'Maya Thompson',
		email: 'maya.thompson@example.com',
	},
	{
		id: 'seed-user-jordan',
		name: 'Jordan Lee',
		email: 'jordan.lee@example.com',
	},
	{
		id: 'seed-user-priya',
		name: 'Priya Shah',
		email: 'priya.shah@example.com',
	},
	{
		id: 'seed-user-luis',
		name: 'Luis Rivera',
		email: 'luis.rivera@example.com',
	},
];

const sampleAsks = [
	{
		slug: 'seed-grocery-delivery-after-surgery',
		title: 'Grocery delivery after surgery',
		description:
			'I need help picking up a small grocery order while I recover at home.',
		difficulty: 2,
		estimatedMinutesToComplete: 45,
		status: 'not_started',
	},
	{
		slug: 'seed-community-garden-cleanup',
		title: 'Community garden cleanup',
		description:
			'Looking for two neighbors to help weed and prepare the shared garden beds.',
		difficulty: 3,
		estimatedMinutesToComplete: 120,
		status: 'in_progress',
	},
	{
		slug: 'seed-donate-winter-coats',
		title: 'Donate winter coats',
		description:
			'Our neighborhood closet needs clean adult and child winter coats in any size.',
		difficulty: 1,
		estimatedMinutesToComplete: 20,
		status: 'not_started',
	},
	{
		slug: 'seed-ride-to-medical-appointment',
		title: 'Ride to a medical appointment',
		description:
			'I am seeking a round-trip ride to a weekday medical appointment nearby.',
		difficulty: 2,
		estimatedMinutesToComplete: 90,
		status: 'not_started',
	},
	{
		slug: 'seed-help-assemble-bookshelf',
		title: 'Help assemble a bookshelf',
		description:
			'I could use an extra pair of hands and basic tools to assemble a bookshelf.',
		difficulty: 2,
		estimatedMinutesToComplete: 60,
		status: 'complete',
	},
	{
		slug: 'seed-laptop-for-student',
		title: 'Laptop for a local student',
		description:
			'Seeking a working used laptop for a student completing school assignments.',
		difficulty: 3,
		estimatedMinutesToComplete: 30,
		status: 'not_started',
	},
	{
		slug: 'seed-translate-housing-forms',
		title: 'Translate housing forms',
		description:
			'Need a Spanish speaker to help explain several local housing application forms.',
		difficulty: 4,
		estimatedMinutesToComplete: 75,
		status: 'in_progress',
	},
	{
		slug: 'seed-dog-walks-this-weekend',
		title: 'Dog walks this weekend',
		description:
			'I need someone comfortable with dogs to handle two short walks this weekend.',
		difficulty: 1,
		estimatedMinutesToComplete: 40,
		status: 'complete',
	},
	{
		slug: 'seed-moving-boxes-needed',
		title: 'Moving boxes needed',
		description:
			'Looking for clean reusable moving boxes and packing paper before next month.',
		difficulty: 1,
		estimatedMinutesToComplete: 15,
		status: 'not_started',
	},
	{
		slug: 'seed-resume-review',
		title: 'Resume review',
		description:
			'I would appreciate feedback on a resume for entry-level office positions.',
		difficulty: 2,
		estimatedMinutesToComplete: 45,
		status: 'not_started',
	},
	{
		slug: 'seed-porch-ramp-repair',
		title: 'Porch ramp repair',
		description:
			'An existing wooden accessibility ramp needs two loose boards secured safely.',
		difficulty: 4,
		estimatedMinutesToComplete: 90,
		status: 'not_started',
	},
	{
		slug: 'seed-meal-train-for-new-parent',
		title: 'Meal train for a new parent',
		description:
			'We are coordinating simple prepared meals for a neighbor with a new baby.',
		difficulty: 2,
		estimatedMinutesToComplete: 60,
		status: 'in_progress',
	},
];

const askGoals = {
	'seed-grocery-delivery-after-surgery': { type: 'task', goalAmount: 1 },
	'seed-community-garden-cleanup': { type: 'time', goalAmount: 240 },
	'seed-donate-winter-coats': { type: 'item', goalAmount: 10 },
	'seed-ride-to-medical-appointment': { type: 'task', goalAmount: 1 },
	'seed-help-assemble-bookshelf': { type: 'task', goalAmount: 1 },
	'seed-laptop-for-student': { type: 'resource', goalAmount: 1 },
	'seed-translate-housing-forms': { type: 'time', goalAmount: 120 },
	'seed-dog-walks-this-weekend': { type: 'time', goalAmount: 80 },
	'seed-moving-boxes-needed': { type: 'item', goalAmount: 20 },
	'seed-resume-review': { type: 'task', goalAmount: 1 },
	'seed-porch-ramp-repair': {
		type: 'money',
		goalAmount: 35000,
		currency: 'USD',
	},
	'seed-meal-train-for-new-parent': { type: 'resource', goalAmount: 8 },
};

const sampleContributions = [
	{
		askSlug: 'seed-community-garden-cleanup',
		contributorId: 'seed-user-jordan',
		amount: 60,
		note: 'I can help Saturday morning.',
	},
	{
		askSlug: 'seed-community-garden-cleanup',
		contributorId: 'seed-user-priya',
		amount: 45,
		note: 'Happy to bring gloves and help weed.',
	},
	{
		askSlug: 'seed-donate-winter-coats',
		contributorId: 'seed-user-luis',
		amount: 3,
		note: 'Three clean adult coats are ready for drop-off.',
	},
	{
		askSlug: 'seed-help-assemble-bookshelf',
		contributorId: 'seed-user-maya',
		amount: 1,
		note: 'Assembly completed.',
		status: 'completed',
	},
	{
		askSlug: 'seed-translate-housing-forms',
		contributorId: 'seed-user-luis',
		amount: 30,
		note: 'I can cover the first half hour.',
	},
	{
		askSlug: 'seed-dog-walks-this-weekend',
		contributorId: 'seed-user-jordan',
		amount: 40,
		note: 'I can take the Saturday walks.',
		status: 'completed',
	},
	{
		askSlug: 'seed-dog-walks-this-weekend',
		contributorId: 'seed-user-priya',
		amount: 40,
		note: 'I can take the Sunday walks.',
		status: 'completed',
	},
	{
		askSlug: 'seed-porch-ramp-repair',
		contributorId: 'seed-user-maya',
		amount: 7500,
		note: 'Putting $75 toward lumber and hardware.',
	},
	{
		askSlug: 'seed-meal-train-for-new-parent',
		contributorId: 'seed-user-jordan',
		amount: 2,
		note: 'I can prepare two dinners.',
	},
	{
		askSlug: 'seed-meal-train-for-new-parent',
		contributorId: 'seed-user-priya',
		amount: 1,
		note: 'I can bring one freezer meal.',
	},
];

try {
	const summary = await sql.begin(async (transaction) => {
		const authenticatedUsers = await transaction`
			select users.id
			from givetogive_user as users
			where exists (
				select 1 from givetogive_account as accounts
				where accounts.user_id = users.id
			) or (users.hashed_password is not null and users.email_verified is not null)
			order by users.id
		`;

		let fakeUsersInserted = 0;
		for (const user of fakeUsers) {
			const result = await transaction`
				insert into givetogive_user (id, name, email)
				values (${user.id}, ${user.name}, ${user.email})
				on conflict do nothing
			`;
			fakeUsersInserted += result.count;
		}

		const availableFakeUsers = await transaction`
			select id from givetogive_user
			where id in ${transaction(fakeUsers.map(({ id }) => id))}
		`;
		const fakeUserIds = new Set(availableFakeUsers.map(({ id }) => id));
		const authorIds = [...new Set([
			...authenticatedUsers.map(({ id }) => id),
			...availableFakeUsers.map(({ id }) => id),
		])];

		let insertedAskCount = 0;
		for (const [index, ask] of sampleAsks.entries()) {
			const goal = askGoals[ask.slug];
			const contributorIds = new Set(
				sampleContributions
					.filter(({ askSlug }) => askSlug === ask.slug)
					.map(({ contributorId }) => contributorId),
			);
			const eligibleAuthors = authorIds.filter((id) => !contributorIds.has(id));
			if (eligibleAuthors.length === 0) {
				throw new Error(`No eligible seed owner for ${ask.slug}`);
			}
			const createdById = eligibleAuthors[index % eligibleAuthors.length];

			const result = await transaction`
				insert into givetogive_ask (
					slug,
					title,
					description,
					difficulty,
					estimated_minutes_to_complete,
					status,
					type,
					goal_amount,
					currency,
					created_by,
					fulfilled_by
				)
				values (
					${ask.slug},
					${ask.title},
					${ask.description},
					${ask.difficulty},
					${ask.estimatedMinutesToComplete},
					'not_started',
					${goal.type},
					${goal.goalAmount},
					${goal.currency ?? null},
					${createdById},
					null
				)
				on conflict (slug) do nothing
			`;

			insertedAskCount += result.count;
		}

		// Match application lock ordering before reading contribution capacity.
		// Exact slugs avoid touching unrelated user-created Asks with a seed- prefix.
		await transaction`
			select id from givetogive_ask
			where slug in ${transaction(sampleAsks.map(({ slug }) => slug))}
			order by id
			for update
		`;

		let contributionsInserted = 0;
		for (const contribution of sampleContributions) {
			if (!fakeUserIds.has(contribution.contributorId)) continue;
			const goal = askGoals[contribution.askSlug];
			const result = await transaction`
				insert into givetogive_ask_contribution (
					ask_id,
					contributor_id,
					amount,
					note,
					status
				)
				select
					asks.id,
					${contribution.contributorId},
					${contribution.amount},
					${contribution.note},
					${contribution.status ?? 'pledged'}
				from givetogive_ask as asks
				where asks.slug = ${contribution.askSlug}
				and asks.created_by <> ${contribution.contributorId}
				and asks.type = ${goal.type}
				and asks.currency is not distinct from ${goal.currency ?? null}
				and ${contribution.amount} <= asks.goal_amount - (
					select coalesce(sum(existing.amount), 0)
					from givetogive_ask_contribution as existing
					where existing.ask_id = asks.id
					and existing.status in ('pledged', 'completed')
				)
				and not exists (
					select 1
					from givetogive_ask_contribution as existing
					where existing.ask_id = asks.id
					and existing.contributor_id = ${contribution.contributorId}
					and existing.note = ${contribution.note}
				)
			`;
			contributionsInserted += result.count;
		}

		await transaction`
			update givetogive_ask as asks
			set status = case
				when progress.completed_amount >= asks.goal_amount then 'complete'
				when progress.active_amount > 0 then 'in_progress'
				else 'not_started'
			end
			from (
				select
					seed_asks.id as ask_id,
					coalesce(sum(contributions.amount) filter (where contributions.status in ('pledged', 'completed')), 0) as active_amount,
					coalesce(sum(contributions.amount) filter (where contributions.status = 'completed'), 0) as completed_amount
				from givetogive_ask as seed_asks
				left join givetogive_ask_contribution as contributions on contributions.ask_id = seed_asks.id
				where seed_asks.slug in ${transaction(sampleAsks.map(({ slug }) => slug))}
				group by seed_asks.id
			) as progress
			where asks.id = progress.ask_id
		`;

		return {
			authenticatedUsersUsed: authenticatedUsers.length,
			fakeUsersInserted,
			asksInserted: insertedAskCount,
			contributionsInserted,
			totalSeedAsks: sampleAsks.length,
		};
	});

	console.log('Database seed complete:', summary);
} finally {
	await sql.end({ timeout: 5 });
}
