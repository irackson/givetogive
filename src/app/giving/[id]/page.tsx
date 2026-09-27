import { PrintReceiptButton } from '@/app/_components/payments/PaymentActions';
import { PaymentStatusActions } from '@/app/_components/payments/PaymentStatusActions';
import {
	DateLabel,
	EnvironmentNote,
	Money,
	Panel,
	PaymentPage,
	StatusPill,
} from '@/app/_components/payments/PaymentPrimitives';
import { auth } from '@/server/auth';
import { api } from '@/trpc/server';
import { TRPCError } from '@trpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Contribution record | GiveToGive' };

export default async function PaymentRecordPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/giving');
	const { id } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
	const [payment, availability] = await Promise.all([
		api.billing.payment({ id }).catch((error: unknown) => {
			if (error instanceof TRPCError && error.code === 'NOT_FOUND')
				notFound();
			throw error;
		}),
		api.billing.availability(),
	]);
	const title =
		payment.askTitle ??
		payment.fundName ??
		`${payment.tier === 'sustainer' ? 'Sustainer' : 'Supporter'} membership`;
	const verified = [
		'succeeded',
		'partially_refunded',
		'refunded',
		'disputed',
	].includes(payment.status);
	return (
		<PaymentPage
			eyebrow={
				verified ? 'Your contribution record' : 'Payment in progress'
			}
			title={
				verified ?
					'A clear little paper trail.'
				:	'Not confirmed just yet.'
			}
			description={`Your payment record for ${title}.`}>
			<div className='payment-row'>
				<Link
					className='text-link'
					href='/giving'>
					← All your giving
				</Link>
				<PrintReceiptButton />
			</div>
			<EnvironmentNote
				environment={availability.environment}
				livemode={payment.livemode}
			/>
			<PaymentStatusActions
				id={payment.id}
				pending={['reserved', 'checkout_open', 'pending'].includes(
					payment.status,
				)}
				cancellable={payment.status === 'checkout_open'}
			/>
			<div className='payment-columns'>
				<Panel title={title}>
					<div className='payment-row'>
						<StatusPill status={payment.status} />
						<DateLabel value={payment.createdAt} />
					</div>
					<dl className='payment-details'>
						<div className='payment-details__total'>
							<dt>Total payment</dt>
							<dd>
								<Money
									amount={payment.grossAmount}
									currency={payment.currency}
								/>
							</dd>
						</div>
						{payment.kind !== 'supporter' && (
							<>
								<div>
									<dt>GiveToGive fee (5%)</dt>
									<dd>
										<Money amount={payment.platformFee} />
									</dd>
								</div>
								<div>
									<dt>Processing deduction (quoted)</dt>
									<dd>
										<Money
											amount={payment.processingEstimate}
										/>
									</dd>
								</div>
								<div>
									<dt>
										To{' '}
										{payment.kind === 'fund' ?
											'the fund'
										:	'the neighbor'}
									</dt>
									<dd>
										<Money
											amount={payment.recipientAmount}
										/>
									</dd>
								</div>
							</>
						)}
						{payment.refundedAmount > 0 && (
							<div>
								<dt>Refunded to you</dt>
								<dd>
									<Money amount={payment.refundedAmount} />
								</dd>
							</div>
						)}
						{payment.disputedAmount > 0 && (
							<div>
								<dt>Amount under dispute</dt>
								<dd>
									<Money amount={payment.disputedAmount} />
								</dd>
							</div>
						)}
						<div>
							<dt>Payment confirmed</dt>
							<dd>
								<DateLabel value={payment.paidAt} />
							</dd>
						</div>
					</dl>
					<p className='payment-receipt-id'>Record {payment.id}</p>
					<div className='payment-actions'>
						{payment.askSlug && (
							<Link
								className='text-link'
								href={`/asks/${payment.askSlug}`}>
								View the Ask ↗
							</Link>
						)}
						{payment.fundSlug && (
							<Link
								className='text-link'
								href={`/funds/${payment.fundSlug}`}>
								View the fund ↗
							</Link>
						)}
						{payment.receiptUrl && (
							<a
								className='text-link'
								href={payment.receiptUrl}
								target='_blank'
								rel='noopener noreferrer'>
								Stripe receipt ↗
							</a>
						)}
					</div>
				</Panel>
				<div className='payment-stack'>
					<Panel title='What this record means.'>
						<p className='payment-muted'>
							{verified ?
								'This record reflects payment information confirmed by Stripe. Refunds and disputes remain visible instead of erasing the original contribution.'
							:	'A payment attempt is not a completed gift. Do not submit another payment just because confirmation is delayed. Your giving history will show the confirmed outcome.'
							}
						</p>
						<p className='payment-muted'>
							{payment.kind === 'supporter' ?
								'This membership supports GiveToGive operations, not a specific Ask or community fund.'
							:	'The quoted processing deduction does not change after payment. GiveToGive settles any difference from actual processing costs.'
							}
						</p>
						<p className='payment-muted'>
							This is a payment record, not a tax-deductible
							charitable donation certificate.
						</p>
					</Panel>
					{payment.operations.length > 0 && (
						<Panel title='Refunds & follow-up'>
							<ul className='payment-list'>
								{payment.operations.map((operation) => (
									<li key={operation.id}>
										<div className='payment-row'>
											<strong>
												{operation.kind.replaceAll(
													'_',
													' ',
												)}
											</strong>
											<Money amount={operation.amount} />
										</div>
										<div className='payment-row'>
											<DateLabel
												value={operation.createdAt}
											/>
											<StatusPill
												status={operation.status}
											/>
										</div>
									</li>
								))}
							</ul>
						</Panel>
					)}
				</div>
			</div>
		</PaymentPage>
	);
}
