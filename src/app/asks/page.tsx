import Image from 'next/image';
import { Suspense } from 'react';

import { parseAskFilters } from '@/lib/ask-browsing';
import { getServerAuthSession } from '@/server/auth';
import { api, HydrateClient } from '@/trpc/server';

import { CreateAskFormToggle } from './_components/CreateAskFormToggle';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const session = await getServerAuthSession();
	const params = await searchParams;
	const filters = parseAskFilters({
		get: (key) => {
			const value = params[key];
			return (Array.isArray(value) ? value[0] : value) ?? null;
		},
	});

	if (!filters.savedOnly || session?.user) {
		await api.ask.getAsks.prefetch(filters);
	}

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
							<p className='eyebrow'>The community board</p>
							<h2 className='section-title'>Find a good fit.</h2>
						</div>
						<CreateAskFormToggle
							isAuthenticated={Boolean(session?.user)}
						/>
					</div>
					<Suspense
						fallback={
							<div
								className='asks-loading'
								role='status'>
								Loading the noticeboard…
							</div>
						}>
						<RenderAsksIndex
							isAuthenticated={Boolean(session?.user)}
						/>
					</Suspense>
				</section>
			</div>
		</HydrateClient>
	);
}
