import Link from 'next/link';

export function SiteFooter() {
	return (
		<footer className='site-footer'>
			<div className='site-footer__inner'>
				<p>
					<strong>GiveToGive</strong> keeps useful things, time, and
					care moving through the neighborhood.
				</p>
				<div>
					<Link href='/asks'>Explore asks</Link>
					<Link href='/signup'>Join the network</Link>
				</div>
			</div>
		</footer>
	);
}
