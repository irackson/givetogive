import { AdminPaymentDetail } from '@/app/_components/payments/AdminPayments';
import { notFound } from 'next/navigation';
export default async function PaymentPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
	return <AdminPaymentDetail id={id} />;
}
