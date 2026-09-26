import { AskDetail } from '@/app/asks/_components/AskDetail';
import { getServerAuthSession } from '@/server/auth';
import { api } from '@/trpc/server';
import { TRPCError } from '@trpc/server';
import { notFound } from 'next/navigation';

export default async function AskDetailPage(props: {
	params: Promise<{ slugOrId: string }>;
}) {
	const [{ slugOrId }, session] = await Promise.all([
		props.params,
		getServerAuthSession(),
	]);
	const lookup =
		(
			/^\d+$/.test(slugOrId) &&
			Number(slugOrId) > 0 &&
			Number(slugOrId) <= 2_147_483_647
		) ?
			{ id: Number(slugOrId) }
		:	{ slug: slugOrId };
	if (slugOrId.length > 256) notFound();
	const ask = await api.ask.getAsk(lookup).catch((error: unknown) => {
		if (error instanceof TRPCError && error.code === 'NOT_FOUND')
			notFound();
		throw error;
	});

	return (
		<AskDetail
			ask={{
				...ask,
				createdAt: ask.createdAt.toISOString(),
				updatedAt: ask.updatedAt?.toISOString() ?? null,
				contributions: ask.contributions.map((contribution) => ({
					...contribution,
					createdAt: contribution.createdAt.toISOString(),
				})),
				activities: ask.activities.map((activity) => ({
					...activity,
					createdAt: activity.createdAt.toISOString(),
				})),
			}}
			viewerId={session?.user?.id ?? null}
		/>
	);
}
