'use client';

import Link from 'next/link';

export default function MemberError({ retry }: { retry: () => void }) {
	return (
		<section className='page-wrap' style={{ paddingBlock: '6rem', maxWidth: 760 }}>
			<p className='eyebrow'>A little interruption</p>
			<h1 className='section-title'>We couldn’t load this profile.</h1>
			<p className='body-large'>Please try again in a moment.</p>
			<button
				onClick={retry}
				className='button-link button-link--cobalt'>
				Try again
			</button>{' '}
			<Link href='/asks'>Back to the community board</Link>
		</section>
	);
}
