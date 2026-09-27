'use client';

import { api, type RouterOutputs } from '@/trpc/react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	MenuItem,
	TextField,
} from '@mui/material';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { QueryError } from './AdminPrimitives';
import {
	EmptyState,
	Money,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';
import { AdminElevation } from './SecuritySettings';

export function AdminFunds() {
	const funds = api.billing.funds.useQuery(undefined, {
		refetchInterval: 2000,
		refetchIntervalInBackground: false,
	});
	const availability = api.billing.availability.useQuery();
	const utils = api.useUtils();
	const [newOpen, setNewOpen] = useState(false);
	const [name, setName] = useState('');
	const [slug, setSlug] = useState('');
	const [description, setDescription] = useState('');
	const [selected, setSelected] = useState<
		RouterOutputs['billing']['funds'][number] | null
	>(null);
	const create = api.billing.adminCreateFund.useMutation({
		onSuccess: () => {
			setNewOpen(false);
			setName('');
			setSlug('');
			setDescription('');
			void utils.billing.funds.invalidate();
		},
	});
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>
					Shared funds, carefully allocated.
				</h2>
				<Button
					variant='contained'
					disabled={!availability.data?.funds}
					onClick={() => setNewOpen(true)}>
					Create a community fund
				</Button>
			</div>
			<p className='payment-note'>
				Allocate only to eligible, payment-enabled money Asks. The
				approving administrator cannot award money to their own Ask.
				Available balance excludes unsettled money and existing
				reservations.
			</p>
			{funds.error && (
				<QueryError
					message='Community funds could not load.'
					retry={() => void funds.refetch()}
				/>
			)}
			{funds.isPending ?
				<PaymentLoading />
			:	funds.data &&
				(funds.data.length ?
					<div className='payment-grid payment-grid--two'>
						{funds.data.map((fund) => (
							<Panel
								key={fund.id}
								title={fund.name}
								action={
									<StatusPill
										status={fund.active ? 'open' : 'closed'}
									/>
								}>
								<p className='payment-muted'>
									{fund.description}
								</p>
								<dl className='payment-details'>
									<div>
										<dt>Verified received</dt>
										<dd>
											<Money
												amount={fund.totalReceived}
											/>
										</dd>
									</div>
									<div>
										<dt>Allocated</dt>
										<dd>
											<Money
												amount={fund.totalAllocated}
											/>
										</dd>
									</div>
									<div>
										<dt>Reserved allocation</dt>
										<dd>
											<Money
												amount={fund.pendingAllocation}
											/>
										</dd>
									</div>
									<div className='payment-details__total'>
										<dt>Available now</dt>
										<dd>
											<Money
												amount={fund.availableAmount}
											/>
										</dd>
									</div>
								</dl>
								<div
									className='payment-actions'
									style={{ marginTop: 20 }}>
									<Button
										variant='outlined'
										disabled={
											!availability.data?.funds ||
											!fund.active ||
											fund.availableAmount <= 0
										}
										onClick={() => setSelected(fund)}>
										Allocate help
									</Button>
									<Link
										className='text-link'
										href={`/funds/${fund.slug}`}>
										Public history ↗
									</Link>
									<Link
										className='text-link'
										href={`/admin/activity?entityType=fund&entityId=${fund.id}`}>
										Audit history ↗
									</Link>
								</div>
							</Panel>
						))}
					</div>
				:	<EmptyState title='No funds created yet.'>
						Create a fund with a clear purpose when this environment
						is ready to accept fund contributions.
					</EmptyState>)
			}
			<Dialog
				open={newOpen}
				onClose={() => {
					if (!create.isPending) setNewOpen(false);
				}}
				fullWidth
				maxWidth='sm'
				aria-labelledby='create-fund-title'>
				<DialogTitle id='create-fund-title'>
					Create a community fund.
				</DialogTitle>
				<DialogContent>
					<div className='payment-form'>
						<TextField
							label='Fund name'
							value={name}
							onChange={(event) => setName(event.target.value)}
							inputProps={{ maxLength: 160 }}
						/>
						<TextField
							label='Public URL slug'
							value={slug}
							onChange={(event) => setSlug(event.target.value)}
							helperText='Lowercase words separated by hyphens. This becomes the public URL.'
							inputProps={{ maxLength: 160 }}
						/>
						<TextField
							label='Purpose and allocation approach'
							multiline
							minRows={4}
							value={description}
							onChange={(event) =>
								setDescription(event.target.value)
							}
							inputProps={{ maxLength: 10000 }}
							helperText='Describe who this fund supports and how allocation decisions will be made.'
						/>
						<details>
							<summary>Authorize sensitive actions</summary>
							<AdminElevation />
						</details>
						{create.error && (
							<Alert severity='error'>
								{create.error.message}
							</Alert>
						)}
					</div>
				</DialogContent>
				<DialogActions>
					<Button
						disabled={create.isPending}
						onClick={() => setNewOpen(false)}>
						Cancel
					</Button>
					<Button
						variant='contained'
						disabled={
							create.isPending ||
							name.trim().length < 3 ||
							description.trim().length < 20 ||
							!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
						}
						onClick={() =>
							create.mutate({ name, slug, description })
						}>
						{create.isPending ? 'Creating…' : 'Create fund'}
					</Button>
				</DialogActions>
			</Dialog>
			{selected && (
				<AllocationDialog
					fund={selected}
					close={() => setSelected(null)}
				/>
			)}
		</>
	);
}

