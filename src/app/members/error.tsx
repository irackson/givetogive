'use client';

import Link from 'next/link';

export default function MemberError({ reset }: { reset: () => void }) {
	return (
		<section className='page-wrap profile-error'>
			<p className='eyebrow'>A little interruption</p>
			<h1 className='section-title'>We couldn’t load this profile.</h1>
			<p>Please try again in a moment.</p>
			<button
				onClick={reset}
				className='button-link button-link--primary'>
				Try again
			</button>{' '}
			<Link href='/asks'>Back to the community board</Link>
		</section>
	);
}
