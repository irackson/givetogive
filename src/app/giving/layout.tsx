import { auth } from '@/server/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function GivingLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/giving');
	return children;
}
