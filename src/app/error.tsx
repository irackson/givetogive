'use client';

import Link from 'next/link';

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
	return <section className='page-wrap' style={{ paddingBlock: '6rem', maxWidth: 760 }}>
		<p className='eyebrow'>A brief interruption</p>
		<h1 className='section-title'>We could not load this page.</h1>
		<p className='body-large'>Please try again in a moment.</p>
		<button onClick={retry} className='button-link button-link--cobalt'>Try again</button>{' '}
		<Link href='/' className='button-link button-link--paper'>Back home</Link>
	</section>;
}
