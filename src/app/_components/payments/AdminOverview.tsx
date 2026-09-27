'use client';
import { api } from '@/trpc/react';
import Link from 'next/link';
import { ActivityTimeline, Freshness, QueryError } from './AdminPrimitives';
import { AdminTrends } from './AdminTrends';
import {
	EnvironmentNote,
	MetricCard,
	Money,
	Panel,
	PaymentLoading,
} from './PaymentPrimitives';

export function AdminOverview() {
	const overview = api.admin.overview.useQuery(undefined, {
		refetchInterval: 2000,
		refetchIntervalInBackground: false,
	});
	const activity = api.admin.activity.useQuery(
		{ limit: 8 },
		{ refetchInterval: 2000, refetchIntervalInBackground: false },
	);
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>
					The neighborhood, at a glance.
				</h2>
				<Freshness
					updatedAt={overview.dataUpdatedAt}
					error={overview.isError}
					fetching={overview.isFetching}
				/>
			</div>
			{overview.error && (
				<QueryError
					message='Overview data is unavailable or stale.'
					retry={() => void overview.refetch()}
				/>
			)}
			{overview.isPending ?
				<PaymentLoading />
			:	overview.data && (
					<>
						<EnvironmentNote
							environment={overview.data.environment}
							livemode={
								overview.data.environment === 'production'
							}
						/>
						<p className='admin-definition'>
							All-time records from this isolated environment;
							subscriptions reflect current paid-through status.
							Definitions accompany each measurement. Synthetic
							and production populations are never combined.
						</p>
						<div className='payment-grid'>
							{overview.data.metrics
								.filter((metric) =>
									[
										'unresolved',
										'net_giving',
										'supporter_mrr',
									].includes(metric.key),
								)
								.map((metric) => (
									<MetricCard
										key={metric.key}
										label={metric.label}
										value={
											metric.unit === 'cents' ?
												<Money amount={metric.value} />
											:	metric.value
										}
										explanation={metric.definition}
										tone={
											metric.key === 'unresolved' ?
												'saffron'
											: metric.key === 'net_giving' ?
												'leaf'
											:	'cobalt'
										}
									/>
								))}
						</div>
						<div className='payment-actions'>
							<Link
								className='button-link button-link--paper'
								href='/admin/payments'>
								Review payment operations ↗
							</Link>
							<Link
								className='button-link button-link--paper'
								href='/admin/simulations'>
								Open simulation room ↗
							</Link>
						</div>
						<Panel title='Participation & giving'>
							<div className='payment-table-wrap'>
								<table className='payment-table'>
									<caption className='sr-only'>
										Community and payment measurements, with
										definitions
									</caption>
									<thead>
										<tr>
											<th scope='col'>Measurement</th>
											<th scope='col'>Value</th>
											<th scope='col'>What it counts</th>
										</tr>
									</thead>
									<tbody>
										{overview.data.metrics
											.filter(
												(metric) =>
													![
														'unresolved',
														'net_giving',
														'supporter_mrr',
													].includes(metric.key),
											)
											.map((metric) => (
												<tr key={metric.key}>
													<td>
														<strong>
															{metric.label}
														</strong>
													</td>
													<td>
														{(
															metric.unit ===
															'cents'
														) ?
															<Money
																amount={
																	metric.value
																}
															/>
														:	metric.value.toLocaleString()
														}
													</td>
													<td className='admin-definition'>
														{metric.definition}
													</td>
												</tr>
											))}
									</tbody>
								</table>
							</div>
						</Panel>
					</>
				)
			}
			<AdminTrends />
			<Panel
				title='Recent activity'
				action={
					<Link
						className='text-link'
						href='/admin/activity'>
						Explore all activity ↗
					</Link>
				}>
				{activity.error && (
					<QueryError
						message='Recent activity could not refresh.'
						retry={() => void activity.refetch()}
					/>
				)}
				{activity.isPending ?
					<PaymentLoading />
				:	activity.data && (
						<ActivityTimeline items={activity.data.items} />
					)
				}
			</Panel>
		</>
	);
}
