import Link from 'next/link';

interface SiteHeaderProps {
	memberName?: string | null;
}

export function SiteHeader({ memberName }: SiteHeaderProps) {
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
					{memberName ?
						<>
							<Link
								href='/asks#start-an-ask'
								className='nav-action'>
								Post an ask
							</Link>
							<Link
								href='/api/auth/signout'
								className='nav-account'>
								{memberName.split(' ')[0]}{' '}
								<span aria-hidden='true'>/</span> Sign out
							</Link>
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
