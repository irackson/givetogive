'use client';

import { Divider, Menu, MenuItem } from '@mui/material';
import Link from 'next/link';
import { useState } from 'react';

export function SiteAccountMenu({
	memberId,
	memberName,
	isAdmin,
}: {
	memberId: string;
	memberName: string | null;
	isAdmin: boolean;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	return (
		<>
			<button
				type='button'
				className='nav-member-menu'
				aria-haspopup='menu'
				aria-expanded={Boolean(anchor)}
				aria-controls={anchor ? 'member-navigation' : undefined}
				onClick={(event) => setAnchor(event.currentTarget)}
				title={`Account for ${memberName ?? 'you'}`}>
				My account <span aria-hidden='true'>⌄</span>
			</button>
			<Menu
				id='member-navigation'
				anchorEl={anchor}
				open={Boolean(anchor)}
				onClose={() => setAnchor(null)}
				onClick={() => setAnchor(null)}
				slotProps={{ list: { 'aria-label': 'Your account' } }}>
				<MenuItem
					component={Link}
					href={`/members/${memberId}`}>
					My profile & help
				</MenuItem>
				<MenuItem
					component={Link}
					href='/asks?saved=1'>
					Saved Asks
				</MenuItem>
				<MenuItem
					component={Link}
					href='/giving'>
					Giving & receipts
				</MenuItem>
				<MenuItem
					component={Link}
					href='/account/billing'>
					Membership & billing
				</MenuItem>
				<MenuItem
					component={Link}
					href='/account/receiving'>
					Receiving help
				</MenuItem>
				<MenuItem
					component={Link}
					href='/account/security'>
					Account security
				</MenuItem>
				{isAdmin && (
					<MenuItem
						component={Link}
						href='/admin'>
						Administrator dashboard
					</MenuItem>
				)}
				<Divider />
				<MenuItem
					component={Link}
					href='/signout'>
					Sign out
				</MenuItem>
			</Menu>
		</>
	);
}
