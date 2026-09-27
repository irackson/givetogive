'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
} from '@mui/material';
import Link from 'next/link';
import { useState } from 'react';
import { AdminActivity } from './AdminActivity';
import { QueryError } from './AdminPrimitives';
import {
	DateLabel,
	EmptyState,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';
import { AdminElevation } from './SecuritySettings';

export function AdminUsers() {
	const [draft, setDraft] = useState('');
	const [query, setQuery] = useState('');
	const [page, setPage] = useState(1);
	const result = api.admin.listUsers.useQuery({ query, page, limit: 25 });
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>Members, with context.</h2>
				<form
					className='payment-actions'
					onSubmit={(event) => {
						event.preventDefault();
						setQuery(draft);
						setPage(1);
					}}>
					<TextField
						label='Find by name or email'
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						size='small'
					/>
					<Button
						type='submit'
						variant='outlined'>
						Find member
					</Button>
				</form>
			</div>
			{result.error && (
				<QueryError
					message='Member records could not load.'
					retry={() => void result.refetch()}
				/>
			)}
			{result.isPending ?
				<PaymentLoading />
			:	result.data && (
					<Panel
						title={`${result.data.total.toLocaleString()} member${result.data.total === 1 ? '' : 's'}`}>
						<p className='admin-definition'>
							Matching registered accounts in this environment.
							Email addresses are administrator-only and are not
							included in shareable filter URLs.
						</p>
						{result.data.items.length ?
							<div className='payment-table-wrap'>
								<table className='payment-table'>
									<thead>
										<tr>
											<th scope='col'>Member</th>
											<th scope='col'>Joined</th>
											<th scope='col'>Account</th>
											<th scope='col'>Review</th>
										</tr>
									</thead>
									<tbody>
										{result.data.items.map((member) => (
											<tr key={member.id}>
												<td>
													<strong>
														{member.name ??
															'Community member'}
													</strong>
													<small>
														{member.email}
													</small>
												</td>
												<td>
													<DateLabel
														value={member.joinedAt}
													/>
												</td>
												<td>
													<StatusPill
														status={
															member.frozenAt ?
																'frozen'
															:	member.role
														}
													/>
													{member.isSynthetic && (
														<small>
															Synthetic test user
														</small>
													)}
												</td>
												<td>
													<Link
														href={`/admin/users/${member.id}`}>
														Inspect member ↗
													</Link>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						:	<EmptyState title='No matching members.'>
								Try another name or clear your search.
							</EmptyState>
						}
						<div
							className='payment-pagination'
							style={{ marginTop: 20 }}>
							<Button
								disabled={page === 1}
								onClick={() => setPage(page - 1)}>
								Previous
							</Button>
							<span>
								Page {page} of{' '}
								{Math.max(1, Math.ceil(result.data.total / 25))}
							</span>
							<Button
								disabled={page * 25 >= result.data.total}
								onClick={() => setPage(page + 1)}>
								Next
							</Button>
						</div>
					</Panel>
				)
			}
		</>
	);
}

export function AdminUserDetail({ id }: { id: string }) {
	const query = api.admin.userDetail.useQuery({ id });
	const utils = api.useUtils();
	const [dialog, setDialog] = useState(false);
	const [reason, setReason] = useState('');
	const freeze = api.admin.freezeUser.useMutation({
		onSuccess: () => {
			setDialog(false);
			setReason('');
			void utils.admin.userDetail.invalidate({ id });
		},
	});
	if (query.isPending) return <PaymentLoading />;
	if (query.error)
		return (
			<QueryError
				message={query.error.message}
				retry={() => void query.refetch()}
			/>
		);
	const { user, subscriptions, accounts } = query.data;
	return (
		<>
			<Link
				className='text-link'
				href='/admin/users'>
				← All members
			</Link>
			<div className='admin-toolbar'>
				<h2 className='section-title'>
					{user.name ?? 'Community member'}
				</h2>
				<div className='payment-actions'>
					<StatusPill status={user.frozenAt ? 'frozen' : user.role} />
					<Button
						variant='outlined'
						color={user.frozenAt ? 'primary' : 'error'}
						onClick={() => setDialog(true)}>
						{user.frozenAt ? 'Unfreeze account' : 'Freeze account'}
					</Button>
				</div>
			</div>
			{user.isSynthetic && (
				<p className='payment-note payment-note--warning'>
					Synthetic simulation account. This is not a real community
					member.
				</p>
			)}
			<div className='payment-grid payment-grid--two'>
				<Panel title='Account details'>
					<dl className='payment-details'>
						<div>
							<dt>Email</dt>
							<dd>{user.email}</dd>
						</div>
						<div>
							<dt>Email confirmed</dt>
							<dd>
								<DateLabel value={user.emailVerified} />
							</dd>
						</div>
						<div>
							<dt>Joined</dt>
							<dd>
								<DateLabel value={user.joinedAt} />
							</dd>
						</div>
						<div>
							<dt>Role</dt>
							<dd>{user.role}</dd>
						</div>
					</dl>
					<div
						className='payment-actions'
						style={{ marginTop: 18 }}>
						<Link
							className='text-link'
							href={`/members/${user.id}`}>
							Public profile ↗
						</Link>
						<Link
							className='text-link'
							href={`/admin/payments?actorId=${user.id}`}>
							Payments ↗
						</Link>
					</div>
				</Panel>
				<Panel title='Receiving readiness'>
					{accounts.length ?
						<ul className='payment-list'>
							{accounts.map((account) => (
								<li key={account.stripeAccountId}>
									<div className='payment-row'>
										<strong>
											{account.livemode ?
												'Live account'
											:	'Test account'}
										</strong>
										<StatusPill
											status={
												(
													account.transfersActive &&
													account.payoutsActive
												) ?
													'ready'
												:	'incomplete'
											}
										/>
									</div>
									<p className='payment-muted'>
										Transfers{' '}
										{account.transfersActive ?
											'active'
										:	'not active'}{' '}
										· Payouts{' '}
										{account.payoutsActive ?
											'active'
										:	'not active'}
									</p>
									{account.requirements.length > 0 && (
										<p className='payment-muted'>
											{account.requirements.length}{' '}
											verification requirements recorded.
										</p>
									)}
								</li>
							))}
						</ul>
					:	<p className='payment-muted'>
							No connected receiving account.
						</p>
					}
				</Panel>
			</div>
			<Panel title='Recurring support'>
				{subscriptions.length ?
					<ul className='payment-list'>
						{subscriptions.map((subscription) => (
							<li key={subscription.id}>
								<div className='payment-row'>
									<strong>
										{subscription.kind === 'fund' ?
											'Community fund subscription'
										:	`${subscription.tier} membership`}
									</strong>
									<StatusPill status={subscription.status} />
								</div>
								<p className='payment-muted'>
									Paid through{' '}
									<DateLabel
										value={subscription.paidThrough}
									/>
									{subscription.cancelAtPeriodEnd ?
										' · Cancels at period end'
									:	''}
								</p>
							</li>
						))}
					</ul>
				:	<p className='payment-muted'>
						No recurring subscriptions recorded.
					</p>
				}
			</Panel>
			<AdminActivity initial={{ actorId: id }} />
			<Dialog
				open={dialog}
				onClose={() => {
					if (!freeze.isPending) setDialog(false);
				}}
				maxWidth='sm'
				fullWidth
				aria-labelledby='freeze-title'>
				<DialogTitle id='freeze-title'>
					{user.frozenAt ?
						'Restore access to this account?'
					:	'Freeze this account?'}
				</DialogTitle>
				<DialogContent>
					<div className='payment-stack'>
						<p>
							Existing sessions and agent tokens will be revoked.
							The action and reason will be recorded. This does
							not automatically refund payments.
						</p>
						<TextField
							label='Reason for this action'
							multiline
							minRows={3}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							inputProps={{ maxLength: 500 }}
							helperText='At least 10 characters. Never include passwords or bank details.'
						/>
						<details>
							<summary>Authorize sensitive actions</summary>
							<AdminElevation />
						</details>
						{freeze.error && (
							<Alert severity='error'>
								{freeze.error.message}
							</Alert>
						)}
					</div>
				</DialogContent>
				<DialogActions>
					<Button
						disabled={freeze.isPending}
						onClick={() => setDialog(false)}>
						Cancel
					</Button>
					<Button
						variant='contained'
						color={user.frozenAt ? 'primary' : 'error'}
						disabled={reason.trim().length < 10 || freeze.isPending}
						onClick={() =>
							freeze.mutate({
								id,
								frozen: !user.frozenAt,
								reason,
							})
						}>
						{freeze.isPending ?
							'Saving…'
						: user.frozenAt ?
							'Unfreeze account'
						:	'Freeze account'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
