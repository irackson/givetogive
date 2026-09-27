import { AdminPayments } from '@/app/_components/payments/AdminPayments';
export default async function PaymentsPage({
	searchParams,
}: {
	searchParams: Promise<{ actorId?: string }>;
}) {
	const { actorId } = await searchParams;
	return <AdminPayments {...(actorId ? { actorId } : {})} />;
}