function AllocationDialog({
	fund,
	close,
}: {
	fund: RouterOutputs['billing']['funds'][number];
	close: () => void;
}) {
	const asks = api.ask.getAsks.useQuery({ type: 'money' });
	const [askId, setAskId] = useState('');
	const [amount, setAmount] = useState('');
	const [reason, setReason] = useState('');
	const [review, setReview] = useState(false);
	const operationId = useRef<string | null>(null);
	const utils = api.useUtils();
	const allocation = api.billing.adminAllocate.useMutation({
		onSuccess: () => {
			void utils.billing.funds.invalidate();
		},
	});
	const selectedAsk = asks.data?.find((ask) => String(ask.id) === askId);
	const amountCents =
		/^\d+(\.\d{0,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
	const valid =
		!!selectedAsk &&
		amountCents > 0 &&
		amountCents <= fund.availableAmount &&
		reason.trim().length >= 10;
	return (
		<Dialog
			open
			onClose={() => {
				if (!allocation.isPending) close();
			}}
			fullWidth
			maxWidth='sm'
			aria-labelledby='allocate-title'>
			<DialogTitle id='allocate-title'>
				{allocation.data ?
					'Allocation recorded.'
				: review ?
					'Review this allocation.'
				:	'Choose where shared help goes.'}
			</DialogTitle>
			<DialogContent>
				<div className='payment-form'>
					{allocation.data ?
						<>
							<Alert severity='info'>
								The allocation is reserved and queued for
								transfer. It is not complete until confirmed in
								the fund’s allocation history.
							</Alert>
							<p>
								<strong>{fund.name}</strong> →{' '}
								<strong>{selectedAsk?.title}</strong>
							</p>
							<p>
								<Money amount={amountCents} />
							</p>
							<p className='payment-receipt-id'>
								Allocation {allocation.data.id}
							</p>
							<Link
								className='text-link'
								href={`/funds/${fund.slug}`}>
								View allocation history ↗
							</Link>
						</>
					:	<>
							<p>
								<strong>{fund.name}</strong> ·{' '}
								<Money amount={fund.availableAmount} />{' '}
								available at the last refresh.
							</p>
							{review ?
								<>
									<p>
										Allocate{' '}
										<strong>
											<Money amount={amountCents} />
										</strong>{' '}
										to <strong>{selectedAsk?.title}</strong>
										.
									</p>
									<p className='payment-note'>{reason}</p>
									<p className='payment-muted'>
										This reason will appear in the public
										allocation history. Eligibility and
										balances are checked again on the server
										before the reservation is made.
									</p>
								</>
							:	<>
									<TextField
										label='Money Ask'
										select
										value={askId}
										onChange={(event) => {
											setAskId(event.target.value);
											operationId.current = null;
										}}
										helperText='The server verifies enrollment, recipient readiness, remaining goal, and no self-award.'>
										<MenuItem value=''>
											Select an Ask
										</MenuItem>
										{asks.data
											?.filter(
												(ask) =>
													ask.status !== 'complete',
											)
											.map((ask) => (
												<MenuItem
													key={ask.id}
													value={String(ask.id)}>
													{ask.title}
												</MenuItem>
											))}
									</TextField>
									{asks.error && (
										<Alert severity='error'>
											Asks could not be loaded.
										</Alert>
									)}
									<TextField
										label='Allocation amount (USD)'
										value={amount}
										onChange={(event) => {
											setAmount(event.target.value);
											operationId.current = null;
										}}
										inputProps={{ inputMode: 'decimal' }}
									/>
									<TextField
										label='Public reason for this allocation'
										multiline
										minRows={3}
										value={reason}
										onChange={(event) => {
											setReason(event.target.value);
											operationId.current = null;
										}}
										inputProps={{ maxLength: 2000 }}
										helperText='At least 10 characters. Do not disclose private recipient details.'
									/>
								</>
							}
							<details>
								<summary>Authorize sensitive actions</summary>
								<AdminElevation />
							</details>
							{allocation.error && (
								<Alert severity='error'>
									{allocation.error.message}
								</Alert>
							)}
						</>
					}
				</div>
			</DialogContent>
			<DialogActions>
				{allocation.data ?
					<Button onClick={close}>Done</Button>
				:	<>
						<Button
							disabled={allocation.isPending}
							onClick={() =>
								review ? setReview(false) : close()
							}>
							{review ? 'Back' : 'Cancel'}
						</Button>
						<Button
							variant='contained'
							disabled={!valid || allocation.isPending}
							onClick={() => {
								if (!review) {
									setReview(true);
									return;
								}
								operationId.current ??= crypto.randomUUID();
								allocation.mutate({
									operationId: operationId.current,
									fundId: fund.id,
									askId: Number(askId),
									amount: amountCents,
									reason,
								});
							}}>
							{allocation.isPending ?
								'Reserving…'
							: review ?
								'Confirm allocation'
							:	'Review allocation'}
						</Button>
					</>
				}
			</DialogActions>
		</Dialog>
	);
}
