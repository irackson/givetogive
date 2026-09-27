import { ContributionCheckout } from '@/app/_components/payments/ContributionCheckout';
import {
	DateLabel,
	EmptyState,
	EnvironmentNote,
	MetricCard,
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
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Community fund | GiveToGive' };

export default async function FundPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const [fund, availability, session] = await Promise.all([
		api.billing.fund({ slug }).catch((error: unknown) => {
			if (error instanceof TRPCError && error.code === 'NOT_FOUND')
				notFound();
			throw error;
		}),
		api.billing.availability(),
		auth(),
	]);
	return (
		<PaymentPage
			eyebrow='A community fund'
			title={fund.name}
			description={fund.description}
			tone='coral'>
			<Link
				href='/funds'
				className='text-link'>
				← All community funds
			</Link>
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			<div className='payment-grid'>
				<MetricCard
					label='Verified received'
					value={<Money amount={fund.totalReceived} />}
					explanation='Net confirmed gifts, adjusted for recorded refunds and disputes.'
					tone='leaf'
				/>
				<MetricCard
					label='Available to allocate'
					value={<Money amount={fund.availableAmount} />}
					explanation='Verified funds available at Stripe, less allocations and reservations.'
					tone='saffron'
				/>
				<MetricCard
					label='Help allocated'
					value={<Money amount={fund.totalAllocated} />}
					explanation='Completed allocations to eligible money Asks. No second platform fee.'
					tone='cobalt'
				/>
			</div>
			<div className='payment-columns'>
				<div className='payment-stack'>
					<Panel
						title='Shared help, an open record.'
						eyebrow='Allocation history'>
						{fund.allocations.length ?
							<ol className='payment-list'>
								{fund.allocations.map((allocation) => (
									<li key={allocation.id}>
										<div className='payment-row'>
											<Link
												className='text-link'
												href={`/asks/${allocation.askSlug}`}>
												{allocation.askTitle}
											</Link>
											<strong>
												<Money
													amount={allocation.amount}
												/>
											</strong>
										</div>
										<p className='payment-muted'>
											{allocation.reason}
										</p>
										<div className='payment-row'>
											<DateLabel
												value={allocation.createdAt}
											/>
											<StatusPill
												status={allocation.status}
											/>
										</div>
									</li>
								))}
							</ol>
						:	<EmptyState title='The first allocation is ahead.'>
								No allocations have been recorded. When funds
								are assigned to an Ask, the amount and reason
								will appear here.
							</EmptyState>
						}
					</Panel>
					<p className='payment-note'>
						Administrators choose eligible Asks and record their
						reasoning. A contribution to this fund does not reserve
						money for a particular person, confer voting rights, or
						guarantee any individual award. Gifts are not
						represented as tax-deductible.
					</p>
					{fund.pendingAllocation > 0 && (
						<p className='payment-muted'>
							<Money amount={fund.pendingAllocation} /> is
							currently reserved for allocations awaiting
							completion or recovery.
						</p>
					)}
				</div>
				<Panel title='Add your little bit.'>
					<ContributionCheckout
						kind='fund'
						fundId={fund.id}
						title={fund.name}
						enabled={availability.funds && fund.active}
						signedIn={!!session?.user.id}
						returnPath={`/funds/${fund.slug}`}
						disabledReason={
							fund.active ?
								'Fund payments are not enabled in this environment yet.'
							:	'This fund is closed to new contributions.'
						}
					/>
				</Panel>
			</div>
		</PaymentPage>
	);
}
