'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AdminNavigation() {
	const pathname = usePathname();
	const links = [
		{ href: '/admin', label: 'Overview' },
		{ href: '/admin/activity', label: 'Live activity' },
		{ href: '/admin/users', label: 'Members' },
		{ href: '/admin/payments', label: 'Payments & recovery' },
		{ href: '/admin/funds', label: 'Fund allocations' },
		{ href: '/admin/simulations', label: 'Simulation room' },
	];
	return (
		<nav
			className='admin-nav'
			aria-label='Administrator views'>
			{links.map(({ href, label }) => (
				<Link
					href={href}
					key={href}
					aria-current={
						(
							href === '/admin' ?
								pathname === href
							:	pathname.startsWith(href)
						) ?
							'page'
						:	undefined
					}>
					{label}
				</Link>
			))}
		</nav>
	);
}
