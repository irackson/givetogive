import Link from 'next/link';

export default function MemberNotFound() {
	return (
		<section className='page-wrap profile-error'>
			<p className='eyebrow'>Member profile</p>
			<h1 className='section-title'>This neighbor could not be found.</h1>
			<p>The profile link may be out of date.</p>
			<Link
				href='/asks'
				className='button-link button-link--primary'>
				Back to the community board
			</Link>
		</section>
	);
}
