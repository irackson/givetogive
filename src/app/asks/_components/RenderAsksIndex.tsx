'use client';

import { ASK_TYPE_LABELS, formatAskAmount } from '@/lib/asks';
import { api } from '@/trpc/react';
import {
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	LinearProgress,
	Stack,
	Typography,
} from '@mui/material';
import type { Route } from 'next';
import Link from 'next/link';

export function RenderAsksIndex() {
	const [asks] = api.ask.getAsks.useSuspenseQuery({});

	return (
		<Box
			display='flex'
			flexWrap='wrap'
			justifyContent='center'
			gap={3}
			mt={3}>
			{asks.map((ask) => {
				const progress = Math.min(
					(ask.contributedAmount / ask.goalAmount) * 100,
					100,
				);
				return (
					<Card
						key={ask.id}
						sx={{
							width: 320,
							display: 'flex',
							flexDirection: 'column',
						}}>
						<CardContent
							sx={{
								display: 'flex',
								flexDirection: 'column',
								flexGrow: 1,
								gap: 1.5,
							}}>
							<Stack
								direction='row'
								spacing={1}
								useFlexGap
								flexWrap='wrap'>
								<Chip
									label={ASK_TYPE_LABELS[ask.type]}
									color='secondary'
									size='small'
								/>
								<Chip
									label={ask.status.replace('_', ' ')}
									size='small'
								/>
								<Chip
									label={`Difficulty ${ask.difficulty}/5`}
									variant='outlined'
									size='small'
								/>
							</Stack>
							<Typography
								variant='h5'
								component='h2'>
								{ask.title}
							</Typography>
							<Typography
								variant='body2'
								color='text.secondary'
								sx={{ flexGrow: 1 }}>
								{ask.description}
							</Typography>
							<Box>
								<Stack
									direction='row'
									justifyContent='space-between'>
									<Typography variant='caption'>
										{formatAskAmount(
											ask.type,
											ask.contributedAmount,
											ask.currency ?? 'USD',
										)}{' '}
										raised
									</Typography>
									<Typography variant='caption'>
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
									sx={{ mt: 0.5 }}
								/>
							</Box>
							<Link
								href={`/asks/${ask.slug}` as Route}
								passHref>
								<Button
									variant='contained'
									fullWidth>
									View Details
								</Button>
							</Link>
						</CardContent>
					</Card>
				);
			})}
		</Box>
	);
}
