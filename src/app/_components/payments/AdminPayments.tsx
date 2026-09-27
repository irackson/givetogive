'use client';

import { api } from '@/trpc/react';
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
import { AdminActivity } from './AdminActivity';
import { Freshness, QueryError } from './AdminPrimitives';
import {
	DateLabel,
	EmptyState,
	Money,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';
import { AdminElevation } from './SecuritySettings';
import { CaseReview } from './CaseReview';
import { AskPaymentControls } from './AskPaymentControls';

export function AdminPayments({ actorId }: { actorId?: string }) {
	const [status, setStatus] = useState('');
	const [after, setAfter] = useState<string | undefined>();
	const payments = api.admin.payments.useQuery(
		{
			...(actorId ? { actorId } : {}),
			...(status ? { status } : {}),
			...(after ? { after } : {}),
			limit: 50,
		},
		{ refetchInterval: 2000, refetchIntervalInBackground: false },
	);
	const operations = api.admin.operations.useQuery(undefined, {
		refetchInterval: 2000,
		refetchIntervalInBackground: false,
	});
	const reconcile = api.billing.adminReconcile.useMutation();
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>Payments & recovery.</h2>
				<Freshness
					updatedAt={operations.dataUpdatedAt}
					error={operations.isError}
					fetching={operations.isFetching}
				/>
			</div>
			{!actorId && <AskPaymentControls />}
			<Panel
				title='What needs attention'
				action={
					<Button
						variant='outlined'
						disabled={reconcile.isPending}
						onClick={() => reconcile.mutate()}>
						{reconcile.isPending ?
							'Requesting…'
						:	'Run reconciliation'}
					</Button>
				}>
				<p className='admin-definition'>
					Pending or failed webhook deliveries, unresolved payment
					cases, and allocations requiring recovery. Queued
					reconciliation is not confirmation of recovery.
				</p>
				{reconcile.error && (
					<Alert severity='error'>{reconcile.error.message}</Alert>
				)}
				{reconcile.data && (
					<Alert severity='info'>
						Reconciliation queued. Workflow {reconcile.data.runId}.
						Watch the records below for confirmed results.
					</Alert>
				)}
				<details>
					<summary className='payment-muted'>
						Authorize sensitive actions
					</summary>
					<AdminElevation />
				</details>
				{operations.error && (
					<QueryError
						message='Recovery records could not refresh.'
						retry={() => void operations.refetch()}
					/>
				)}
				{operations.isPending ?
					<PaymentLoading />
				:	operations.data && (
						<>
							{(
								!operations.data.cases.length &&
								!operations.data.webhooks.length &&
								!operations.data.allocations.length
							) ?
								<EmptyState title='No outstanding recovery items.'>
									No unresolved cases, pending/failed webhook
									records, or allocations requiring recovery
									were returned by this query.
								</EmptyState>
							:	<div className='payment-stack'>
									{operations.data.cases.length > 0 && (
										<ul className='payment-list'>
											{operations.data.cases.map(
												(item) => (
													<li key={item.id}>
														<div className='payment-row'>
															<strong>
																{item.category.replaceAll(
																	'_',
																	' ',
																)}
															</strong>
															<DateLabel
																value={
																	item.createdAt
																}
															/>
														</div>
														<p className='payment-muted'>
															{item.summary}
														</p>
														{item.paymentId && (
															<Link
																className='text-link'
																href={`/admin/payments/${item.paymentId}`}>
																Inspect payment
																↗
															</Link>
														)}
														<CaseReview
															caseId={item.id}
														/>
													</li>
												),
											)}
										</ul>
									)}
									{operations.data.webhooks.length > 0 && (
										<div className='payment-table-wrap'>
											<table className='payment-table'>
												<caption className='sr-only'>
													Webhook recovery queue
												</caption>
												<thead>
													<tr>
														<th scope='col'>
															Webhook event
														</th>
														<th scope='col'>
															State
														</th>
														<th scope='col'>
															Attempts
														</th>
													</tr>
												</thead>
												<tbody>
													{operations.data.webhooks.map(
														(item) => (
															<tr key={item.id}>
																<td>
																	<strong>
																		{
																			item.type
																		}
																	</strong>
																	<small>
																		{
																			item.stripeEventId
																		}
																	</small>
																	<small>
																		{
																			item.lastError
																		}
																	</small>
																</td>
																<td>
																	<StatusPill
																		status={
																			item.status
																		}
																	/>
																</td>
																<td>
																	{
																		item.attempts
																	}
																</td>
															</tr>
														),
													)}
												</tbody>
											</table>
										</div>
									)}
									{operations.data.allocations.length > 0 && (
										<ul className='payment-list'>
											{operations.data.allocations.map(
												(item) => (
													<li key={item.id}>
														<div className='payment-row'>
															<strong>
																Allocation
																requires
																recovery
															</strong>
															<Money
																amount={
																	item.amount
																}
															/>
														</div>
														<Link
															className='text-link'
															href={`/admin/activity?entityType=fund_allocation&entityId=${item.id}`}>
															Inspect allocation
															history ↗
														</Link>
													</li>
												),
											)}
										</ul>
									)}
								</div>
							}
						</>
					)
				}
			</Panel>
			<Panel
				title='Payment records'
				action={
					<TextField
						select
						size='small'
						label='Payment status'
						value={status}
						sx={{ minWidth: 180 }}
						onChange={(event) => {
							setStatus(event.target.value);
							setAfter(undefined);
						}}>
						<MenuItem value=''>All statuses</MenuItem>
						{[
							'reserved',
							'checkout_open',
							'pending',
							'succeeded',
							'failed',
							'expired',
							'partially_refunded',
							'refunded',
							'disputed',
						].map((value) => (
							<MenuItem
								value={value}
								key={value}>
								{value.replaceAll('_', ' ')}
							</MenuItem>
						))}
					</TextField>
				}>
				{payments.error && (
					<QueryError
						message='Payment records could not refresh.'
						retry={() => void payments.refetch()}
					/>
				)}
				{payments.isPending ?
					<PaymentLoading />
				:	payments.data && (
						<>
							{payments.data.items.length ?
								<div className='payment-table-wrap'>
									<table className='payment-table'>
										<thead>
											<tr>
												<th scope='col'>Payment</th>
												<th scope='col'>Date</th>
												<th scope='col'>Gross</th>
												<th scope='col'>Status</th>
												<th scope='col'>Member</th>
											</tr>
										</thead>
										<tbody>
											{payments.data.items.map((item) => (
												<tr key={item.id}>
													<td>
														<Link
															href={`/admin/payments/${item.id}`}>
															{(
																item.kind ===
																'ask'
															) ?
																'Ask contribution'
															: (
																item.kind ===
																'fund'
															) ?
																'Community fund gift'
															:	'Membership'}
														</Link>
														<small>
															{item.id.slice(
																0,
																8,
															)}
														</small>
													</td>
													<td>
														<DateLabel
															value={
																item.createdAt
															}
														/>
													</td>
													<td>
														<Money
															amount={
																item.grossAmount
															}
															currency={
																item.currency
															}
														/>
														{item.refundedAmount >
															0 && (
															<small>
																<Money
																	amount={
																		item.refundedAmount
																	}
																/>{' '}
																refunded
															</small>
														)}
													</td>
													<td>
														<StatusPill
															status={item.status}
														/>
													</td>
													<td>
														<Link
															href={`/admin/users/${item.actorId}`}>
															View member ↗
														</Link>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							:	<EmptyState title='No payments in this selection.'>
									There are no records matching these filters.
								</EmptyState>
							}
							<div
								className='payment-pagination'
								style={{ marginTop: 20 }}>
								{after && (
									<Button onClick={() => setAfter(undefined)}>
										First page
									</Button>
								)}
								{payments.data.nextCursor && (
									<Button
										onClick={() =>
											setAfter(
												payments.data?.nextCursor ??
													undefined,
											)
										}>
										Next records →
									</Button>
								)}
							</div>
						</>
					)
				}
			</Panel>
		</>
	);
}

export function AdminPaymentDetail({ id }: { id: string }) {
	const query = api.admin.paymentDetail.useQuery(
		{ id },
		{ refetchInterval: 2000, refetchIntervalInBackground: false },
	);
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState('');
	const [reason, setReason] = useState('');
	const operationId = useRef<string | null>(null);
	const refund = api.billing.adminRefund.useMutation({
		onSuccess: () => setOpen(false),
	});
	if (query.isPending) return <PaymentLoading />;
	if (query.error)
		return (
			<QueryError
				message={query.error.message}
				retry={() => void query.refetch()}
			/>
		);
	const { payment, ledger, cases } = query.data;
	const available = payment.grossAmount - payment.refundedAmount;
	const cents =
		/^\d+(\.\d{0,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
	return (
		<>
			<Link
				className='text-link'
				href='/admin/payments'>
				← Payment operations
			</Link>
			<div className='admin-toolbar'>
				<h2 className='section-title'>The complete payment trail.</h2>
				<Freshness
					updatedAt={query.dataUpdatedAt}
					fetching={query.isFetching}
				/>
			</div>
			{refund.data && (
				<Alert severity='info'>
					Refund request recorded. It is not complete until the
					operation and Stripe-confirmed payment record show the
					result.
				</Alert>
			)}
			<div className='payment-grid payment-grid--two'>
				<Panel
					title='Payment record'
					action={<StatusPill status={payment.status} />}>
					<dl className='payment-details'>
						<div>
							<dt>Total charged</dt>
							<dd>
								<Money amount={payment.grossAmount} />
							</dd>
						</div>
						<div>
							<dt>Platform fee</dt>
							<dd>
								<Money amount={payment.platformFee} />
							</dd>
						</div>
						<div>
							<dt>Quoted processing deduction</dt>
							<dd>
								<Money amount={payment.processingEstimate} />
							</dd>
						</div>
						<div>
							<dt>Actual processing cost</dt>
							<dd>
								{payment.actualProcessingFee === null ?
									'Not reconciled'
								:	<Money amount={payment.actualProcessingFee} />}
							</dd>
						</div>
						<div>
							<dt>Recipient / fund amount</dt>
							<dd>
								<Money amount={payment.recipientAmount} />
							</dd>
						</div>
						<div>
							<dt>Refunded gross</dt>
							<dd>
								<Money amount={payment.refundedAmount} />
							</dd>
						</div>
						<div>
							<dt>Disputed amount</dt>
							<dd>
								<Money amount={payment.disputedAmount} />
							</dd>
						</div>
						<div>
							<dt>Payment confirmed</dt>
							<dd>
								<DateLabel value={payment.paidAt} />
							</dd>
						</div>
					</dl>
					<p className='payment-receipt-id'>Payment {payment.id}</p>
					<div className='payment-actions'>
						<Link
							className='text-link'
							href={`/admin/users/${payment.actorId}`}>
							Member history ↗
						</Link>
						{payment.askId && (
							<Link
								className='text-link'
								href={`/asks/${payment.askId}`}>
								View Ask ↗
							</Link>
						)}
						<Button
							variant='outlined'
							color='error'
							disabled={
								!payment.paidAt ||
								available <= 0 ||
								payment.disputedAmount > 0
							}
							onClick={() => {
								setAmount((available / 100).toFixed(2));
								setReason('');
								operationId.current = null;
								refund.reset();
								setOpen(true);
							}}>
							Request refund
						</Button>
					</div>
				</Panel>
				<Panel title='Recovery cases'>
					{cases.length ?
						<ul className='payment-list'>
							{cases.map((item) => (
								<li key={item.id}>
									<strong>
										{item.category.replaceAll('_', ' ')}
									</strong>
									<p className='payment-muted'>
										{item.summary}
									</p>
									<StatusPill
										status={
											item.resolvedAt ? 'resolved' : (
												'unresolved'
											)
										}
									/>
									<CaseReview caseId={item.id} />
								</li>
							))}
						</ul>
					:	<EmptyState title='No payment cases.'>
							No recovery case is recorded for this payment.
						</EmptyState>
					}
				</Panel>
			</div>
			<Panel title='Immutable ledger'>
				<p className='admin-definition'>
					Signed minor-unit entries, displayed in dollars. Each
					journal must balance to zero. Corrections are additional
					entries, not rewritten history.
				</p>
				{ledger.length ?
					<ul className='payment-list'>
						{ledger.map((journal) => (
							<li key={journal.id}>
								<div className='payment-row'>
									<strong>{journal.operationKey}</strong>
									<DateLabel value={journal.createdAt} />
								</div>
								<dl className='payment-details'>
									{journal.lines.map((line, index) => (
										<div key={`${line.account}-${index}`}>
											<dt>{line.account}</dt>
											<dd>
												<Money
													amount={line.amount}
													currency={journal.currency}
												/>
											</dd>
										</div>
									))}
								</dl>
								<p className='payment-muted'>
									Journal balance:{' '}
									<Money
										amount={journal.lines.reduce(
											(total, line) =>
												total + line.amount,
											0,
										)}
									/>
								</p>
							</li>
						))}
					</ul>
				:	<p className='payment-muted'>
						No financial journal has been recorded for this payment.
					</p>
				}
			</Panel>
			<AdminActivity initial={{ entityType: 'payment', entityId: id }} />
			<Dialog
				open={open}
				onClose={() => {
					if (!refund.isPending) setOpen(false);
				}}
				fullWidth
				maxWidth='sm'
				aria-labelledby='refund-title'>
				<DialogTitle id='refund-title'>
					Return all or part of this payment.
				</DialogTitle>
				<DialogContent>
					<div className='payment-form'>
						<p>
							Refunds can require reversing transferred money.
							Nonrecoverable processing costs remain a platform
							expense.
						</p>
						<TextField
							label='Refund amount (USD)'
							value={amount}
							onChange={(event) => {
								setAmount(event.target.value);
								operationId.current = null;
							}}
							inputProps={{ inputMode: 'decimal' }}
							helperText={`Up to ${(available / 100).toFixed(2)} USD before any other pending refund.`}
						/>
						<TextField
							label='Reason'
							multiline
							minRows={3}
							value={reason}
							onChange={(event) => {
								setReason(event.target.value);
								operationId.current = null;
							}}
							inputProps={{ maxLength: 2000 }}
							helperText='At least 10 characters. Recorded for administrator review.'
						/>
						<details>
							<summary>Authorize sensitive actions</summary>
							<AdminElevation />
						</details>
						{refund.error && (
							<Alert severity='error'>
								{refund.error.message}
							</Alert>
						)}
					</div>
				</DialogContent>
				<DialogActions>
					<Button
						disabled={refund.isPending}
						onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						color='error'
						variant='contained'
						disabled={
							refund.isPending ||
							cents <= 0 ||
							cents > available ||
							reason.trim().length < 10
						}
						onClick={() => {
							operationId.current ??= crypto.randomUUID();
							refund.mutate({
								operationId: operationId.current,
								paymentId: id,
								amount: cents,
								reason,
							});
						}}>
						{refund.isPending ?
							'Recording request…'
						:	'Confirm refund request'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
