'use client';

import { Alert, Button } from '@mui/material';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { entityHref } from '@/lib/simulation-presentation';
import { EmptyState, StatusPill } from './PaymentPrimitives';

export type ActivityItem = {
	id: number;
	actorId: string | null;
	entityType: string;
	entityId: string | null;
	action: string;
	outcome: string;
	correlationId: string | null;
	runId: string | null;
	summary: string | null;
	occurredAt: Date | string;
	details: Record<string, unknown>;
};

export function ActivityTimeline({
	items,
	emptyTitle = 'No activity in this view.',
}: {
	items: ActivityItem[];
	emptyTitle?: string;
}) {
	if (!items.length)
		return (
			<EmptyState title={emptyTitle}>
				Actions will appear here when they are recorded. Nothing has
				been inferred or filled in.
			</EmptyState>
		);
	return (
		<ol className='admin-event-list'>
			{items.map((item) => {
				const href = entityHref(
					item.entityType,
					item.entityId,
					item.runId,
				);
				return (
					<li
						key={item.id}
						className='admin-event'>
						<span
							className='admin-event__mark'
							aria-hidden='true'>
							{(
								item.outcome === 'failed' ||
								item.outcome === 'error'
							) ?
								'!'
							:	'↗'}
						</span>
						<div className='admin-event__copy'>
							<p>
								{item.actorId ?
									<Link
										className='text-link'
										href={`/admin/users/${encodeURIComponent(item.actorId)}`}>
										Member
									</Link>
								:	<strong>System</strong>}
								{' · '}
								<strong>
									{item.action
										.replaceAll('_', ' ')
										.replaceAll('.', ' / ')}
								</strong>{' '}
								<StatusPill status={item.outcome} />
							</p>
							{item.summary && <p>{item.summary}</p>}
							<div className='payment-actions'>
								{href && (
									<Link
										className='text-link'
										href={href}>
										Inspect{' '}
										{item.entityType.replaceAll('_', ' ')} ↗
									</Link>
								)}
								{item.runId && (
									<Link
										className='text-link'
										href={`/admin/simulations/${encodeURIComponent(item.runId)}`}>
										Simulation run ↗
									</Link>
								)}
							</div>
							<small>
								Event #{item.id}
								{item.correlationId ?
									` · Correlation ${item.correlationId}`
								:	''}
							</small>
							{Object.keys(item.details).length > 0 && (
								<details>
									<summary className='payment-muted'>
										Recorded details
									</summary>
									<pre>
										{JSON.stringify(item.details, null, 2)}
									</pre>
								</details>
							)}
						</div>
						<time
							className='admin-event__time'
							dateTime={new Date(item.occurredAt).toISOString()}>
							{new Intl.DateTimeFormat('en-US', {
								month: 'short',
								day: 'numeric',
								hour: 'numeric',
								minute: '2-digit',
								second: '2-digit',
								timeZone: 'UTC',
							}).format(new Date(item.occurredAt))}{' '}
							UTC
						</time>
					</li>
				);
			})}
		</ol>
	);
}

export function QueryError({
	message,
	retry,
}: {
	message: string;
	retry: () => void;
}) {
	return (
		<Alert
			severity='error'
			action={
				<Button
					color='inherit'
					size='small'
					onClick={retry}>
					Retry
				</Button>
			}>
			{message}
		</Alert>
	);
}

export function Freshness({
	updatedAt,
	error = false,
	fetching = false,
	live = true,
	intervalSeconds = 2,
}: {
	updatedAt: number;
	error?: boolean;
	fetching?: boolean;
	live?: boolean;
	intervalSeconds?: number;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const age =
		updatedAt ? Math.max(0, Math.floor((now - updatedAt) / 1000)) : null;
	const stale =
		error ||
		(live && age !== null && age > Math.max(15, intervalSeconds * 2));
	return (
		<span
			className={`admin-live-indicator${stale ? 'admin-live-indicator--stale' : ''}`}
			role='status'>
			{error ?
				'Refresh failed · showing last received data'
			: !updatedAt ?
				'Connecting…'
			: fetching ?
				'Refreshing…'
			: stale ?
				`Last received ${age}s ago`
			: live ?
				`Updated ${age}s ago · refreshes every ${intervalSeconds}s`
			:	'Historical snapshot · live updates paused'}
		</span>
	);
}

export function NumericMetric({
	values,
	name,
	suffix = '',
	digits = 0,
}: {
	values: Record<string, unknown>;
	name: string;
	suffix?: string;
	digits?: number;
}) {
	const value = values[name];
	return (
		<>
			{typeof value === 'number' && Number.isFinite(value) ?
				`${value.toLocaleString('en-US', { maximumFractionDigits: digits })}${suffix}`
			:	'Not reported'}
		</>
	);
}

export function ResourceBar({
	label,
	used,
	total,
	unit,
}: {
	label: string;
	used: unknown;
	total: unknown;
	unit: string;
}) {
	const valid =
		typeof used === 'number' &&
		typeof total === 'number' &&
		Number.isFinite(used) &&
		Number.isFinite(total) &&
		total > 0;
	return (
		<div className='admin-resource'>
			<div className='admin-resource__label'>
				<strong>{label}</strong>
				<span>
					{valid ?
						`${used.toFixed(1)} / ${total.toFixed(1)} ${unit}`
					:	'Not reported'}
				</span>
			</div>
			{valid && (
				<progress
					aria-label={label}
					value={used}
					max={total}
				/>
			)}
		</div>
	);
}
