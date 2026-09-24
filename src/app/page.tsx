import Link from 'next/link';
import Image from 'next/image';

import { getServerAuthSession } from '@/server/auth';

export default async function Home() {
	const session = await getServerAuthSession();
	const firstName = session?.user?.name?.split(' ')[0];

	return (
		<div className='home-page'>
			<section className='home-hero page-wrap'>
				<div className='home-hero__copy'>
					<p className='eyebrow'>A neighborhood help exchange</p>
					<h1 className='display-title'>
						Useful things belong in motion.
					</h1>
					<p className='body-large'>
						GiveToGive makes room for the small, specific help that
						keeps a neighborhood generous: an hour, a ride, a spare
						item, a skilled hand, or a few dollars toward a shared
						need.
					</p>
					<div className='home-hero__actions'>
						<Link
							href='/asks'
							className='button-link button-link--cobalt'>
							See what neighbors need
						</Link>
						<Link
							href={session ? '/asks#start-an-ask' : '/signup'}
							className='button-link button-link--paper'>
							{session ? 'Post an ask' : 'Make a free account'}
						</Link>
					</div>
					{firstName && (
						<p className='member-note'>
							Welcome back, {firstName}. Your next good turn can
							start small.
						</p>
					)}
				</div>
				<div
					className='home-hero__art'
					aria-hidden='true'>
					<Image
						src='/art/mutual-aid-hero.png'
						alt=''
						fill
						priority
						sizes='(max-width: 800px) 100vw, 56vw'
					/>
				</div>
			</section>

			<section className='home-ways page-wrap'>
				<div className='home-ways__intro'>
					<p className='eyebrow'>
						There is more than one way to show up
					</p>
					<h2 className='section-title'>Help can have any shape.</h2>
				</div>
				<div className='home-ways__grid'>
					<Link
						href='/asks'
						className='way-card way-card--time'>
						<span>01</span>
						<h3>Time &amp; tasks</h3>
						<p>
							Dog walks, repairs, pickups, lessons, and the work
							that takes a neighbor.
						</p>
					</Link>
					<Link
						href='/asks'
						className='way-card way-card--things'>
						<span>02</span>
						<h3>Items &amp; resources</h3>
						<p>
							Tools, books, spare furniture, community space, and
							the things already nearby.
						</p>
					</Link>
					<Link
						href='/asks'
						className='way-card way-card--funds'>
						<span>03</span>
						<h3>Shared funds</h3>
						<p>
							Small contributions add up when someone needs a
							clear financial boost.
						</p>
					</Link>
				</div>
			</section>

			<section className='home-invitation'>
				<div className='page-wrap home-invitation__inner'>
					<div>
						<p className='eyebrow'>Keep the good going</p>
						<h2 className='section-title'>
							A better block starts with a visible ask.
						</h2>
					</div>
					<Link
						href='/asks'
						className='button-link button-link--coral'>
						Browse community asks
					</Link>
				</div>
			</section>
		</div>
	);
}
