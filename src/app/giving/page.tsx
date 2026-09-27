import {
	AccountNavigation,
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
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Your giving | GiveToGive' };

export default async function GivingPage({
	searchParams,
}: {
	searchParams: Promise<{ cursor?: string; checkout?: string }>;
}) {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/giving');
	const query = await searchParams;
	const [availability, overview, history] = await Promise.all([
		api.billing.availability(),
		api.billing.myOverview(),
		api.billing.myPayments({
			...(query.cursor ? { cursor: query.cursor } : {}),
			limit: 20,
		}),
	]);
	return (
		<PaymentPage
			eyebrow='Your part in the neighborhood'
			title='Good things, on record.'
			description='Follow your contributions from a small intention to confirmed help. These records are private to your account.'>
			<AccountNavigation current='giving' />
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			{query.checkout && (
				<p className='payment-note'>
					Returned from Checkout? Your record updates when Stripe
					confirms the payment. A return to this page is not proof of
					payment; a pending payment can take a little longer.
				</p>
			)}
			<div className='payment-grid'>
				<MetricCard
					label='Verified help shared'
					value={<Money amount={overview.paidGiving} />}
					explanation='Net amounts for Asks and funds, after recorded refunds and disputes. Membership payments are separate.'
					tone='leaf'
				/>
				<MetricCard
					label='Pending help'
					value={<Money amount={overview.pendingGiving} />}
					explanation='Net amounts reserved or awaiting confirmation. Not included in verified giving.'
					tone='saffron'
				/>
				<MetricCard
					label='Contributions that count'
					value={overview.completedContributions}
					explanation='Ask and fund payments with a positive verified recipient amount.'
					tone='cobalt'
				/>
			</div>
			<Panel
				title='Every contribution has a story.'
				eyebrow='Payment history'
				action={
					<Link
						className='text-link'
						href='/account/billing'>
						Manage recurring support ↗
					</Link>
				}>
				{history.items.length === 0 ?
					<EmptyState
						title={
							query.cursor ?
								'No more payments here.'
							:	'Your first gift starts with a neighbor.'
						}
						href={query.cursor ? '/giving' : '/asks?type=money'}
						action={
							query.cursor ?
								'Return to recent payments'
							:	'Explore money Asks'
						}>
						Confirmed payments, pending checkouts, membership
						charges, and refunds will appear here. Your older
						off-platform pledges remain in your member profile.
					</EmptyState>
				:	<div className='payment-table-wrap'>
						<table className='payment-table'>
							<caption className='sr-only'>
								Your payments, most recent first
							</caption>
							<thead>
								<tr>
									<th scope='col'>Destination</th>
									<th scope='col'>Date</th>
									<th scope='col'>Total</th>
									<th scope='col'>Status</th>
									<th scope='col'>Record</th>
								</tr>
							</thead>
							<tbody>
								{history.items.map((payment) => (
									<tr key={payment.id}>
										<td>
											<strong>
												{payment.askTitle ??
													payment.fundName ??
													`${payment.tier === 'sustainer' ? 'Sustainer' : 'Supporter'} membership`}
											</strong>
											<small>
												{payment.kind === 'ask' ?
													'Individual Ask'
												: payment.kind === 'fund' ?
													'Community fund'
												:	'GiveToGive operations'}
												{payment.recurring ?
													' · Recurring'
												:	''}
											</small>
										</td>
										<td>
											<DateLabel
												value={payment.createdAt}
											/>
										</td>
										<td>
											<Money
												amount={payment.grossAmount}
												currency={payment.currency}
											/>
											{payment.refundedAmount > 0 && (
												<small>
													<Money
														amount={
															payment.refundedAmount
														}
														currency={
															payment.currency
														}
													/>{' '}
													refunded
												</small>
											)}
										</td>
										<td>
											<StatusPill
												status={payment.status}
											/>
										</td>
										<td>
											<Link
												href={`/giving/${payment.id}`}>
												View details ↗
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				}
			</Panel>
			{(query.cursor || history.nextCursor) && (
				<nav
					className='payment-pagination'
					aria-label='Giving history pages'>
					{query.cursor && (
						<Link
							className='text-link'
							href='/giving'>
							Most recent
						</Link>
					)}
					{history.nextCursor && (
						<Link
							className='button-link button-link--paper'
							href={`/giving?cursor=${encodeURIComponent(history.nextCursor)}`}>
							Older payments →
						</Link>
					)}
				</nav>
			)}
			<p className='payment-muted'>
				Looking for time, items, or an older off-platform pledge?{' '}
				<Link
					className='text-link'
					href='/members'>
					Your member profile has the rest of your contribution
					history.
				</Link>
			</p>
		</PaymentPage>
	);
}
