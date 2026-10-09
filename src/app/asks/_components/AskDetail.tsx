'use client';

import {
	ASK_TYPE_LABELS,
	formatAskAmount,
	fromStoredAmount,
	getAskUnitLabel,
	type AskType,
} from '@/lib/asks';
import { api } from '@/trpc/react';
import '@/styles/lifecycle.css';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
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
import {
	AskPaymentPanel,
	type AskPaymentState,
} from '@/app/_components/payments/AskPaymentPanel';

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
	completedAmount: number;
	contributions: Contribution[];
	activities: Array<{
		id: number;
		type:
			| 'ask_created'
			| 'ask_updated'
			| 'contribution_created'
			| 'contribution_completed'
			| 'contribution_cancelled';
		metadata: Record<string, unknown> | null;
		createdAt: string;
		actorId: string;
		actorName: string | null;
		contributionId: number | null;
	}>;
}

function statusLabel(status: string) {
	return status.replaceAll('_', ' ');
}

function activityLabel(activity: AskDetailValue['activities'][number]) {
	const name = activity.actorName ?? 'A community member';
	switch (activity.type) {
		case 'ask_created':
			return `${name} posted this Ask.`;
		case 'ask_updated': {
			const fields =
				Array.isArray(activity.metadata?.['fields']) ?
					activity.metadata['fields']
						.filter(
							(field): field is string =>
								typeof field === 'string',
						)
						.map(
							(field) =>
								({
									estimatedMinutesToComplete: 'time estimate',
									goalAmount: 'goal',
								})[field] ?? field,
						)
						.join(', ')
				:	'details';
			return `${name} updated the ${fields}.`;
		}
		case 'contribution_created':
			return `${name} offered a contribution.`;
		case 'contribution_completed':
			return `${name} marked a contribution complete.`;
		case 'contribution_cancelled':
			return `${name} cancelled a contribution.`;
	}
}

