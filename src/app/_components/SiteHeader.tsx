import Link from 'next/link';
import { SiteAccountMenu } from './SiteAccountMenu';

interface SiteHeaderProps {
	memberName?: string | null;
	memberId?: string | null;
	isAdmin?: boolean;
}

export function SiteHeader({
	memberName,
	memberId,
	isAdmin = false,
}: SiteHeaderProps) {
	return (
		<header className='site-header'>
			<div className='site-header__inner'>
				<Link
					href='/'
					className='brand-link'
					aria-label='GiveToGive home'>
					<span className='brand-mark'>g2g</span>
					<span className='brand-copy'>
						<strong>GiveToGive</strong>
						<small>neighbor to neighbor</small>
					</span>
				</Link>
				<nav
					className='site-nav'
					aria-label='Primary navigation'>
					<Link href='/asks'>Browse asks</Link>
					<Link href='/funds'>Community funds</Link>
					<Link href='/support'>Support us</Link>
					{memberId ?
						<>
							<Link
								href='/asks#start-an-ask'
								className='nav-action'>
								Post an ask
							</Link>
							<SiteAccountMenu
								memberId={memberId}
								memberName={memberName ?? null}
								isAdmin={isAdmin}
							/>
						</>
					:	<>
							<Link href='/signin'>Sign in</Link>
							<Link
								href='/signup'
								className='nav-action'>
								Join in
							</Link>
						</>
					}
				</nav>
			</div>
		</header>
	);
}
