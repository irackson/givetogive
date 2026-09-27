import { EnableAskPaymentsButton } from '@/app/_components/payments/EnableAskPaymentsButton';
import {
	AccountNavigation,
	EmptyState,
	EnvironmentNote,
	Money,
	Panel,
	PaymentPage,
	StatusPill,
} from '@/app/_components/payments/PaymentPrimitives';
import { RecipientComponents } from '@/app/_components/payments/RecipientComponents';
import { api } from '@/trpc/server';
import { auth } from '@/server/auth';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Receiving help | GiveToGive' };

export default async function ReceivingPage() {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/account/receiving');
	const [availability, recipient] = await Promise.all([
		api.billing.availability(),
		api.billing.myRecipient(),
	]);
	const ready = recipient.transfersActive && recipient.payoutsActive;
	return (
		<PaymentPage
			eyebrow='Your receiving account'
			title='Make room for a little help.'
			description='Set up secure payouts, keep your account details current, and choose which eligible money Asks can receive verified payments.'>
			<AccountNavigation current='receiving' />
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			<div className='payment-note'>
				Receiving a contribution is different from receiving a bank
				payout. Successful gifts transfer to your Stripe account; bank
				deposits follow Stripe’s availability and payout schedule.
			</div>
			<Panel
				title='Your receiving account.'
				action={
					<StatusPill
						status={
							ready ? 'ready'
							: recipient.recipientRequested ?
								'incomplete'
							:	'not_started'
						}
					/>
				}>
				{recipient.requirements.length > 0 && (
					<div className='payment-note payment-note--warning'>
						<strong>Your account needs attention.</strong>
						<p>
							Review the secure Stripe form below for the current
							verification requirements.
						</p>
					</div>
				)}
				<RecipientComponents
					enabled={availability.askPayments || availability.funds}
					initiallyReady={ready}
				/>
			</Panel>
			<Panel
				title='Your money Asks.'
				eyebrow='Choose where help can arrive'>
				{recipient.asks.length ?
					<div className='payment-table-wrap'>
						<table className='payment-table'>
							<caption className='sr-only'>
								Your money Asks and payment enrollment
							</caption>
							<thead>
								<tr>
									<th scope='col'>Ask</th>
									<th scope='col'>Goal</th>
									<th scope='col'>Payments</th>
								</tr>
							</thead>
							<tbody>
								{recipient.asks.map((ask) => (
									<tr key={ask.id}>
										<td>
											<Link href={`/asks/${ask.slug}`}>
												{ask.title}
											</Link>
										</td>
										<td>
											<Money amount={ask.goalAmount} />
										</td>
										<td>
											{ask.enabled ?
												<StatusPill status='enabled' />
											:	<EnableAskPaymentsButton
													askId={ask.id}
													title={ask.title}
													disabled={
														!ready ||
														!availability.askPayments
													}
												/>
											}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				:	<EmptyState
						title='No money Asks yet.'
						href='/asks?type=money'
						action='Visit the community board'>
						Create a money Ask when you need help. Once your
						receiving account is ready, eligible Asks can accept
						verified contributions.
					</EmptyState>
				}
				<p className='payment-muted'>
					Existing pledges remain off-platform. Enrollment is
					available only for eligible Asks without legacy
					contributions.
				</p>
			</Panel>
		</PaymentPage>
	);
}
