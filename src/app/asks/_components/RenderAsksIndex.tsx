'use client';

import { ASK_TYPE_LABELS, formatAskAmount } from '@/lib/asks';
import { api } from '@/trpc/react';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import { LinearProgress } from '@mui/material';
import Link from 'next/link';

import { AskTypeGlyph } from './AskTypeGlyph';

function statusLabel(status: string) {
	return status.replace('_', ' ');
}

export function RenderAsksIndex() {
	const [asks] = api.ask.getAsks.useSuspenseQuery({});

	if (asks.length === 0) {
		return (
			<div className='asks-empty'>
				<p className='eyebrow'>The board is clear</p>
				<h3>No asks yet.</h3>
				<p>
					Start the first one and make it easy for a neighbor to lend
					a hand.
				</p>
			</div>
		);
	}

	return (
		<div className='ask-card-grid'>
			{asks.map((ask) => {
				const progress = Math.min(
					(ask.contributedAmount / ask.goalAmount) * 100,
					100,
				);
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
								{statusLabel(ask.status)}
							</span>
						</div>
						<h3>{ask.title}</h3>
						<p className='ask-card__description'>
							{ask.description}
						</p>
						<div className='ask-card__meta'>
							<span>Difficulty {ask.difficulty}/5</span>
							<span>
								About {ask.estimatedMinutesToComplete} min
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
							/>
							<p>
								{remaining === 0 ?
									'This goal has been met.'
								:	`${formatAskAmount(ask.type, remaining, ask.currency ?? 'USD')} still makes a difference.`
								}
							</p>
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
	);
}
