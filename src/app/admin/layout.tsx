import { AdminNavigation } from '@/app/_components/payments/AdminNavigation';
import '@/app/_components/payments/payments.css';
import { auth } from '@/server/auth';
import { assertAdmin } from '@/server/security/authorization';
import { TRPCError } from '@trpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: { template: '%s | GiveToGive admin', default: 'GiveToGive admin' },
	robots: { index: false, follow: false },
};

export default async function AdminLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/admin');
	try {
		await assertAdmin(session.user.id);
	} catch (error) {
		if (
			error instanceof TRPCError &&
			(error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED')
		)
			notFound();
		throw error;
	}
	return (
		<div className='page-wrap admin-shell'>
			<header className='admin-heading'>
				<div>
					<p className='eyebrow'>Behind the neighborhood</p>
					<h1>GiveToGive operations</h1>
				</div>
				<Link
					className='text-link'
					href='/account/security'>
					Account security ↗
				</Link>
			</header>
			<AdminNavigation />
			<div className='admin-content'>{children}</div>
		</div>
	);
}
