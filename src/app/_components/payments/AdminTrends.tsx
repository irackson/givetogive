'use client';

import { api } from '@/trpc/react';
import { useId } from 'react';
import { Freshness, QueryError } from './AdminPrimitives';
import { MetricCard, Money, Panel, PaymentLoading } from './PaymentPrimitives';

export function DownloadJsonButton({
	data,
	filename,
	children,
}: {
	data: unknown;
	filename: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type='button'
			className='button-link button-link--paper'
			onClick={() => {
				const url = URL.createObjectURL(
					new Blob([JSON.stringify(data, null, 2)], {
						type: 'application/json',
					}),
				);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = filename;
				anchor.click();
				window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			}}>
			{children}
		</button>
	);
}

function DailyBars({
	values,
	label,
	formatValue,
	color,
}: {
	values: Array<{ date: string; value: number }>;
	label: string;
	formatValue: (value: number) => string;
	color: string;
}) {
	const id = useId();
	const measuredMaximum = Math.max(0, ...values.map((point) => point.value));
	const maximum = Math.max(1, measuredMaximum);
	const width = 600;
	const height = 160;
	const barWidth = (width - 8) / values.length;
	return (
		<figure className='admin-trend'>
			<figcaption>{label}</figcaption>
			<div className='admin-trend__scale'>
				<span>{formatValue(measuredMaximum)}</span>
				<span>Daily · UTC</span>
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				role='img'
				aria-labelledby={id}
				preserveAspectRatio='none'>
				<title id={id}>
					{label}. {values.length} daily observations. Exact values
					are available in the data table below.
				</title>
				<line
					x1='0'
					y1={height - 1}
					x2={width}
					y2={height - 1}
					stroke='currentColor'
					strokeOpacity='.25'
				/>
				{values.map((point, index) => (
					<rect
						key={point.date}
						x={index * barWidth + 4}
						y={height - (point.value / maximum) * (height - 5)}
						width={Math.max(2, barWidth - 4)}
						height={(point.value / maximum) * (height - 5)}
						fill={color}>
						<title>
							{point.date}: {formatValue(point.value)}
						</title>
					</rect>
				))}
			</svg>
			<div className='admin-trend__scale'>
				<span>{values[0]?.date}</span>
				<span>{values.at(-1)?.date}</span>
			</div>
		</figure>
	);
}

export function AdminTrends() {
	const query = api.admin.trends.useQuery(
		{ days: 30 },
		{ refetchInterval: 30_000, refetchIntervalInBackground: false },
	);
	if (query.isPending)
		return <PaymentLoading label='Loading measured trends' />;
	if (!query.data)
		return (
			<QueryError
				message='Daily measurements are unavailable.'
				retry={() => void query.refetch()}
			/>
		);
	const data = query.data;
	const requests = data.series.reduce(
		(total, point) => total + point.requestCount,
		0,
	);
	const errors = data.series.reduce(
		(total, point) => total + point.errorCount,
		0,
	);
	const weightedLatency = data.series.reduce(
		(total, point) =>
			total + (point.meanLatencyMs ?? 0) * point.requestCount,
		0,
	);
	const totalNet = data.series.reduce(
		(total, point) => total + point.netCents,
		0,
	);
	const usd = (value: number) =>
		new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 2,
		}).format(value / 100);
	return (
		<Panel
			title='Thirty days, in context.'
			eyebrow='Measured activity · UTC'
			action={
				<Freshness
					updatedAt={query.dataUpdatedAt}
					error={query.isError}
					fetching={query.isFetching}
					intervalSeconds={30}
				/>
			}>
			{query.isError && (
				<QueryError
					message='Showing the last measured snapshot; refresh failed.'
					retry={() => void query.refetch()}
				/>
			)}
			<p className='admin-definition'>
				{data.start.toISOString()} through {data.end.toISOString()}.
				Today is partial. Refreshes every 30 seconds while this page is
				visible.
			</p>
			<div className='payment-grid'>
				<MetricCard
					label='Net gift value in period'
					value={<Money amount={totalNet} />}
					explanation='Current net value assigned to the original payment date. Not a historical cash balance.'
					tone='leaf'
				/>
				<MetricCard
					label='Checkout completion'
					value={
						data.checkoutConversion.ratio === null ?
							'No checkouts'
						:	`${(data.checkoutConversion.ratio * 100).toFixed(1)}%`
					}
					explanation={`${data.checkoutConversion.paid} confirmed paid / ${data.checkoutConversion.attempts} Checkout Sessions created in this period.`}
					tone='cobalt'
				/>
				<MetricCard
					label='Measured request latency'
					value={
						requests ?
							`${Math.round(weightedLatency / requests)} ms`
						:	'Not measured'
					}
					explanation={`Weighted mean across ${requests.toLocaleString()} recorded requests; ${errors.toLocaleString()} errors. Not a percentile or browser page-load metric.`}
					tone='saffron'
				/>
			</div>
			<div className='payment-columns'>
				<DailyBars
					values={data.series.map((point) => ({
						date: point.date,
						value: point.netCents,
					}))}
					label='Verified net giving per payment day'
					formatValue={usd}
					color='var(--leaf)'
				/>
				<DailyBars
					values={data.series.map((point) => ({
						date: point.date,
						value: point.requestCount,
					}))}
					label='Recorded requests per day'
					formatValue={(value) => value.toLocaleString()}
					color='var(--cobalt)'
				/>
			</div>
			<details className='admin-trend-details'>
				<summary>Definitions and exact daily measurements</summary>
				<p className='admin-definition'>{data.givingDefinition}</p>
				<p className='admin-definition'>{data.latencyDefinition}</p>
				<p className='admin-definition'>
					{data.checkoutConversion.definition}
				</p>
				<div className='payment-table-wrap'>
					<table className='payment-table'>
						<caption>
							Daily metrics in UTC; missing latency means no
							measured request, not zero milliseconds.
						</caption>
						<thead>
							<tr>
								<th scope='col'>Date</th>
								<th scope='col'>Gross gifts</th>
								<th scope='col'>Net gifts</th>
								<th scope='col'>Gift count</th>
								<th scope='col'>Requests</th>
								<th scope='col'>Errors</th>
								<th scope='col'>Mean ms</th>
								<th scope='col'>Max ms</th>
							</tr>
						</thead>
						<tbody>
							{data.series.map((point) => (
								<tr key={point.date}>
									<th scope='row'>{point.date}</th>
									<td>
										<Money amount={point.grossCents} />
									</td>
									<td>
										<Money amount={point.netCents} />
									</td>
									<td>{point.giftCount}</td>
									<td>{point.requestCount}</td>
									<td>{point.errorCount}</td>
									<td>
										{point.meanLatencyMs === null ?
											'Not measured'
										:	point.meanLatencyMs.toFixed(1)}
									</td>
									<td>
										{point.maxLatencyMs ?? 'Not measured'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</details>
			<DownloadJsonButton
				data={{
					...data,
					exportedAt: new Date(),
					scope: '30-day UTC measurements for the current isolated environment; no raw user data',
				}}
				filename='givetogive-measured-trends.json'>
				Export measurements & definitions
			</DownloadJsonButton>
		</Panel>
	);
}