export function AskDetail({
	ask,
	viewerId,
	paymentState,
}: {
	ask: AskDetailValue;
	viewerId: string | null;
	paymentState: AskPaymentState | null;
}) {
	const router = useRouter();
	const utils = api.useUtils();
	const [notice, setNotice] = useState('');
	const [cancelling, setCancelling] = useState<Contribution | null>(null);
	const [completing, setCompleting] = useState<Contribution | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [amount, setAmount] = useState(() => {
		const remaining = fromStoredAmount(
			ask.type,
			ask.goalAmount - ask.contributedAmount,
		);
		return Math.min(remaining, ask.type === 'money' ? 25 : 1);
	});
	const [note, setNote] = useState('');
	const [isEditing, setIsEditing] = useState(false);
	const [editValues, setEditValues] = useState({
		title: ask.title,
		description: ask.description,
		difficulty: ask.difficulty,
		estimatedMinutesToComplete: ask.estimatedMinutesToComplete,
		goalAmount: fromStoredAmount(ask.type, ask.goalAmount),
	});
	const createContribution = api.ask.createContribution.useMutation({
		onSuccess: async () => {
			setIsOpen(false);
			setNote('');
			setNotice(
				'Your contribution has been pledged. Mark it complete after the help has been delivered.',
			);
			await utils.invalidate();
			router.refresh();
		},
	});
	const updateContribution = api.ask.updateContributionStatus.useMutation({
		onSuccess: async (__data, variables) => {
			setCancelling(null);
			setCompleting(null);
			setNotice(
				variables.status === 'completed' ?
					'Contribution marked complete. Thank you for following through.'
				:	'Contribution cancelled. That amount is available for someone else to offer.',
			);
			await utils.invalidate();
			router.refresh();
		},
	});
	const updateAsk = api.ask.updateAsk.useMutation({
		onSuccess: async () => {
			setIsEditing(false);
			setNotice('Your Ask has been updated. Its link stays the same.');
			await utils.invalidate();
			router.refresh();
		},
	});
	const remainingAmount = Math.max(ask.goalAmount - ask.contributedAmount, 0);
	const progress = Math.min(
		(ask.contributedAmount / ask.goalAmount) * 100,
		100,
	);
	const isOwner = viewerId === ask.createdById;
	const verifiedPayments = Boolean(paymentState?.funding.enabled);
	const currency = ask.currency ?? 'USD';
	const activeContributions = ask.contributions.filter(
		(contribution) => contribution.status !== 'cancelled',
	);
	const supporterCount = new Set(
		activeContributions.map((contribution) => contribution.contributorId),
	).size;
	const openContributionDialog = () => {
		createContribution.reset();
		setAmount(
			Math.min(
				fromStoredAmount(ask.type, remainingAmount),
				ask.type === 'money' ? 25 : 1,
			),
		);
		setIsOpen(true);
	};

	const submitContribution = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		createContribution.mutate({
			askId: ask.id,
			amount,
			note: note || undefined,
		});
	};
	const submitAskUpdate = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		updateAsk.mutate({ askId: ask.id, ...editValues });
	};
	const visibleActivities =
		ask.activities.some((activity) => activity.type === 'ask_created') ?
			ask.activities
		:	[
				...ask.activities,
				{
					id: -ask.id,
					type: 'ask_created' as const,
					metadata: null,
					createdAt: ask.createdAt,
					actorId: ask.createdById,
					actorName: ask.creatorName,
					contributionId: null,
				},
			].sort(
				(left, right) =>
					new Date(right.createdAt).getTime() -
					new Date(left.createdAt).getTime(),
			);

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
							<Link
								href={`/members/${ask.createdById}`}
								className='member-link'>
								{ask.creatorName ?? 'a community member'}
							</Link>
						</p>
					</div>

					{verifiedPayments && paymentState ?
						<AskPaymentPanel
							askId={ask.id}
							slug={ask.slug}
							title={ask.title}
							isOwner={isOwner}
							signedIn={viewerId !== null}
							state={paymentState}
						/>
					:	<aside className='contribution-panel'>
							<p className='eyebrow'>
								{ask.type === 'money' ?
									'Off-platform pledges · not verified payments'
								:	'Pledged & completed'}
							</p>
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
								aria-label='Amount pledged or completed toward the goal'
								variant='determinate'
								value={progress}
							/>
							<p className='contribution-panel__remaining'>
								{remainingAmount === 0 ?
									ask.status === 'complete' ?
										'This Ask has been completed.'
									:	'The goal is fully pledged. Delivery is still in progress.'

								:	`${formatAskAmount(ask.type, remainingAmount, currency)} remaining.`
								}
							</p>
							<p className='contribution-panel__completed'>
								{formatAskAmount(
									ask.type,
									ask.completedAmount,
									currency,
								)}{' '}
								completed
							</p>
							{ask.type === 'money' && (
								<p className='contribution-panel__disclaimer'>
									This Ask uses off-platform pledges arranged
									between members. These amounts are
									self-reported, not Stripe payments, and are
									excluded from verified giving totals.
								</p>
							)}

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
									This is your Ask. Community contributions
									will appear below.
									{ask.type === 'money' && (
										<p>
											<Link href='/account/receiving'>
												Set up receiving and review
												payment eligibility ↗
											</Link>
										</p>
									)}
								</Alert>
							: remainingAmount === 0 ?
								<Alert
									severity='success'
									className='detail-state'>
									{ask.status === 'complete' ?
										'The neighborhood completed this goal.'
									:	'This goal is fully pledged.'}
								</Alert>
							:	<Button
									onClick={openContributionDialog}
									variant='contained'
									className='detail-offer-button'
									startIcon={<VolunteerActivismIcon />}>
									Offer a contribution
								</Button>
							}
						</aside>
					}
				</div>
			</section>

			<section className='page-wrap ask-detail__content'>
				{notice && (
					<Alert
						className='lifecycle-notice'
						severity='success'
						role='status'
						onClose={() => setNotice('')}>
						{notice}
					</Alert>
				)}
				{updateContribution.error && !cancelling && !completing && (
					<Alert
						className='lifecycle-notice'
						severity='error'
						onClose={() => updateContribution.reset()}>
						{updateContribution.error.message}
					</Alert>
				)}
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
							<span>
								{verifiedPayments ?
									'Progress source'
								:	'Contributors'}
							</span>
							<strong>
								{verifiedPayments ?
									'Verified payments'
								:	supporterCount}
							</strong>
						</div>
					</div>
					{isOwner && (
						<Button
							variant='outlined'
							startIcon={<EditRoundedIcon />}
							onClick={() => {
								updateAsk.reset();
								setEditValues({
									title: ask.title,
									description: ask.description,
									difficulty: ask.difficulty,
									estimatedMinutesToComplete:
										ask.estimatedMinutesToComplete,
									goalAmount: fromStoredAmount(
										ask.type,
										ask.goalAmount,
									),
								});
								setIsEditing(true);
							}}>
							Edit this Ask
						</Button>
					)}
				</div>

				{verifiedPayments ?
					<div className='contribution-wall'>
						<p className='eyebrow'>Financial privacy</p>
						<h2 className='section-title'>
							Real help. Private receipts.
						</h2>
						<p>
							Verified totals are shared above. Payment details,
							receipts, and donor identities are not published on
							the reply wall. A Checkout return page never marks a
							gift complete; Stripe confirmation does.
						</p>
					</div>
				:	<div className='contribution-wall'>
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
						{ask.type === 'money' && (
							<Alert severity='info'>
								Off-platform contribution history. “Completed”
								means a member reported delivery; it does not
								prove a verified Stripe payment.
							</Alert>
						)}
						{ask.contributions.length === 0 ?
							<div className='contribution-wall__empty'>
								<p>
									There is room for the first reply. A small
									share can move this one forward.
								</p>
							</div>
						:	<ol className='contribution-list'>
								{ask.contributions.map(
									(contribution, index) => (
										<li
											key={contribution.id}
											data-contribution-id={
												contribution.id
											}>
											<span className='contribution-list__number'>
												{String(index + 1).padStart(
													2,
													'0',
												)}
											</span>
											<div>
												<Link
													href={`/members/${contribution.contributorId}`}
													className='member-link'>
													{contribution.contributorName ??
														'Community member'}
												</Link>
												<p>
													{contribution.note ??
														'Shared a contribution with this Ask.'}
												</p>
												<small>
													{statusLabel(
														contribution.status,
													)}
												</small>
											</div>
											<span className='contribution-list__amount'>
												{formatAskAmount(
													ask.type,
													contribution.amount,
													currency,
												)}
											</span>
											{contribution.status ===
												'pledged' &&
												(viewerId ===
													contribution.contributorId ||
													isOwner) && (
													<div className='contribution-list__actions'>
														{contribution.status ===
															'pledged' && (
															<Button
																size='small'
																startIcon={
																	<CheckCircleRoundedIcon />
																}
																disabled={
																	updateContribution.isPending
																}
																onClick={() => {
																	updateContribution.reset();
																	setCompleting(
																		contribution,
																	);
																}}>
																Mark complete
															</Button>
														)}
														{viewerId ===
															contribution.contributorId && (
															<Button
																size='small'
																color='error'
																disabled={
																	updateContribution.isPending
																}
																onClick={() => {
																	updateContribution.reset();
																	setCancelling(
																		contribution,
																	);
																}}>
																Cancel
															</Button>
														)}
													</div>
												)}
										</li>
									),
								)}
							</ol>
						}
					</div>
				}

				<div className='activity-history'>
					<p className='eyebrow'>Activity history</p>
					<h2 className='section-title'>How this Ask has moved</h2>
					<ol>
						{visibleActivities.map((activity) => (
							<li key={activity.id}>
								<strong>{activityLabel(activity)}</strong>
								<time dateTime={activity.createdAt}>
									{new Intl.DateTimeFormat('en', {
										dateStyle: 'medium',
										timeStyle: 'short',
										timeZone: 'UTC',
									}).format(new Date(activity.createdAt))}
									{' UTC'}
								</time>
							</li>
						))}
					</ol>
				</div>
			</section>

			<Dialog
				open={isOpen}
				onClose={() => {
					if (!createContribution.isPending) setIsOpen(false);
				}}
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
							{ask.type === 'money' && (
								<Alert severity='info'>
									This is an off-platform pledge, not a
									payment. No money is collected here. Arrange
									delivery with the Ask owner and mark it
									complete only after delivery.
								</Alert>
							)}
							<Typography color='text.secondary'>
								{formatAskAmount(
									ask.type,
									remainingAmount,
									currency,
								)}{' '}
								remaining. Share only what works for you.
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
						<Button
							disabled={createContribution.isPending}
							onClick={() => setIsOpen(false)}>
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

			<Dialog
				open={isEditing}
				onClose={() => {
					if (!updateAsk.isPending) setIsEditing(false);
				}}
				fullWidth
				maxWidth='sm'>
				<Box
					component='form'
					onSubmit={submitAskUpdate}>
					<DialogTitle>Update your Ask</DialogTitle>
					<DialogContent>
						<Stack
							spacing={2.2}
							sx={{ pt: 1 }}>
							<TextField
								label='Title'
								inputProps={{ maxLength: 256 }}
								value={editValues.title}
								onChange={(event) =>
									setEditValues((values) => ({
										...values,
										title: event.target.value,
									}))
								}
								required
							/>
							<TextField
								label='Description'
								inputProps={{ maxLength: 20_000 }}
								value={editValues.description}
								onChange={(event) =>
									setEditValues((values) => ({
										...values,
										description: event.target.value,
									}))
								}
								multiline
								rows={4}
								required
							/>
							<TextField
								label='Difficulty (1–5)'
								value={editValues.difficulty}
								onChange={(event) =>
									setEditValues((values) => ({
										...values,
										difficulty: Number(event.target.value),
									}))
								}
								type='number'
								inputProps={{ min: 1, max: 5, step: 1 }}
								required
							/>
							<TextField
								label='Time estimate (minutes)'
								value={editValues.estimatedMinutesToComplete}
								onChange={(event) =>
									setEditValues((values) => ({
										...values,
										estimatedMinutesToComplete: Number(
											event.target.value,
										),
									}))
								}
								type='number'
								inputProps={{ min: 1, max: 1_000_000, step: 1 }}
								required
							/>
							<TextField
								label={`Goal (${getAskUnitLabel(ask.type, currency)})`}
								helperText={
									verifiedPayments ?
										'The verified payment goal is locked after enrollment.'
									:	'The goal cannot be lower than existing pledges and completed contributions.'
								}
								disabled={verifiedPayments}
								value={editValues.goalAmount}
								onChange={(event) =>
									setEditValues((values) => ({
										...values,
										goalAmount: Number(event.target.value),
									}))
								}
								type='number'
								inputProps={{
									min: ask.type === 'money' ? 0.01 : 1,
									step: ask.type === 'money' ? 0.01 : 1,
								}}
								required
							/>
							{updateAsk.error && (
								<Alert severity='error'>
									{updateAsk.error.message}
								</Alert>
							)}
						</Stack>
					</DialogContent>
					<DialogActions sx={{ px: 3, pb: 3 }}>
						<Button
							disabled={updateAsk.isPending}
							onClick={() => setIsEditing(false)}>
							Cancel
						</Button>
						<Button
							type='submit'
							variant='contained'
							disabled={updateAsk.isPending}>
							{updateAsk.isPending ? 'Saving...' : 'Save changes'}
						</Button>
					</DialogActions>
				</Box>
			</Dialog>
			<Dialog
				open={completing !== null}
				onClose={() => {
					if (!updateContribution.isPending) setCompleting(null);
				}}
				fullWidth
				maxWidth='xs'>
				<DialogTitle>Mark this contribution complete?</DialogTitle>
				<DialogContent>
					<Typography>
						Confirm that this help has been{' '}
						{isOwner ? 'received' : 'delivered'}. The completed
						contribution will become part of this Ask’s history and
						can no longer be cancelled.
					</Typography>
					{ask.type === 'money' && (
						<Typography
							color='text.secondary'
							sx={{ mt: 2 }}>
							This records a contribution arranged outside
							GiveToGive. No payment is collected or sent here.
						</Typography>
					)}
					{updateContribution.error && (
						<Alert
							severity='error'
							sx={{ mt: 2 }}>
							{updateContribution.error.message}
						</Alert>
					)}
				</DialogContent>
				<DialogActions sx={{ px: 3, pb: 3 }}>
					<Button
						disabled={updateContribution.isPending}
						onClick={() => setCompleting(null)}>
						Not yet
					</Button>
					<Button
						variant='contained'
						disabled={updateContribution.isPending}
						onClick={() => {
							if (completing)
								updateContribution.mutate({
									contributionId: completing.id,
									status: 'completed',
								});
						}}>
						{updateContribution.isPending ?
							'Saving...'
						:	'Mark complete'}
					</Button>
				</DialogActions>
			</Dialog>
			<Dialog
				open={cancelling !== null}
				onClose={() => {
					if (!updateContribution.isPending) setCancelling(null);
				}}
				fullWidth
				maxWidth='xs'>
				<DialogTitle>Cancel your pledge?</DialogTitle>
				<DialogContent>
					<Typography>
						This releases your{' '}
						{cancelling ?
							formatAskAmount(
								ask.type,
								cancelling.amount,
								currency,
							)
						:	'contribution'}{' '}
						so another neighbor can offer help. The cancellation
						will remain in this Ask’s activity history.
					</Typography>
					{updateContribution.error && (
						<Alert
							severity='error'
							sx={{ mt: 2 }}>
							{updateContribution.error.message}
						</Alert>
					)}
				</DialogContent>
				<DialogActions sx={{ px: 3, pb: 3 }}>
					<Button
						disabled={updateContribution.isPending}
						onClick={() => setCancelling(null)}>
						Keep my pledge
					</Button>
					<Button
						variant='contained'
						color='error'
						disabled={updateContribution.isPending}
						onClick={() => {
							if (cancelling)
								updateContribution.mutate({
									contributionId: cancelling.id,
									status: 'cancelled',
								});
						}}>
						{updateContribution.isPending ?
							'Cancelling...'
						:	'Cancel pledge'}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}
