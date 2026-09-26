import Link from 'next/link';

export default function NotFound() {
	return <section className='page-wrap' style={{ paddingBlock: '6rem', maxWidth: 760 }}>
		<p className='eyebrow'>A little off the map</p>
		<h1 className='section-title'>This page is not here.</h1>
		<p className='body-large'>The link may have changed, or this Ask or member no longer exists.</p>
		<Link href='/asks' className='button-link button-link--cobalt'>Explore community asks</Link>
	</section>;
}
