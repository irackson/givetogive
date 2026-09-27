import { AdminSimulation } from '@/app/_components/payments/AdminSimulations';
export default async function SimulationPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	return <AdminSimulation id={(await params).id} />;
}
