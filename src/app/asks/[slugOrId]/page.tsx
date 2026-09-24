import { AskDetail } from '@/app/asks/_components/AskDetail';
import { ensureErrMessage } from '@/lib/utils/errorParsing';
import { getServerAuthSession } from '@/server/auth';
import { api } from '@/trpc/server';

export default async function AskDetailPage(props: {
	params: Promise<{ slugOrId: string }>;
}) {
	const [{ slugOrId }, session] = await Promise.all([
		props.params,
		getServerAuthSession(),
	]);
	const lookup =
		Number.isNaN(Number(slugOrId)) ?
			{ slug: slugOrId }
		:	{ id: Number(slugOrId) };
	const ask = await api.ask.getAsk(lookup).catch((error: unknown) => {
		const { message } = ensureErrMessage(error);
		return message;
	});

	if (typeof ask === 'string') return <p>{ask}</p>;

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
			}}
			viewerId={session?.user?.id ?? null}
		/>
	);
}
