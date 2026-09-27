'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
	Alert,
	Button,
	Checkbox,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	FormControlLabel,
} from '@mui/material';
import { api, type RouterInputs, type RouterOutputs } from '@/trpc/react';
import { supporterChangeConfirmationAllowed } from './supporter-change-ui-policy';
import {
	DateLabel,
	EmptyState,
	Money,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';

type ChangeInput = RouterInputs['billing']['previewSupporterChange'];
type Change = RouterOutputs['billing']['supporterChangeStatus'];
type Subscription = RouterOutputs['billing']['mySubscriptions'][number];

const titles = {
	upgrade: 'Upgrade to Sustainer',
	downgrade: 'Switch to Supporter at renewal',
	undo: 'Undo a pending change',
	cancel: 'Cancel at period end',
	resume: 'Keep this membership renewing',
} as const;

function explanation(change: Change, billingOnly: boolean) {
	switch (change.status) {
		case 'quoted':
			return change.canConfirm ?
					'This is a preview only. Nothing changes until you confirm this quote.'
				:	'This preview can no longer be confirmed. Refresh your membership and request a new preview; no change is applied by viewing a quote.';
		case 'reserved':
		case 'processing':
			return 'Your request is recorded and being checked with Stripe. Do not create another request.';
		case 'pending_payment':
			return billingOnly ?
					'This upgrade is awaiting payment. Restricted access lets you cancel this unpaid upgrade, not complete another charge.'
				:	'Payment or authentication is still needed for this upgrade. Your previous paid recognition remains subject to its existing coverage. Continue with the same invoice below.';
		case 'scheduled':
			return 'This change is scheduled, not effective yet. Your paid recognition is checked separately against its coverage dates.';
		case 'applied':
			return 'Stripe has applied this change. Your recognition is shown separately and requires verified paid coverage.';
		case 'expired':
			return 'This quote or pending change expired. Refresh your membership before requesting a new preview.';
		case 'failed':
			return 'This request did not finish as requested. Review the message below and refresh your membership before trying a new change.';
		case 'recovery_required':
			return 'The outcome needs reconciliation. Do not submit a replacement charge or subscription; the existing request is being preserved for recovery.';
	}
}

function membershipName(tier: string | null) {
	return (
		tier === 'sustainer' ? 'Sustainer'
		: tier === 'supporter' ? 'Supporter'
		: 'Not yet verified'
	);
}

export function SupporterChanges({
	enabled,
	managementEnabled,
	initialSubscriptions,
	billingOnly = false,
}: {
	enabled: boolean;
	managementEnabled: boolean;
	initialSubscriptions: RouterOutputs['billing']['mySubscriptions'];
	billingOnly?: boolean;
}) {
	const router = useRouter();
	const utils = api.useUtils();
	const [selection, setSelection] = useState<{
		operationId: string | null;
		input: ChangeInput | null;
	} | null>(null);
	// An operation ID identifies one immutable server quote. Consent is never
	// carried across a refreshed quote or a different operation.
	const [acceptedOperation, setAcceptedOperation] = useState<string | null>(
		null,
	);
	const subscriptions = api.billing.mySubscriptions.useQuery(undefined, {
		initialData: initialSubscriptions,
		refetchInterval: 15_000,
	});
	const members = subscriptions.data.filter(
		(item) => item.kind === 'supporter',
	);
	const history = api.billing.listSupporterChanges.useQuery(
		{ limit: 50 },
		{
			enabled: members.length > 0,
			refetchInterval:
				(
					members.some(
						(item) => item.pendingChangeId || item.activeMutationId,
					)
				) ?
					15_000
				:	false,
		},
	);
	const status = api.billing.supporterChangeStatus.useQuery(
		{
			operationId:
				selection?.operationId ??
				'00000000-0000-4000-8000-000000000000',
		},
		{
			enabled: Boolean(selection?.operationId),
			refetchInterval: (query) => {
				const current = query.state.data;
				return (
						current &&
							[
								'reserved',
								'processing',
								'pending_payment',
								'recovery_required',
							].includes(current.status)
					) ?
						5_000
					:	false;
			},
		},
	);
	const refresh = () => {
		void subscriptions.refetch();
		if (members.length) void history.refetch();
		void utils.billing.myOverview.invalidate();
		router.refresh();
	};
	const preview = api.billing.previewSupporterChange.useMutation({
		onSuccess: (change, input) => {
			utils.billing.supporterChangeStatus.setData(
				{ operationId: change.operationId },
				change,
			);
			setSelection({ operationId: change.operationId, input });
			setAcceptedOperation(null);
			void history.refetch();
		},
	});
	const confirm = api.billing.confirmSupporterChange.useMutation({
		onSuccess: (change) => {
			utils.billing.supporterChangeStatus.setData(
				{ operationId: change.operationId },
				change,
			);
			setAcceptedOperation(null);
			refresh();
		},
		onError: () => {
			// A lost response may follow a successful provider write. Re-read the
			// same durable operation; never manufacture a new confirmation key.
			void status.refetch();
			refresh();
		},
	});
	const busy = preview.isPending || confirm.isPending;
	const requestPreview = (
		subscription: Subscription,
		action: ChangeInput['action'],
		targetOperationId?: string,
	) => {
		const target = status.data;
		if (
			billingOnly &&
			action !== 'cancel' &&
			!(
				action === 'undo' &&
				target &&
				target.operationId === targetOperationId &&
				target.action === 'upgrade' &&
				target.status === 'pending_payment'
			)
		)
			return;
		const input: ChangeInput = {
			operationId: crypto.randomUUID(),
			subscriptionId: subscription.id,
			expectedRevision: subscription.changeRevision,
			action,
			...(targetOperationId ? { targetOperationId } : {}),
		};
		setAcceptedOperation(null);
		setSelection({ operationId: null, input });
		confirm.reset();
		preview.reset();
		preview.mutate(input);
	};
	const viewChange = (operationId: string) => {
		setAcceptedOperation(null);
		preview.reset();
		confirm.reset();
		setSelection({ operationId, input: null });
	};
	const close = () => {
		if (!busy) {
			setSelection(null);
			setAcceptedOperation(null);
			refresh();
		}
	};
	const current = status.data;
	const currentSubscription = members.find(
		(item) => item.id === current?.subscriptionId,
	);
	const consent = Boolean(
		current && acceptedOperation === current.operationId,
	);
	const title =
		current ? titles[current.action]
		: selection?.input ? titles[selection.input.action]
		: 'Membership change';
	const currentActionEnabled =
		current &&
		supporterChangeConfirmationAllowed(current, {
			billingOnly,
			enabled,
			managementEnabled,
		});

	return (
		<Panel
			title='Make room for your next chapter.'
			eyebrow='Membership changes'>
			{billingOnly ?
				<p className='payment-muted'>
					You can cancel renewal or undo an unpaid upgrade. New
					charges, tier changes and renewal resumption are unavailable
					while your account is frozen.
				</p>
			:	<p className='payment-muted'>
					Change your existing membership, not your place in the
					community. Every option starts with a server-confirmed
					preview. Upgrades require payment; downgrades and
					cancellations take effect at period end.
				</p>
			}
			{!managementEnabled && (
				<Alert severity='info'>
					Membership changes are not enabled in this environment. You
					can still review your existing records.
				</Alert>
			)}
			{managementEnabled && !enabled && !billingOnly && (
				<Alert severity='info'>
					New memberships and tier changes are paused. Existing
					memberships can still be canceled, resumed, or have an owned
					scheduled change undone.
				</Alert>
			)}
			{subscriptions.error && (
				<Alert severity='error'>
					Your membership could not be refreshed. Actions are
					unavailable until the latest state is loaded.{' '}
					<Button onClick={refresh}>Refresh membership</Button>
				</Alert>
			)}
			{members.length === 0 ?
				<EmptyState title='No membership to change yet.'>
					{billingOnly ?
						'This account has no supporter membership to manage.'
					:	'If you choose a paid membership, its billing tier, verified recognition and change history will appear here.'
					}
				</EmptyState>
			:	<div className='supporter-changes'>
					{members.map((subscription) => {
						const ended = [
							'canceled',
							'incomplete_expired',
						].includes(subscription.status);
						const unavailable =
							Boolean(subscriptions.error) ||
							busy ||
							ended ||
							Boolean(subscription.activeMutationId) ||
							subscription.recognitionStatus === 'pending';
						return (
							<article
								key={subscription.id}
								className='supporter-change-card'
								aria-label={`${membershipName(subscription.billingTier)} billing membership`}>
								<div className='payment-row'>
									<h3>
										{membershipName(
											subscription.billingTier,
										)}{' '}
										billing
									</h3>
									<StatusPill status={subscription.status} />
								</div>
								<dl className='payment-details'>
									<div>
										<dt>Current paid recognition</dt>
										<dd>
											{(
												subscription.recognitionStatus ===
												'pending'
											) ?
												'Reconciliation pending'
											: subscription.tier ?
												membershipName(
													subscription.tier,
												)
											:	'No current verified paid coverage'
											}
										</dd>
									</div>
									<div>
										<dt>Current billing period ends</dt>
										<dd>
											<DateLabel
												value={subscription.periodEnd}
											/>
										</dd>
									</div>
									<div>
										<dt>Renewal</dt>
										<dd>
											{ended ?
												'Ended'
											: subscription.cancelAtPeriodEnd ?
												'Cancels at period end'
											:	'Continues unless canceled'}
										</dd>
									</div>
								</dl>
								{subscription.recognitionStatus ===
									'pending' && (
									<p
										className='payment-note'
										role='status'>
										Paid coverage or the sandbox clock is
										being verified. We are not labeling this
										membership free or applying an
										unverified tier.
									</p>
								)}
								<div className='payment-actions'>
									{!billingOnly &&
										!ended &&
										!subscription.pendingChangeId &&
										!subscription.cancelAtPeriodEnd &&
										subscription.billingTier ===
											'supporter' && (
											<Button
												variant='contained'
												disabled={
													!enabled || unavailable
												}
												onClick={() =>
													requestPreview(
														subscription,
														'upgrade',
													)
												}>
												Preview Sustainer upgrade
											</Button>
										)}
									{!billingOnly &&
										!ended &&
										!subscription.pendingChangeId &&
										!subscription.cancelAtPeriodEnd &&
										subscription.billingTier ===
											'sustainer' && (
											<Button
												variant='outlined'
												disabled={
													!enabled || unavailable
												}
												onClick={() =>
													requestPreview(
														subscription,
														'downgrade',
													)
												}>
												Preview Supporter downgrade
											</Button>
										)}
									{!ended &&
										!(
											billingOnly &&
											subscription.cancelAtPeriodEnd
										) && (
											<Button
												variant='outlined'
												disabled={
													!managementEnabled ||
													unavailable
												}
												onClick={() =>
													requestPreview(
														subscription,
														(
															subscription.cancelAtPeriodEnd
														) ?
															'resume'
														:	'cancel',
														subscription.pendingChangeId ??
															undefined,
													)
												}>
												{(
													subscription.cancelAtPeriodEnd
												) ?
													'Preview renewal resumption'
												:	'Preview period-end cancellation'
												}
											</Button>
										)}
									{(subscription.activeMutationId ??
										subscription.pendingChangeId) && (
										<Button
											onClick={() =>
												viewChange(
													(subscription.activeMutationId ??
														subscription.pendingChangeId)!,
												)
											}>
											Review pending change
										</Button>
									)}
								</div>
							</article>
						);
					})}
				</div>
			}
			{members.length > 0 && (
				<details className='supporter-change-history'>
					<summary>Membership change history</summary>
					<p className='payment-muted'>
						Your latest 50 requests, including previews and
						unsuccessful changes. A request is not proof of payment.
					</p>
					{history.isPending ?
						<PaymentLoading label='Loading change history' />
					: history.error ?
						<Alert severity='error'>
							Change history is unavailable.{' '}
							<Button onClick={() => void history.refetch()}>
								Retry history
							</Button>
						</Alert>
					: history.data?.length ?
						<ul className='payment-list'>
							{history.data.map((change) => (
								<li key={change.operationId}>
									<div className='payment-row'>
										<strong>{titles[change.action]}</strong>
										<StatusPill status={change.status} />
										<Button
											size='small'
											onClick={() =>
												viewChange(change.operationId)
											}>
											View request
										</Button>
									</div>
								</li>
							))}
						</ul>
					:	<p>No membership changes have been requested.</p>}
				</details>
			)}
			<Dialog
				open={Boolean(selection)}
				onClose={close}
				fullWidth
				maxWidth='sm'
				aria-labelledby='supporter-change-title'>
				<DialogTitle id='supporter-change-title'>{title}</DialogTitle>
				<DialogContent className='payment-stack'>
					{preview.isPending && (
						<PaymentLoading label='Preparing your server-confirmed preview' />
					)}
					{preview.error && (
						<Alert severity='error'>{preview.error.message}</Alert>
					)}
					{selection?.operationId && status.isPending && (
						<PaymentLoading label='Checking this request' />
					)}
					{status.error && (
						<Alert severity='error'>
							This request could not be verified. Do not create a
							replacement while its outcome is unknown. Refresh
							this request to check again.
						</Alert>
					)}
					{current && (
						<>
							<StatusPill status={current.status} />
							<p role='status'>
								{explanation(current, billingOnly)}
							</p>
							<dl className='payment-details'>
								<div>
									<dt>Current billing tier</dt>
									<dd>
										{membershipName(current.sourceTier)}
									</dd>
								</div>
								{current.targetTier && (
									<div>
										<dt>Requested tier</dt>
										<dd>
											{membershipName(current.targetTier)}
										</dd>
									</div>
								)}
								<div>
									<dt>Quoted amount due now</dt>
									<dd>
										{current.quoteAmount === null ?
											'Not available'
										:	<Money
												amount={current.quoteAmount}
												currency={current.currency}
											/>
										}
									</dd>
								</div>
								{current.effectiveAt && (
									<div>
										<dt>Effective no earlier than</dt>
										<dd>
											<DateLabel
												value={current.effectiveAt}
											/>
										</dd>
									</div>
								)}
								{current.quoteExpiresAt &&
									current.status === 'quoted' && (
										<div>
											<dt>Quote expires (UTC)</dt>
											<dd>
												<time
													dateTime={new Date(
														current.quoteExpiresAt,
													).toISOString()}>
													{new Date(
														current.quoteExpiresAt,
													).toLocaleString('en-US', {
														timeZone: 'UTC',
													})}
												</time>
											</dd>
										</div>
									)}
							</dl>
							{current.action === 'upgrade' && (
								<p className='payment-note'>
									This uses your existing subscription.
									Recognition changes only after the prorated
									invoice is paid and Stripe applies the
									update. An authentication challenge or
									declined payment does not grant the new
									tier.
								</p>
							)}
							{current.action === 'cancel' && (
								<p className='payment-note'>
									Cancellation is for period end, not an
									immediate refund. Any existing scheduled
									change or payment race is checked before
									applying this request.
								</p>
							)}
							{current.action === 'downgrade' && (
								<p className='payment-note'>
									No immediate credit or refund is issued.
									Existing paid recognition is retained
									through its verified coverage period.
								</p>
							)}
							{current.lastError && (
								<Alert severity='warning'>
									{current.lastError}
								</Alert>
							)}
							{!billingOnly &&
								current.invoiceUrl &&
								current.status === 'pending_payment' && (
									<Button
										component='a'
										href={current.invoiceUrl}
										variant='contained'
										rel='noreferrer'>
										Continue payment on the existing invoice
									</Button>
								)}
							{current.canConfirm &&
								currentActionEnabled &&
								!status.error && (
									<FormControlLabel
										control={
											<Checkbox
												checked={consent}
												disabled={
													busy ||
													!currentActionEnabled
												}
												onChange={(__event, checked) =>
													setAcceptedOperation(
														checked ?
															current.operationId
														:	null,
													)
												}
											/>
										}
										label={
											current.action === 'upgrade' ?
												'I agree to this quoted charge and membership change.'
											:	'I have reviewed when this change takes effect and agree to it.'
										}
									/>
								)}
							{current.canUndo &&
								currentSubscription &&
								(!billingOnly ||
									(current.action === 'upgrade' &&
										current.status ===
											'pending_payment')) && (
									<Button
										disabled={
											!managementEnabled ||
											busy ||
											Boolean(subscriptions.error) ||
											Boolean(status.error) ||
											currentSubscription.recognitionStatus ===
												'pending' ||
											Boolean(
												currentSubscription.activeMutationId,
											)
										}
										onClick={() =>
											requestPreview(
												currentSubscription,
												current.action === 'cancel' ?
													'resume'
												:	'undo',
												current.operationId,
											)
										}>
										{current.action === 'upgrade' ?
											'Preview cancellation of pending upgrade'
										: current.action === 'cancel' ?
											'Preview keeping renewal'
										:	'Preview undoing scheduled change'}
									</Button>
								)}
						</>
					)}
					{confirm.error && (
						<Alert severity='error'>
							{confirm.error.message} Refresh this request first.
							If its quote has expired or changed, close this
							dialog and request a new preview; a new quote
							requires new consent.
						</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button
						disabled={busy}
						onClick={close}>
						Close
					</Button>
					{preview.error && selection?.input && (
						<Button
							disabled={busy}
							onClick={() => preview.mutate(selection.input!)}>
							Retry the same preview
						</Button>
					)}
					{selection?.operationId && (
						<Button
							disabled={busy || status.isFetching}
							onClick={() => {
								void status.refetch();
								refresh();
							}}>
							Refresh this request
						</Button>
					)}
					{current?.canConfirm && currentActionEnabled && (
						<Button
							variant='contained'
							disabled={
								!currentActionEnabled ||
								busy ||
								!consent ||
								Boolean(status.error) ||
								status.isFetching
							}
							onClick={() =>
								confirm.mutate({
									operationId: current.operationId,
								})
							}>
							{confirm.isPending ?
								'Confirming…'
							:	'Confirm this change'}
						</Button>
					)}
				</DialogActions>
			</Dialog>
		</Panel>
	);
}
