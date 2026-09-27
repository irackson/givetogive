import { AdminActivity } from '@/app/_components/payments/AdminActivity';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Activity' };
export default async function ActivityPage({
	searchParams,
}: {
	searchParams: Promise<{
		entityType?: string;
		entityId?: string;
		actorId?: string;
		runId?: string;
	}>;
}) {
	return <AdminActivity initial={await searchParams} />;
}
