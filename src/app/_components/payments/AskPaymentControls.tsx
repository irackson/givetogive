'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
} from '@mui/material';
import { api } from '@/trpc/react';
import {
	EmptyState,
	Money,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';
import { QueryError } from './AdminPrimitives';
import { AdminElevation } from './SecuritySettings';

export function AskPaymentControls() {
	const [search, setSearch] = useState('');
	const [query, setQuery] = useState('');
	const [afterId, setAfterId] = useState<number | undefined>();
	const [selected, setSelected] = useState<{
		id: number;
		title: string;
		paused: boolean;
		revision: number;
	} | null>(null);
	const [reason, setReason] = useState('');
	const operationId = useRef('');
	const list = api.paymentControls.asks.useQuery({
		...(query ? { query } : {}),
		...(afterId ? { afterId } : {}),
		limit: 25,
	});
	const update = api.paymentControls.setAskPaused.useMutation({
		onSuccess: () => {
			setSelected(null);
			setReason('');
			void list.refetch();
		},
	});
	const close = () => {
		if (!update.isPending) setSelected(null);
	};
	return (
		<Panel title='Ask payment controls'>
			<p className='admin-definition'>
				Pause new Checkout and fund-allocation reservations for one
				payment-enabled Ask. Existing Checkouts can still settle;
				refunds, disputes and recovery continue.
			</p>
			<form
				className='payment-row'
				onSubmit={(event) => {
					event.preventDefault();
					setQuery(search.trim());
					setAfterId(undefined);
				}}>
				<TextField
					size='small'
					label='Find a payment-enabled Ask'
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<Button type='submit'>Search Asks</Button>
			</form>
			{list.isPending ?
				<PaymentLoading />
			: list.error ?
				<QueryError
					message='Payment controls could not load.'
					retry={() => void list.refetch()}
				/>
			:	list.data && (
					<>
						{list.data.items.length ?
							<ul className='payment-list'>
								{list.data.items.map((ask) => (
									<li key={ask.id}>
										<div className='payment-row'>
											<Link
												className='text-link'
												href={`/asks/${ask.slug ?? ask.id}`}>
												{ask.title}
											</Link>
											<StatusPill
												status={
													ask.pausedAt ? 'paused' : (
														'accepting'
													)
												}
											/>
										</div>
										<p className='payment-muted'>
											Recipient goal:{' '}
											<Money amount={ask.goalAmount} />.
											Environment-wide payment gates still
											apply.
										</p>
										<Button
											size='small'
											variant='outlined'
											onClick={() => {
												operationId.current =
													crypto.randomUUID();
												setReason('');
												update.reset();
												setSelected({
													id: ask.id,
													revision: ask.revision,
													title: ask.title,
													paused: Boolean(
														ask.pausedAt,
													),
												});
											}}>
											{ask.pausedAt ?
												'Resume new payments'
											:	'Pause new payments'}
										</Button>
									</li>
								))}
							</ul>
						:	<EmptyState title='No payment-enabled Asks found.'>
								Legacy money pledges do not appear in these
								verified-payment controls.
							</EmptyState>
						}
						<div className='payment-row'>
							{afterId && (
								<Button onClick={() => setAfterId(undefined)}>
									First Asks
								</Button>
							)}
							{list.data.nextCursor && (
								<Button
									onClick={() =>
										setAfterId(list.data!.nextCursor!)
									}>
									More Asks
								</Button>
							)}
						</div>
					</>
				)
			}
			{update.isSuccess && (
				<Alert severity='success'>
					Ask payment control updated. Existing financial records were
					preserved.
				</Alert>
			)}
			<Dialog
				open={Boolean(selected)}
				onClose={close}
				fullWidth
				maxWidth='sm'
				aria-labelledby='ask-payment-control-title'>
				<DialogTitle id='ask-payment-control-title'>
					{selected?.paused ?
						'Resume new payments?'
					:	'Pause new payments?'}
				</DialogTitle>
				<DialogContent className='payment-stack'>
					<strong>{selected?.title}</strong>
					<Alert severity='info'>
						This controls new reservations only. It does not cancel
						an already-open Checkout, reverse money, or bypass
						recipient eligibility and environment gates.
					</Alert>
					<TextField
						label='Reason for this change'
						multiline
						minRows={3}
						value={reason}
						disabled={update.isPending}
						inputProps={{ maxLength: 500 }}
						helperText='10-500 characters; recorded in the private administrator audit. Do not include secrets or banking information.'
						onChange={(event) => setReason(event.target.value)}
					/>
					<AdminElevation />
					{update.error && (
						<Alert severity='error'>{update.error.message}</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button
						onClick={close}
						disabled={update.isPending}>
						Cancel
					</Button>
					<Button
						variant='contained'
						disabled={
							!selected ||
							update.isPending ||
							reason.trim().length < 10
						}
						onClick={() => {
							if (selected)
								update.mutate({
									askId: selected.id,
									paused: !selected.paused,
									expectedPaused: selected.paused,
									expectedRevision: selected.revision,
									reason: reason.trim(),
									operationId: operationId.current,
								});
						}}>
						{update.isPending ?
							'Saving…'
						: selected?.paused ?
							'Resume new payments'
						:	'Pause new payments'}
					</Button>
				</DialogActions>
			</Dialog>
		</Panel>
	);
}
