'use client';

import {
	ASK_TYPE_LABELS,
	formatAskAmount,
	fromStoredAmount,
	getAskUnitLabel,
	type AskType,
} from '@/lib/asks';
import { api } from '@/trpc/react';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import {
	Alert,
	Box,
	Button,
	Chip,
	Container,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Divider,
	LinearProgress,
	List,
	ListItem,
	ListItemText,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

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

	const submitContribution = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		createContribution.mutate({
			askId: ask.id,
			amount,
			note: note || undefined,
		});
	};

	return (
		<Container
			maxWidth='md'
			sx={{ py: 4 }}>
			<Stack spacing={3}>
				<Stack
					direction='row'
					spacing={1}
					useFlexGap
					flexWrap='wrap'>
					<Chip
						label={ASK_TYPE_LABELS[ask.type]}
						color='secondary'
					/>
					<Chip label={ask.status.replace('_', ' ')} />
					<Chip
						label={`Difficulty ${ask.difficulty}/5`}
						variant='outlined'
					/>
					<Chip
						label={`About ${ask.estimatedMinutesToComplete} minutes`}
						variant='outlined'
					/>
				</Stack>
				<Box>
					<Typography
						variant='h3'
						component='h1'
						gutterBottom>
						{ask.title}
					</Typography>
					<Typography
						variant='subtitle1'
						color='text.secondary'>
						Asked by {ask.creatorName ?? 'a community member'}
					</Typography>
				</Box>
				<Typography variant='body1'>{ask.description}</Typography>
				<Box>
					<Stack
						direction={{ xs: 'column', sm: 'row' }}
						justifyContent='space-between'
						spacing={1}>
						<Typography variant='h6'>
							{formatAskAmount(
								ask.type,
								ask.contributedAmount,
								ask.currency ?? 'USD',
							)}{' '}
							contributed
						</Typography>
						<Typography>
							Goal{' '}
							{formatAskAmount(
								ask.type,
								ask.goalAmount,
								ask.currency ?? 'USD',
							)}
						</Typography>
					</Stack>
					<LinearProgress
						variant='determinate'
						value={progress}
						sx={{ height: 10, borderRadius: 5, mt: 1 }}
					/>
				</Box>
				{viewerId === null ?
					<Button
						href={`/signin?callbackUrl=${encodeURIComponent(`/asks/${ask.slug}`)}`}
						variant='contained'
						color='success'
						size='large'
						startIcon={<VolunteerActivismIcon />}>
						Sign in to offer help
					</Button>
				: isOwner ?
					<Alert severity='info'>
						This is your Ask. Contributions from other community
						members will appear below.
					</Alert>
				: remainingAmount === 0 ?
					<Alert severity='success'>
						This Ask has reached its goal.
					</Alert>
				:	<Button
						onClick={() => setIsOpen(true)}
						variant='contained'
						color='success'
						size='large'
						startIcon={<VolunteerActivismIcon />}>
						Offer Help
					</Button>
				}
				<Divider />
				<Box>
					<Typography
						variant='h5'
						component='h2'>
						Community contributions
					</Typography>
					{ask.contributions.length === 0 ?
						<Typography
							color='text.secondary'
							sx={{ mt: 1 }}>
							Be the first person to contribute.
						</Typography>
					:	<List>
							{ask.contributions.map((contribution) => (
								<ListItem
									key={contribution.id}
									disableGutters>
									<ListItemText
										primary={`${contribution.contributorName ?? 'Community member'} pledged ${formatAskAmount(ask.type, contribution.amount, ask.currency ?? 'USD')}`}
										secondary={
											contribution.note ??
											contribution.status
										}
									/>
								</ListItem>
							))}
						</List>
					}
				</Box>
			</Stack>

			<Dialog
				open={isOpen}
				onClose={() => setIsOpen(false)}
				fullWidth
				maxWidth='sm'>
				<Box
					component='form'
					onSubmit={submitContribution}>
					<DialogTitle>Offer help with this Ask</DialogTitle>
					<DialogContent>
						<Stack
							spacing={2}
							sx={{ pt: 1 }}>
							<Typography color='text.secondary'>
								Remaining:{' '}
								{formatAskAmount(
									ask.type,
									remainingAmount,
									ask.currency ?? 'USD',
								)}
							</Typography>
							<TextField
								autoFocus
								label={
									ask.type === 'money' ?
										`Amount (${ask.currency ?? 'USD'})`
									:	`Amount (${getAskUnitLabel(ask.type, ask.currency ?? 'USD')})`
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
								label='Note (optional)'
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
					<DialogActions>
						<Button onClick={() => setIsOpen(false)}>Cancel</Button>
						<Button
							type='submit'
							variant='contained'
							color='success'
							disabled={createContribution.isPending}>
							{createContribution.isPending ?
								'Saving...'
							:	'Confirm contribution'}
						</Button>
					</DialogActions>
				</Box>
			</Dialog>
		</Container>
	);
}
