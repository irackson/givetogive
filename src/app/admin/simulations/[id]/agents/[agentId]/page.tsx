import { AdminSimulation } from '@/app/_components/payments/AdminSimulations';
export default async function AgentPage({
	params,
}: {
	params: Promise<{ id: string; agentId: string }>;
}) {
	const { id, agentId } = await params;
	return (
		<AdminSimulation
			id={id}
			agentId={agentId}
		/>
	);
}
