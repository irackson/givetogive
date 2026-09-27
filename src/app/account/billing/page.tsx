import {
	BillingPortalButton,
	FundCancellationButton,
} from '@/app/_components/payments/PaymentActions';
import { SupporterChanges } from '@/app/_components/payments/SupporterChanges';
import {
	AccountNavigation,
	DateLabel,
	EmptyState,
	EnvironmentNote,
	Panel,
	PaymentPage,
	StatusPill,
} from '@/app/_components/payments/PaymentPrimitives';
import { api } from '@/trpc/server';
import { getBillingAuthSession } from '@/server/auth';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
	title: 'Membership & billing | GiveToGive',
};

export default async function BillingPage() {
	const session = await getBillingAuthSession();
	if (!session?.user?.id) redirect('/signin?callbackUrl=/account/billing');
	const billingOnly = session.access === 'billing_only';
	const [availability, overview] = await Promise.all([
		api.billing.availability(),
		api.billing.myOverview(),
	]);
	return (
		<PaymentPage
			eyebrow='Your account'
			title='Support, on your terms.'
			description={
				billingOnly ?
					'Review your own billing records and stop renewal without reopening community access.'
				:	'Manage your optional membership, recurring fund gifts, and payment details in one place.'
			}
			tone='cobalt'>
			{billingOnly ?
				<div
					className='payment-note'
					role='status'>
					<strong>Restricted billing access</strong>
					<p>
						Your account is frozen. This sign-in only lets you
						review your own recurring billing records, cancel
						renewal, or undo an unpaid upgrade. Community,
						account-management and administrator access remain
						unavailable.
					</p>
					<Link
						className='text-link'
						href='/signout'>
						Sign out of restricted access ↗
					</Link>
				</div>
			:	<AccountNavigation current='billing' />}
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			<div className='payment-columns'>
				<Panel title='Your place in the neighborhood.'>
					<p className='eyebrow'>Current paid recognition</p>
					<p
						className='support-card__price'
						style={{ fontSize: 44, textTransform: 'capitalize' }}>
						{overview.recognitionStatus === 'pending' ?
							'Reconciliation pending'
						: overview.tier === 'neighbor' ?
							'Neighbor'
						:	overview.tier}
					</p>
					{overview.recognitionStatus === 'pending' && (
						<p
							className='payment-note'
							role='status'>
							We’re verifying your paid coverage and its effective
							time. This is not a membership downgrade.{' '}
							{billingOnly ?
								'Community access remains restricted.'
							:	'Your free community features remain available.'}
						</p>
					)}
					{!billingOnly && (
						<p className='payment-muted'>
							Every member has the same essential ability to ask
							for help and give it. Paid support does not change
							placement or priority.
						</p>
					)}
					{!billingOnly && (
						<div className='payment-actions'>
							<Link
								className='button-link button-link--paper'
								href='/support'>
								Compare memberships
							</Link>
							{overview.subscriptions.length > 0 && (
								<BillingPortalButton
									disabled={!availability.billingManagement}
								/>
							)}
						</div>
					)}
				</Panel>
				<Panel title='You’re in control.'>
					{billingOnly ?
						<ul className='payment-list'>
							<li>
								Review only your own membership and change
								history.
							</li>
							<li>Cancel renewal at the existing period end.</li>
							<li>
								Cancel an unpaid upgrade without creating
								another charge.
							</li>
							<li>
								This sign-in does not unfreeze your account.
							</li>
						</ul>
					:	<ul className='payment-list'>
							<li>
								Update payment details securely with Stripe.
							</li>
							<li>
								Cancel or downgrade for the end of the current
								paid period.
							</li>
							<li>
								Upgrades start after their prorated payment
								succeeds.
							</li>
							<li>
								A failed renewal does not remove any free
								community features.
							</li>
						</ul>
					}
				</Panel>
			</div>
			<SupporterChanges
				enabled={availability.subscriptions}
				managementEnabled={availability.billingManagement}
				initialSubscriptions={overview.subscriptions}
				billingOnly={billingOnly}
			/>
			<Panel
				title='Recurring commitments.'
				eyebrow='Memberships & fund gifts'>
				{overview.subscriptions.length ?
					<div className='payment-table-wrap'>
						<table className='payment-table'>
							<caption className='sr-only'>
								Your recurring memberships and community fund
								gifts
							</caption>
							<thead>
								<tr>
									<th scope='col'>Purpose</th>
									<th scope='col'>Status</th>
									<th scope='col'>Verified paid coverage</th>
									<th scope='col'>Renewal</th>
									<th scope='col'>Manage</th>
								</tr>
							</thead>
							<tbody>
								{overview.subscriptions.map((subscription) => (
									<tr key={subscription.id}>
										<td>
											<strong>
												{subscription.kind === 'fund' ?
													(subscription.fundName ??
													'Community fund')
												:	'Supporter membership'}
											</strong>
											<small>
												{subscription.kind === 'fund' ?
													'Shared aid, separate from membership'
												:	`Billing tier: ${subscription.billingTier ?? 'awaiting reconciliation'}`
												}
											</small>
										</td>
										<td>
											<StatusPill
												status={subscription.status}
											/>
										</td>
										<td>
											{(
												subscription.kind ===
													'supporter' &&
												subscription.recognitionStatus ===
													'pending'
											) ?
												'Reconciliation pending'
											: subscription.paidThrough ?
												<>
													<DateLabel
														value={
															subscription.paidThrough
														}
													/>
													{subscription.tier && (
														<small>
															{subscription.tier}{' '}
															recognition
														</small>
													)}
												</>
											:	'No current verified coverage'}
										</td>
										<td>
											{subscription.cancelAtPeriodEnd ?
												'Cancels at period end'
											: (
												[
													'canceled',
													'incomplete_expired',
												].includes(subscription.status)
											) ?
												'Ended'
											: subscription.pendingChangeId ?
												'Change pending; review above'
											:	'Continues unless canceled'}
										</td>
										<td>
											{(
												subscription.kind === 'fund' &&
												!subscription.cancelAtPeriodEnd &&
												![
													'canceled',
													'incomplete_expired',
												].includes(subscription.status)
											) ?
												<FundCancellationButton
													subscriptionId={
														subscription.id
													}
													fundName={
														subscription.fundName ??
														'Community fund'
													}
													disabled={
														!availability.fundCancellation
													}
												/>
											: (
												subscription.kind ===
												'supporter'
											) ?
												'Manage above'
											:	'No renewal to cancel'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				: billingOnly ?
					<EmptyState title='No recurring commitments.'>
						There are no recurring billing records for this account.
					</EmptyState>
				:	<EmptyState
						title='No recurring commitments.'
						href='/support'
						action='Meet the supporter tiers'>
						You can participate freely. If you choose to support
						GiveToGive or a fund monthly, it will appear here.
					</EmptyState>
				}
			</Panel>
			{!billingOnly && (
				<Link
					className='text-link'
					href='/giving'>
					View payments and receipts ↗
				</Link>
			)}
		</PaymentPage>
	);
}
