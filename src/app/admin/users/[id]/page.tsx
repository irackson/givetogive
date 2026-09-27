import { AdminUserDetail } from '@/app/_components/payments/AdminUsers';
export default async function UserPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	return <AdminUserDetail id={(await params).id} />;
}
