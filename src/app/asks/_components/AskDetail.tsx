'use client';

import {
	ASK_TYPE_LABELS,
	formatAskAmount,
	fromStoredAmount,
	getAskUnitLabel,
	type AskType,
} from '@/lib/asks';
import { api } from '@/trpc/react';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import {
	Alert,
	Box,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	LinearProgress,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { AskTypeGlyph } from './AskTypeGlyph';

interface Contribution {
	id: number;
	amount: number;
	note: string | null;
	status: 'pledged' | 'completed' | 'cancelled';
	createdAt: string;
	contributorId: string;
	contributorName: string | null;
}

interface AskDetailValue {
	id: number;
	slug: string;
	title: string;
	description: string;
	type: AskType;
	goalAmount: number;
	currency: string | null;
	status: 'not_started' | 'in_progress' | 'complete';
	difficulty: number;
	estimatedMinutesToComplete: number;
	createdById: string;
	fullFilledById: string | null;
	createdAt: string;
	updatedAt: string | null;
	creatorName: string | null;
	contributedAmount: number;
	contributions: Contribution[];
}

function statusLabel(status: string) {
	return status.replace('_', ' ');
}

export function AskDetail({
	ask,
	viewerId,
}: {
	ask: AskDetailValue;
	viewerId: string | null;
}) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [amount, setAmount] = useState(() => {
		const remaining = fromStoredAmount(
			ask.type,
			ask.goalAmount - ask.contributedAmount,
		);
		return Math.min(remaining, ask.type === 'money' ? 25 : 1);
	});
	const [note, setNote] = useState('');
	const createContribution = api.ask.createContribution.useMutation({
		onSuccess: () => {
			setIsOpen(false);
			setNote('');
			router.refresh();
		},
	});
	const remainingAmount = Math.max(ask.goalAmount - ask.contributedAmount, 0);
	const progress = Math.min(
		(ask.contributedAmount / ask.goalAmount) * 100,
		100,
	);
	const isOwner = viewerId === ask.createdById;
	const currency = ask.currency ?? 'USD';

	const submitContribution = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		createContribution.mutate({
			askId: ask.id,
			amount,
			note: note || undefined,
		});
	};

	return (
		<div className={`ask-detail ask-detail--${ask.type}`}>
			<section className='ask-detail__hero'>
				<div className='page-wrap ask-detail__hero-grid'>
					<div className='ask-detail__headline'>
						<Link
							href='/asks'
							className='back-link'>
							<ArrowBackRoundedIcon fontSize='small' /> Back to
							the noticeboard
						</Link>
						<div className='ask-detail__badges'>
							<span className='ask-detail__type'>
								<AskTypeGlyph type={ask.type} />{' '}
								{ASK_TYPE_LABELS[ask.type]}
							</span>
							<span>{statusLabel(ask.status)}</span>
						</div>
						<h1 className='display-title'>{ask.title}</h1>
						<p className='ask-detail__byline'>
							Asked by{' '}
							<strong>
								{ask.creatorName ?? 'a community member'}
							</strong>
						</p>
					</div>

					<aside className='contribution-panel'>
						<p className='eyebrow'>Contribution progress</p>
						<div className='contribution-panel__amounts'>
							<strong>
								{formatAskAmount(
									ask.type,
									ask.contributedAmount,
									currency,
								)}
							</strong>
							<span>
								of{' '}
								{formatAskAmount(
									ask.type,
									ask.goalAmount,
									currency,
								)}
							</span>
						</div>
						<LinearProgress
							variant='determinate'
							value={progress}
						/>
						<p className='contribution-panel__remaining'>
							{remainingAmount === 0 ?
								'This ask has reached its goal.'
							:	`${formatAskAmount(ask.type, remainingAmount, currency)} remains.`
							}
						</p>

						{viewerId === null ?
							<Button
								href={`/signin?callbackUrl=${encodeURIComponent(`/asks/${ask.slug}`)}`}
								variant='contained'
								className='detail-offer-button'
								startIcon={<VolunteerActivismIcon />}>
								Sign in to offer help
							</Button>
						: isOwner ?
							<Alert
								severity='info'
								className='detail-state'>
								This is your Ask. Community contributions will
								appear below.
							</Alert>
						: remainingAmount === 0 ?
							<Alert
								severity='success'
								className='detail-state'>
								The neighborhood met this goal.
							</Alert>
						:	<Button
								onClick={() => setIsOpen(true)}
								variant='contained'
								className='detail-offer-button'
								startIcon={<VolunteerActivismIcon />}>
								Offer a contribution
							</Button>
						}
					</aside>
				</div>
			</section>

			<section className='page-wrap ask-detail__content'>
				<div className='ask-detail__story'>
					<p className='eyebrow'>The full ask</p>
					<h2 className='section-title'>Here is what would help.</h2>
					<p className='ask-detail__description'>{ask.description}</p>
					<div className='ask-detail__facts'>
						<div>
							<span>Difficulty</span>
							<strong>{ask.difficulty}/5</strong>
						</div>
						<div>
							<span>Time estimate</span>
							<strong>
								About {ask.estimatedMinutesToComplete} min
							</strong>
						</div>
						<div>
							<span>Supporters</span>
							<strong>{ask.contributions.length}</strong>
						</div>
					</div>
				</div>

				<div className='contribution-wall'>
					<div className='contribution-wall__heading'>
						<div>
							<p className='eyebrow'>The reply wall</p>
							<h2 className='section-title'>
								Neighbors who stepped up
							</h2>
						</div>
						<span>
							{ask.contributions.length} contribution
							{ask.contributions.length === 1 ? '' : 's'}
						</span>
					</div>
					{ask.contributions.length === 0 ?
						<div className='contribution-wall__empty'>
							<p>
								There is room for the first reply. A small share
								can move this one forward.
							</p>
						</div>
					:	<ol className='contribution-list'>
							{ask.contributions.map((contribution, index) => (
								<li key={contribution.id}>
									<span className='contribution-list__number'>
										{String(index + 1).padStart(2, '0')}
									</span>
									<div>
										<strong>
											{contribution.contributorName ??
												'Community member'}
										</strong>
										<p>
											{contribution.note ??
												'Shared a contribution with this Ask.'}
										</p>
									</div>
									<span className='contribution-list__amount'>
										{formatAskAmount(
											ask.type,
											contribution.amount,
											currency,
										)}
									</span>
								</li>
							))}
						</ol>
					}
				</div>
			</section>

			<Dialog
				open={isOpen}
				onClose={() => setIsOpen(false)}
				fullWidth
				maxWidth='sm'>
				<Box
					component='form'
					onSubmit={submitContribution}>
					<DialogTitle className='contribution-dialog__title'>
						Your part of the help
					</DialogTitle>
					<DialogContent>
						<Stack
							spacing={2.2}
							sx={{ pt: 1 }}>
							<Typography color='text.secondary'>
								{formatAskAmount(
									ask.type,
									remainingAmount,
									currency,
								)}{' '}
								remains. Share only what works for you.
							</Typography>
							<TextField
								autoFocus
								label={
									ask.type === 'money' ?
										`Amount (${currency})`
									:	`Amount (${getAskUnitLabel(ask.type, currency)})`
								}
								value={amount}
								onChange={(event) =>
									setAmount(Number(event.target.value))
								}
								inputProps={{
									min: ask.type === 'money' ? 0.01 : 1,
									max: fromStoredAmount(
										ask.type,
										remainingAmount,
									),
									step: ask.type === 'money' ? 0.01 : 1,
								}}
								type='number'
								fullWidth
								required
							/>
							<TextField
								label='A note for the asker (optional)'
								value={note}
								onChange={(event) =>
									setNote(event.target.value)
								}
								inputProps={{ maxLength: 500 }}
								multiline
								rows={3}
								fullWidth
							/>
							{createContribution.error && (
								<Alert severity='error'>
									{createContribution.error.message}
								</Alert>
							)}
						</Stack>
					</DialogContent>
					<DialogActions sx={{ px: 3, pb: 3 }}>
						<Button onClick={() => setIsOpen(false)}>
							Not yet
						</Button>
						<Button
							type='submit'
							variant='contained'
							color='secondary'
							disabled={createContribution.isPending}>
							{createContribution.isPending ?
								'Saving...'
							:	'Confirm contribution'}
						</Button>
					</DialogActions>
				</Box>
			</Dialog>
		</div>
	);
}
