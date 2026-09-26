'use client';

import {
	askFilterHref,
	ASK_FILTER_KEYS,
	ASK_STATUSES,
	ASK_STATUS_LABELS,
	parseAskFilters,
} from '@/lib/ask-browsing';
import { ASK_TYPE_LABELS, ASK_TYPES, formatAskAmount } from '@/lib/asks';
import '@/styles/browsing.css';
import { api } from '@/trpc/react';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded';
import { Alert, LinearProgress } from '@mui/material';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FormEvent } from 'react';

import { AskTypeGlyph } from './AskTypeGlyph';

const TIME_OPTIONS = [30, 60, 240, 480];

export function RenderAsksIndex({
	isAuthenticated,
}: {
	isAuthenticated: boolean;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const utils = api.useUtils();
	const filters = parseAskFilters(searchParams);
	const savedRequiresSignIn = filters.savedOnly && !isAuthenticated;
	const asksQuery = api.ask.getAsks.useQuery(filters, {
		enabled: !savedRequiresSignIn,
		retry: 1,
	});
	const saveMutation = api.ask.setSaved.useMutation({
		onSuccess: async () => {
			await utils.ask.getAsks.invalidate();
		},
	});
	const asks = asksQuery.data ?? [];
	const hasFilters = ASK_FILTER_KEYS.some((key) => searchParams.has(key));
	const hasSearchFilters = ASK_FILTER_KEYS.some(
		(key) => key !== 'saved' && searchParams.has(key),
	);
	const hrefWith = (changes: Parameters<typeof askFilterHref>[2]) =>
		askFilterHref(pathname, searchParams.toString(), changes);
	const signInHref = `/signin?callbackUrl=${encodeURIComponent(hrefWith({ saved: '1' }))}`;
	const formKey = JSON.stringify([
		filters.query,
		filters.status,
		filters.maxDifficulty,
		filters.maxMinutes,
	]);

	function submitFilters(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		router.push(
			hrefWith({
				q: String(formData.get('q') ?? '').trim(),
				status: String(formData.get('status') ?? ''),
				difficulty: String(formData.get('difficulty') ?? ''),
				minutes: String(formData.get('minutes') ?? ''),
			}),
			{ scroll: false },
		);
	}

	return (
		<>
			<nav
				className='ask-type-nav'
				aria-label='Browse by Ask type'>
				<Link
					className={!filters.type ? 'is-active' : ''}
					aria-current={!filters.type ? 'page' : undefined}
					href={hrefWith({ type: undefined })}
					scroll={false}>
					All types
				</Link>
				{ASK_TYPES.map((type) => (
					<Link
						key={type}
						className={filters.type === type ? 'is-active' : ''}
						aria-current={
							filters.type === type ? 'page' : undefined
						}
						href={hrefWith({ type })}
						scroll={false}>
						<AskTypeGlyph type={type} />
						{ASK_TYPE_LABELS[type]}
					</Link>
				))}
			</nav>

			<form
				key={formKey}
				className='ask-filters'
				aria-label='Filter Asks'
				onSubmit={submitFilters}>
				<label className='ask-filter-search'>
					<span>Search</span>
					<input
						type='search'
						name='q'
						defaultValue={filters.query ?? ''}
						maxLength={100}
						placeholder='Keywords or a need'
					/>
				</label>
				<label>
					<span>Status</span>
					<select
						name='status'
						defaultValue={filters.status ?? ''}>
						<option value=''>Any status</option>
						{ASK_STATUSES.map((status) => (
							<option
								key={status}
								value={status}>
								{ASK_STATUS_LABELS[status]}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Difficulty</span>
					<select
						name='difficulty'
						defaultValue={filters.maxDifficulty ?? ''}>
						<option value=''>Any level</option>
						{[1, 2, 3, 4, 5].map((level) => (
							<option
								key={level}
								value={level}>
								Up to {level}/5
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Time needed</span>
					<select
						name='minutes'
						defaultValue={filters.maxMinutes ?? ''}>
						<option value=''>Any length</option>
						<option value='30'>30 minutes or less</option>
						<option value='60'>1 hour or less</option>
						<option value='240'>4 hours or less</option>
						<option value='480'>8 hours or less</option>
						{filters.maxMinutes &&
							!TIME_OPTIONS.includes(filters.maxMinutes) && (
								<option value={filters.maxMinutes}>
									{filters.maxMinutes} minutes or less
								</option>
							)}
					</select>
				</label>
				<div className='ask-filter-actions'>
					<button type='submit'>Apply filters</button>
					{hasFilters && (
						<Link
							href={pathname}
							scroll={false}>
							Clear filters
						</Link>
					)}
				</div>
			</form>

			<div className='ask-results-bar'>
				<p
					role='status'
					aria-live='polite'
					aria-atomic='true'>
					{savedRequiresSignIn ?
						'Your saved Asks are private.'
					: asksQuery.isPending || asksQuery.isFetching ?
						'Finding your matches…'
					: asksQuery.isError ?
						'The noticeboard is taking a moment.'
					:	<>
							<strong>{asks.length}</strong>{' '}
							{asks.length === 1 ? 'Ask' : 'Asks'} found
							{asks.length === 100 ?
								' · Showing the latest 100'
							:	''}
						</>
					}
				</p>
				{isAuthenticated ?
					<Link
						className={filters.savedOnly ? 'is-active' : ''}
						aria-current={filters.savedOnly ? 'page' : undefined}
						href={hrefWith({
							saved: filters.savedOnly ? undefined : '1',
						})}
						scroll={false}>
						<BookmarkRoundedIcon fontSize='small' />
						{filters.savedOnly ?
							'Showing saved · Show all'
						:	'Saved Asks'}
					</Link>
				:	<Link href={signInHref}>Sign in to save Asks</Link>}
			</div>

			{saveMutation.isError && (
				<Alert
					severity='error'
					className='ask-save-feedback'
					onClose={() => saveMutation.reset()}>
					We couldn&apos;t update your saved Asks. Please try the
					bookmark again.
				</Alert>
			)}
			<span
				className='ask-screen-reader-only'
				role='status'
				aria-live='polite'>
				{saveMutation.isSuccess ?
					saveMutation.data.saved ?
						'Ask saved.'
					:	'Ask removed from saved Asks.'
				:	''}
			</span>

			{savedRequiresSignIn ?
				<div className='asks-empty'>
					<p className='eyebrow'>A place for your good intentions</p>
					<h3>Keep a few Asks close.</h3>
					<p>
						Sign in to find the Asks you saved and pick up where you
						left off.
					</p>
					<Link
						className='ask-browse-action'
						href={signInHref}>
						Sign in to view saved Asks
					</Link>
				</div>
			: asksQuery.isPending ?
				<div
					className='asks-loading'
					role='status'>
					Loading the noticeboard…
				</div>
			: asksQuery.isError ?
				<div
					className='asks-empty'
					role='alert'>
					<p className='eyebrow'>A small interruption</p>
					<h3>Let&apos;s try that again.</h3>
					<p>
						We couldn&apos;t load these Asks. Your filters are still
						here.
					</p>
					<button
						className='ask-browse-action'
						type='button'
						onClick={() => void asksQuery.refetch()}>
						Try again
					</button>
				</div>
			: asks.length === 0 ?
				<div className='asks-empty'>
					<p className='eyebrow'>
						{filters.savedOnly ?
							'Your saved Asks'
						:	'Room for possibility'}
					</p>
					<h3>
						{hasSearchFilters ?
							'Try a wider search.'
						: filters.savedOnly ?
							'Save something for later.'
						:	'The board is clear.'}
					</h3>
					<p>
						{hasSearchFilters ?
							'Clear a filter or choose another type to find a way to help.'
						: filters.savedOnly ?
							'Tap the bookmark on an Ask to keep it here. Only you can see your saved list.'
						:	'Post the first Ask and make it easy for a neighbor to lend a hand.'
						}
					</p>
					{hasFilters && (
						<Link
							className='ask-browse-action'
							href={pathname}
							scroll={false}>
							Browse all Asks
						</Link>
					)}
				</div>
			:	<div
					className='ask-card-grid'
					aria-busy={asksQuery.isFetching}>
					{asks.map((ask) => {
						const progress =
							ask.goalAmount > 0 ?
								Math.min(
									(ask.contributedAmount / ask.goalAmount) *
										100,
									100,
								)
							:	0;
						const remaining = Math.max(
							ask.goalAmount - ask.contributedAmount,
							0,
						);
						return (
							<article
								key={ask.id}
								className={`ask-card ask-card--${ask.type}`}>
								<div className='ask-card__topline'>
									<AskTypeGlyph type={ask.type} />
									<span className='ask-card__kind'>
										{ASK_TYPE_LABELS[ask.type]}
									</span>
									<span className='ask-card__status'>
										{ASK_STATUS_LABELS[ask.status]}
									</span>
									{isAuthenticated && (
										<button
											type='button'
											className={`ask-save-button${ask.saved ? 'is-saved' : ''}`}
											disabled={saveMutation.isPending}
											onClick={() =>
												saveMutation.mutate({
													askId: ask.id,
													saved: !ask.saved,
												})
											}
											aria-pressed={ask.saved}
											aria-label={
												ask.saved ?
													`Remove ${ask.title} from saved Asks`
												:	`Save ${ask.title}`
											}>
											{ask.saved ?
												<BookmarkRoundedIcon />
											:	<BookmarkBorderRoundedIcon />}
										</button>
									)}
								</div>
								<h3>{ask.title}</h3>
								<p className='ask-card__description'>
									{ask.description}
								</p>
								<div className='ask-card__meta'>
									<span>Difficulty {ask.difficulty}/5</span>
									<span>
										About {ask.estimatedMinutesToComplete}{' '}
										min
									</span>
								</div>
								<div className='ask-card__progress'>
									<div>
										<strong>
											{formatAskAmount(
												ask.type,
												ask.contributedAmount,
												ask.currency ?? 'USD',
											)}
										</strong>
										<span>
											{' '}
											of{' '}
											{formatAskAmount(
												ask.type,
												ask.goalAmount,
												ask.currency ?? 'USD',
											)}
										</span>
									</div>
									<LinearProgress
										variant='determinate'
										value={progress}
										aria-label={`${ask.title} contribution progress`}
									/>
									<p>
										{remaining === 0 ?
											ask.status === 'complete' ?
												'This goal has been completed.'
											:	'The goal is fully pledged. Help is on its way.'

										:	`${formatAskAmount(ask.type, remaining, ask.currency ?? 'USD')} still makes a difference.`
										}
									</p>
									{ask.completedAmount > 0 &&
										ask.status !== 'complete' && (
											<p>
												{formatAskAmount(
													ask.type,
													ask.completedAmount,
													ask.currency ?? 'USD',
												)}{' '}
												completed so far.
											</p>
										)}
								</div>
								<Link
									href={`/asks/${ask.slug}`}
									className='ask-card__link'>
									View this ask{' '}
									<ArrowOutwardRoundedIcon fontSize='small' />
								</Link>
							</article>
						);
					})}
				</div>
			}
		</>
	);
}
