'use client';

import type { RouterOutputs } from '@/trpc/react';
import { Alert, LinearProgress } from '@mui/material';
import Link from 'next/link';
import { ContributionCheckout } from './ContributionCheckout';
import { EnvironmentNote, Money } from './PaymentPrimitives';

export type AskPaymentState = {
	funding: RouterOutputs['billing']['askFunding'];
	availability: RouterOutputs['billing']['availability'];
};

export function AskPaymentPanel({
	askId,
	slug,
	title,
	isOwner,
	signedIn,
	state,
}: {
	askId: number;
	slug: string;
	title: string;
	isOwner: boolean;
	signedIn: boolean;
	state: AskPaymentState;
}) {
	const { funding, availability } = state;
	const remaining = Math.max(
		0,
		funding.goalAmount - funding.paidAmount - funding.pendingAmount,
	);
	const paidInFull = funding.paidAmount >= funding.goalAmount;
	return (
		<aside className='contribution-panel payment-stack'>
			<p className='eyebrow'>Verified contributions · net to recipient</p>
			<div className='contribution-panel__amounts'>
				<strong>
					<Money amount={funding.paidAmount} />
				</strong>
				<span>
					of <Money amount={funding.goalAmount} />
				</span>
			</div>
			<LinearProgress
				aria-label='Verified net contributions toward this goal; pending payments and unresolved disputes excluded'
				variant='determinate'
				value={
					funding.goalAmount > 0 ?
						Math.min(
							100,
							(funding.paidAmount / funding.goalAmount) * 100,
						)
					:	0
				}
			/>
			<p>
				{paidInFull ?
					'The verified contribution goal has been reached.'
				:	<>
						<Money
							amount={Math.max(
								0,
								funding.goalAmount - funding.paidAmount,
							)}
						/>{' '}
						still needed in verified help.
					</>
				}
			</p>
			{funding.pendingAmount > 0 && (
				<Alert severity='info'>
					<Money amount={funding.pendingAmount} /> is reserved while
					checkout, allocation, or dispute review is unresolved. It is
					not counted as verified help above.
				</Alert>
			)}
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			{isOwner ?
				<Alert severity='info'>
					This is your Ask. You cannot contribute to yourself.{' '}
					<Link href='/account/receiving'>
						Manage your receiving account
					</Link>
					.
				</Alert>
			:	<ContributionCheckout
					kind='ask'
					askId={askId}
					title={title}
					signedIn={signedIn}
					returnPath={`/asks/${slug}`}
					remainingAmount={remaining}
					enabled={
						funding.accepting &&
						funding.recipientReady &&
						remaining > 0
					}
					disabledReason={
						paidInFull ?
							'This goal has been reached. Thank you for the neighborhood’s support.'
						: remaining === 0 ?
							'The remaining goal is temporarily reserved. Check back when pending payments, allocations, or dispute reviews are resolved.'
						: !availability.askPayments ?
							'Payments are not enabled in this environment. No money can be collected here.'
						: !funding.recipientReady ?
							'The recipient’s receiving account needs attention before contributions can resume.'
						:	'Contributions to this Ask are currently paused.'
					}
				/>
			}
			<p className='payment-muted'>
				Only verified payments and completed community-fund allocations
				count here. Bank payouts follow Stripe’s payout schedule.
				Refunds and disputes can reduce progress.
			</p>
			{signedIn && (
				<Link
					className='text-link'
					href='/giving'>
					Your giving & receipts ↗
				</Link>
			)}
		</aside>
	);
}
