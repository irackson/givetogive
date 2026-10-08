'use client';

import { api } from '@/trpc/react';
import { Button, MenuItem, TextField } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
	ActivityTimeline,
	Freshness,
	QueryError,
	type ActivityItem,
} from './AdminPrimitives';
import { EnvironmentNote, Panel, PaymentLoading } from './PaymentPrimitives';
import { DownloadJsonButton } from './AdminTrends';
import { activityCursor, activityPollingInterval, mergeActivityPage } from '@/lib/admin-activity-feed';

type Feed = {
	items: ActivityItem[];
	nextCursor: number | null;
	environment: string;
	observedAt: Date;
	catchingUp?: boolean;
};

export function AdminActivity({
	initial = {},
	liveUpdates = true,
}: {
	liveUpdates?: boolean;
	initial?: {
		entityType?: string;
		entityId?: string;
		actorId?: string;
		runId?: string;
	};
}) {
	const [outcome, setOutcome] = useState('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [before, setBefore] = useState<number | undefined>();
	const client = api.useUtils().client;
	const queryClient = useQueryClient();
	const queryKey = [
		'admin-activity-feed',
		initial,
		outcome,
		from,
		to,
		before,
	] as const;
	const feed = useQuery({
		queryKey,
		queryFn: async (): Promise<Feed> => {
			const previous = queryClient.getQueryData<Feed>(queryKey);
			const after = activityCursor(previous?.items, Boolean(before));
			const fresh = await client.admin.activity.query({
				...initial,
				...(outcome ? { outcome } : {}),
				...(from ? { from: new Date(`${from}T00:00:00Z`) } : {}),
				...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
				...(before ? { before } : {}),
				...(after !== undefined ? { after } : {}),
				limit: 100,
			});
			if (after === undefined || !previous) return fresh;
			const items = mergeActivityPage(previous.items, fresh.items);
			return {
				...fresh, items, nextCursor: items.at(-1)?.id ?? null,
				catchingUp: fresh.items.length === 100,
			};
		},
		refetchInterval: (query) => activityPollingInterval(
			Boolean(before), query.state.data?.catchingUp, query.state.status === 'error',
			liveUpdates,
		),
		refetchOnWindowFocus: liveUpdates,
		refetchOnReconnect: liveUpdates,
		refetchIntervalInBackground: false,
		retry: 2,
	});
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>
					{before ? 'Activity archive' : 'Live activity'}
				</h2>
				<Freshness
					updatedAt={feed.dataUpdatedAt}
					error={feed.isError}
					fetching={feed.isFetching}
					live={!before && liveUpdates}
				/>
			</div>
			<div className='admin-toolbar__filters admin-activity-filters'>
				<TextField
					label='Outcome'
					select
					value={outcome}
					onChange={(event) => {
						setOutcome(event.target.value);
						setBefore(undefined);
					}}
					size='small'
					sx={{ minWidth: 170 }}>
					<MenuItem value=''>All outcomes</MenuItem>
					{[
						'success',
						'succeeded',
						'completed',
						'failed',
						'denied',
						'pending',
						'requested',
						'error',
					].map((value) => (
						<MenuItem
							key={value}
							value={value}>
							{value}
						</MenuItem>
					))}
				</TextField>
				<TextField
					label='From (UTC)'
					type='date'
					value={from}
					onChange={(event) => {
						setFrom(event.target.value);
						setBefore(undefined);
					}}
					InputLabelProps={{ shrink: true }}
					size='small'
				/>
				<TextField
					label='Through (UTC)'
					type='date'
					value={to}
					onChange={(event) => {
						setTo(event.target.value);
						setBefore(undefined);
					}}
					InputLabelProps={{ shrink: true }}
					size='small'
				/>
				<Button
					onClick={() => {
						setOutcome('');
						setFrom('');
						setTo('');
						setBefore(undefined);
					}}>
					Reset filters
				</Button>
			</div>
			{feed.error && (
				<QueryError
					message='Activity could not refresh. Existing records below may be stale.'
					retry={() => void feed.refetch()}
				/>
			)}
			{feed.isPending ?
				<PaymentLoading label='Loading recorded activity' />
			:	feed.data && (
					<>
						<EnvironmentNote
							environment={feed.data.environment}
							livemode={feed.data.environment === 'production'}
						/>
						<Panel title='Recorded actions'>
							<p className='admin-definition'>
								Server-recorded actions for the selected
								population. Intent, application results, and
								payment confirmation are separate events. Times
								are UTC. The live view retains the latest 500
								received records; use Older activity to
								continue.
							</p>
							<ActivityTimeline items={feed.data.items} />
						</Panel>
						<div className='payment-pagination'>
							<DownloadJsonButton
								filename='givetogive-visible-activity.json'
								data={{
									environment: feed.data.environment,
									observedAt: feed.data.observedAt,
									exportedAt: new Date(),
									filters: {
										...initial,
										outcome,
										from,
										to,
										before,
									},
									scope: 'Only the currently loaded records, not the full database; live window capped at 500 records and archived pages at 100.',
									recordCount: feed.data.items.length,
									items: feed.data.items,
								}}>
								Export these {feed.data.items.length} records
							</DownloadJsonButton>
							{before && (
								<Button
									variant='outlined'
									onClick={() => setBefore(undefined)}>
									Return to live activity
								</Button>
							)}
							{feed.data.nextCursor && (
								<Button
									variant='outlined'
									onClick={() =>
										setBefore(
											feed.data?.nextCursor ?? undefined,
										)
									}>
									Older activity →
								</Button>
							)}
						</div>
					</>
				)
			}
		</>
	);
}
