import { ProfileEditor } from '@/app/members/[id]/ProfileEditor';
import { ASK_TYPE_LABELS, formatAskAmount } from '@/lib/asks';
import { api } from '@/trpc/server';
import '@/styles/members.css';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import { TRPCError } from '@trpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
	title: 'Member profile | GiveToGive',
	description: 'Meet a neighbor and see the help they have shared.',
};

const memberSince = new Intl.DateTimeFormat('en-US', {
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC',
});
const contributionDate = new Intl.DateTimeFormat('en-US', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC',
});
const contributionLabels = {
	pledged: 'Pledged',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

export default async function MemberProfilePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const [{ id }, query] = await Promise.all([params, searchParams]);
	const requestedPage = Number(query.page ?? 1);
	const page =
		(
			Number.isInteger(requestedPage) &&
			requestedPage >= 1 &&
			requestedPage <= 10000
		) ?
			requestedPage
		:	1;
	const profile = await api.user
		.getProfile({ id, page })
		.catch((error: unknown) => {
			if (error instanceof TRPCError && error.code === 'NOT_FOUND')
				notFound();
			throw error;
		});
	const name = profile.name ?? 'Community member';
	const totalPages = Math.max(1, Math.ceil(profile.historyTotal / 20));

	return (
		<div className='profile-page'>
			<section className='profile-hero'>
				<div className='page-wrap profile-hero__inner'>
					<div
						className='profile-avatar'
						aria-hidden='true'>
						{name.charAt(0).toUpperCase()}
					</div>
					<div className='profile-identity'>
						<p className='eyebrow'>GiveToGive member</p>
						<h1 className='display-title'>{name}</h1>
						{profile.supporterTier && (
							<p
								className='profile-supporter-badge'
								title='Optional recognition for paid support. Not identity verification or priority for help.'>
								<span aria-hidden='true'>✳</span>{' '}
								{profile.supporterTier === 'sustainer' ?
									'Sustainer'
								:	'Supporter'}{' '}
								· supports GiveToGive
							</p>
						)}
						{profile.location && (
							<p className='profile-location'>
								<LocationOnRoundedIcon fontSize='small' />
								{profile.location}
							</p>
						)}
					</div>
					{profile.isOwner && (
						<ProfileEditor
							name={name}
							bio={profile.bio}
							location={profile.location}
							showSupporterBadge={
								profile.showSupporterBadge ?? false
							}
							supporterTier={
								profile.ownSupporterTier ?? 'neighbor'
							}
							recognitionStatus={
								profile.ownRecognitionStatus ?? 'pending'
							}
						/>
					)}
				</div>
			</section>
			<section className='page-wrap profile-content'>
				<div className='profile-main'>
					<section className='profile-about'>
						<p className='eyebrow'>About</p>
						<h2 className='section-title'>
							A little introduction.
						</h2>
						<p>
							{profile.bio ??
								(profile.isOwner ?
									'Add a short introduction so neighbors know a little about you.'
								:	'This member has not added an introduction yet.')}
						</p>
					</section>
					{profile.isOwner && (
						<section className='profile-about'>
							<p className='eyebrow'>Only for you</p>
							<h2 className='section-title'>
								Your personal impact.
							</h2>
							<p>
								Your verified financial giving is kept separate
								from public offers and off-platform pledges.
								Only you can see your payment receipts and
								pending gifts.
							</p>
							<div className='profile-pagination'>
								<Link href='/giving'>
									View your giving & receipts ↗
								</Link>
								<Link href='/account/billing'>
									Manage membership ↗
								</Link>
							</div>
						</section>
					)}
					<section
						className='profile-history'
						id='contributions'>
						<div className='profile-section-heading'>
							<div>
								<p className='eyebrow'>Contribution history</p>
								<h2 className='section-title'>
									{profile.isOwner ?
										'Your help in motion.'
									:	'Help shared with neighbors.'}
								</h2>
							</div>
							<span>
								{profile.historyTotal}{' '}
								{profile.isOwner ? 'offers' : 'completed'}
							</span>
						</div>
						<p className='profile-history__explanation'>
							{profile.isOwner ?
								'Your pending and cancelled offers are visible here only to you. Completed contributions appear on your public profile.'
							:	'Completed contributions recorded by the contributor or Ask owner.'
							}
						</p>
						{profile.history.length === 0 ?
							<div className='profile-history__empty'>
								{page > 1 ?
									'No contributions on this page.'
								: profile.isOwner ?
									'Your first offer of help starts with an Ask.'
								:	'No completed contributions to share yet.'}
								<Link
									href={
										page > 1 ? `/members/${id}` : '/asks'
									}>
									{page > 1 ?
										'Back to the first page'
									:	'Explore the community board'}{' '}
									<span aria-hidden='true'>↗</span>
								</Link>
							</div>
						:	<ol className='profile-history__list'>
								{profile.history.map((contribution) => (
									<li key={contribution.id}>
										<div className='profile-history__description'>
											<span
												className={`profile-history__type profile-history__type--${contribution.askType}`}>
												{
													ASK_TYPE_LABELS[
														contribution.askType
													]
												}
											</span>
											<Link
												href={`/asks/${contribution.askSlug}`}>
												{contribution.askTitle}
											</Link>
											<time
												dateTime={contribution.createdAt.toISOString()}>
												Offered{' '}
												{contributionDate.format(
													contribution.createdAt,
												)}
											</time>
										</div>
										<div className='profile-history__amount'>
											<strong>
												{formatAskAmount(
													contribution.askType,
													contribution.amount,
													contribution.currency ??
														'USD',
												)}
											</strong>
											<span
												className={`profile-status profile-status--${contribution.status}`}>
												{
													contributionLabels[
														contribution.status
													]
												}
											</span>
											{contribution.askType ===
												'money' && (
												<small>
													Recorded off-platform
												</small>
											)}
										</div>
									</li>
								))}
							</ol>
						}
						{totalPages > 1 && (
							<nav
								className='profile-pagination'
								aria-label='Contribution history pages'>
								{page > 1 && (
									<Link
										href={`/members/${id}?page=${Math.min(page - 1, totalPages)}#contributions`}>
										← Previous
									</Link>
								)}
								<span>
									Page {page} of {totalPages}
								</span>
								{page < totalPages && (
									<Link
										href={`/members/${id}?page=${page + 1}#contributions`}>
										Next →
									</Link>
								)}
							</nav>
						)}
					</section>
				</div>
				<aside className='trust-card'>
					<p className='eyebrow'>Community activity</p>
					<h2>Small acts add up.</h2>
					<ul>
						{profile.emailConfirmed && (
							<li>
								<CheckCircleRoundedIcon />
								<span>
									<strong>Email confirmed</strong>
									<small>
										Account email confirmed; identity not
										verified
									</small>
								</span>
							</li>
						)}
						<li>
							<strong>{profile.stats.completed}</strong>
							<span>completed contributions</span>
						</li>
						<li>
							<strong>{profile.stats.asksPosted}</strong>
							<span>asks posted</span>
						</li>
						{profile.isOwner && (
							<li>
								<strong>{profile.stats.pledged}</strong>
								<span>
									pending offers
									<small>Only visible to you</small>
								</span>
							</li>
						)}
					</ul>
					{profile.joinedAt && (
						<p className='trust-card__since'>
							Member since {memberSince.format(profile.joinedAt)}
						</p>
					)}
					<p className='trust-card__note'>
						Activity reflects records on GiveToGive. It is not a
						rating or a guarantee of future help.
						{profile.supporterTier &&
							' The optional supporter badge recognizes financial support, not identity or priority for help.'}
					</p>
				</aside>
			</section>
		</div>
	);
}
