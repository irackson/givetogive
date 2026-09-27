'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	Checkbox,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	FormControlLabel,
	TextField,
} from '@mui/material';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Money } from './PaymentPrimitives';

export function ContributionCheckout({
	kind,
	askId,
	fundId,
	title,
	enabled,
	signedIn,
	returnPath,
	disabledReason,
	remainingAmount,
}: {
	kind: 'ask' | 'fund';
	askId?: number;
	fundId?: string;
	title: string;
	enabled: boolean;
	signedIn: boolean;
	returnPath: string;
	disabledReason?: string;
	remainingAmount?: number;
}) {
	const [amount, setAmount] = useState('25');
	const [recurring, setRecurring] = useState(false);
	const [reviewOpen, setReviewOpen] = useState(false);
	const [redirecting, setRedirecting] = useState(false);
	const operationId = useRef<string | null>(null);
	const grossAmount =
		/^\d+(\.\d{0,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
	const validAmount = grossAmount >= 100 && grossAmount <= 1000000;
	const quote = api.billing.quote.useQuery(
		{ grossAmount },
		{ enabled: validAmount && enabled, retry: false },
	);
	const checkout = api.billing.createCheckout.useMutation({
		onSuccess: ({ url }) => {
			setRedirecting(true);
			window.location.assign(url);
		},
	});
	const overGoal =
		remainingAmount !== undefined &&
		quote.data !== undefined &&
		quote.data.recipientAmount > remainingAmount;
	const canSubmit =
		enabled &&
		validAmount &&
		quote.isSuccess &&
		!overGoal &&
		!checkout.isPending &&
		!redirecting;
	const updateAmount = (value: string) => {
		setAmount(value);
		operationId.current = null;
		checkout.reset();
	};
	return (
		<div className='payment-form'>
			{!enabled && (
				<Alert severity='info'>
					{disabledReason ??
						'This payment experience is not available yet. No money can be collected here.'}
				</Alert>
			)}
			<TextField
				label='Your total contribution (USD)'
				value={amount}
				onChange={(event) => updateAmount(event.target.value)}
				inputProps={{
					inputMode: 'decimal',
					min: '1',
					max: '10000',
					step: '.01',
				}}
				helperText={
					amount && !validAmount ?
						'Enter an amount from $1 to $10,000, with up to two decimal places.'
					:	'This is the total charged, including the deductions shown below.'
				}
				error={!!amount && !validAmount}
				disabled={!enabled}
				fullWidth
			/>
			<div
				className='payment-checkout-choice'
				aria-label='Suggested contribution amounts'>
				{[10, 25, 50, 100].map((value) => (
					<button
						key={value}
						type='button'
						disabled={!enabled}
						aria-pressed={Number(amount) === value}
						onClick={() => updateAmount(String(value))}>
						${value}
					</button>
				))}
			</div>
			{kind === 'fund' && (
				<FormControlLabel
					control={
						<Checkbox
							checked={recurring}
							disabled={!enabled}
							onChange={(event) => {
								setRecurring(event.target.checked);
								operationId.current = null;
							}}
						/>
					}
					label='Give this amount every month'
				/>
			)}
			{quote.isError && (
				<Alert severity='error'>
					We could not calculate your quote. Please try another amount
					or refresh.
				</Alert>
			)}
			{quote.data && validAmount && (
				<dl
					className='payment-details'
					aria-label='Contribution breakdown'>
					<div>
						<dt>Your total{recurring ? ' each month' : ''}</dt>
						<dd>
							<Money amount={quote.data.grossAmount} />
						</dd>
					</div>
					<div>
						<dt>GiveToGive fee (5%)</dt>
						<dd>
							<Money amount={quote.data.platformFee} />
						</dd>
					</div>
					<div>
						<dt>Processing deduction (estimate)</dt>
						<dd>
							<Money amount={quote.data.processingEstimate} />
						</dd>
					</div>
					<div className='payment-details__total'>
						<dt>
							{kind === 'fund' ?
								'To this fund'
							:	'To this neighbor'}
						</dt>
						<dd>
							<Money amount={quote.data.recipientAmount} />
						</dd>
					</div>
				</dl>
			)}
			{overGoal && (
				<Alert severity='warning'>
					The net amount exceeds what this Ask still needs. Choose a
					smaller contribution.
				</Alert>
			)}
			<p className='payment-muted'>
				GiveToGive settles any difference between the processing
				estimate and actual cost.{' '}
				{kind === 'fund' ?
					'The fund is not charged again when help is allocated.'
				:	'Your contribution does not wait for the goal to be reached.'
				}{' '}
				Gifts are not represented as tax-deductible.
			</p>
			{signedIn ?
				<Button
					variant='contained'
					disabled={!canSubmit}
					onClick={() => setReviewOpen(true)}>
					Review {recurring ? 'monthly gift' : 'contribution'}
				</Button>
			:	<Button
					component={Link}
					href={`/signin?callbackUrl=${encodeURIComponent(returnPath)}`}
					variant='contained'>
					Sign in to contribute
				</Button>
			}
			<Dialog
				open={reviewOpen}
				onClose={() => {
					if (!checkout.isPending) setReviewOpen(false);
				}}
				fullWidth
				maxWidth='sm'
				aria-labelledby='contribution-checkout-title'>
				<DialogTitle id='contribution-checkout-title'>
					A little help, clearly accounted for.
				</DialogTitle>
				<DialogContent>
					<div className='payment-stack'>
						<p>
							You are giving to <strong>{title}</strong>
							{recurring ? ' every month until you cancel' : ''}.
						</p>
						{quote.data && (
							<dl className='payment-details'>
								<div>
									<dt>
										Total charged
										{recurring ? ' monthly' : ''}
									</dt>
									<dd>
										<Money
											amount={quote.data.grossAmount}
										/>
									</dd>
								</div>
								<div>
									<dt>Platform fee</dt>
									<dd>
										<Money
											amount={quote.data.platformFee}
										/>
									</dd>
								</div>
								<div>
									<dt>Processing deduction</dt>
									<dd>
										<Money
											amount={
												quote.data.processingEstimate
											}
										/>
									</dd>
								</div>
								<div className='payment-details__total'>
									<dt>Recipient amount</dt>
									<dd>
										<Money
											amount={quote.data.recipientAmount}
										/>
									</dd>
								</div>
							</dl>
						)}
						<p className='payment-muted'>
							You will enter payment details securely with Stripe.
							Your giving history will update after Stripe
							confirms the payment.
							{recurring ?
								' Manage or cancel future payments in your billing account.'
							:	''}
						</p>
						{checkout.error && (
							<Alert severity='error'>
								{checkout.error.message}
							</Alert>
						)}
					</div>
				</DialogContent>
				<DialogActions>
					<Button
						disabled={checkout.isPending || redirecting}
						onClick={() => setReviewOpen(false)}>
						Back
					</Button>
					<Button
						variant='contained'
						disabled={!canSubmit}
						onClick={() => {
							if (!quote.data) return;
							operationId.current ??= crypto.randomUUID();
							checkout.mutate({
								operationId: operationId.current,
								kind,
								...(askId !== undefined ? { askId } : {}),
								...(fundId ? { fundId } : {}),
								grossAmount,
								quoteVersion: quote.data.version,
								recurring: kind === 'fund' && recurring,
							});
						}}>
						{checkout.isPending || redirecting ?
							'Opening secure checkout…'
						:	'Continue to secure checkout'}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}
