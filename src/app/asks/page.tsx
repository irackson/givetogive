import Image from 'next/image';

import { getServerAuthSession } from '@/server/auth';
import { api, HydrateClient } from '@/trpc/server';

import { CreateAskFormToggle } from './_components/CreateAskFormToggle';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage() {
	const session = await getServerAuthSession();

	await api.ask.getAsks.prefetch({});

	return (
		<HydrateClient>
			<div className='asks-page'>
				<section className='asks-hero'>
					<Image
						src='/art/asks-bulletin.png'
						alt=''
						fill
						priority
						sizes='100vw'
						className='asks-hero__art'
					/>
					<div className='page-wrap asks-hero__content'>
						<p className='eyebrow'>The neighborhood noticeboard</p>
						<h1 className='display-title'>
							Every ask has a way in.
						</h1>
						<p>
							Browse needs with a clear finish line. Pitch in with
							the time, items, skills, resources, or money you can
							share.
						</p>
					</div>
				</section>
				<section className='page-wrap asks-directory'>
					<div className='asks-directory__intro'>
						<div>
							<p className='eyebrow'>Open asks</p>
							<h2 className='section-title'>Find a good fit.</h2>
						</div>
						<CreateAskFormToggle
							isAuthenticated={Boolean(session?.user)}
						/>
					</div>
					<RenderAsksIndex />
				</section>
			</div>
		</HydrateClient>
	);
}
