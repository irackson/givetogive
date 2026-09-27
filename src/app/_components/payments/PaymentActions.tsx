'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
} from '@mui/material';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';

export function SupportCheckoutButton({
	tier,
	enabled,
	signedIn,
	current = false,
}: {
	tier: 'supporter' | 'sustainer';
	enabled: boolean;
	signedIn: boolean;
	current?: boolean;
}) {
	const operationId = useRef<string | null>(null);
	const [redirecting, setRedirecting] = useState(false);
	const checkout = api.billing.createCheckout.useMutation({
		onSuccess: ({ url }) => {
			setRedirecting(true);
			window.location.assign(url);
		},
	});
	if (!signedIn)
		return (
			<Button
				component={Link}
				href='/signin?callbackUrl=/support'
				variant='contained'
				fullWidth>
				Sign in to become a {tier}
			</Button>
		);
	if (current)
		return (
			<Button
				component={Link}
				href='/account/billing'
				variant='outlined'
				fullWidth>
				Manage your membership
			</Button>
		);
	return (
		<div className='payment-stack'>
			{checkout.error && (
				<Alert severity='error'>{checkout.error.message}</Alert>
			)}
			<Button
				variant='contained'
				fullWidth
				disabled={!enabled || checkout.isPending || redirecting}
				onClick={() => {
					operationId.current ??= crypto.randomUUID();
					checkout.mutate({
						operationId: operationId.current,
						kind: 'supporter',
						tier,
					});
				}}>
				{checkout.isPending || redirecting ?
					'Opening secure checkout…'
				: enabled ?
					`Become a ${tier}`
				:	'Subscriptions not yet available'}
			</Button>
		</div>
	);
}

export function BillingPortalButton({
	disabled = false,
}: {
	disabled?: boolean;
}) {
	const portal = api.billing.createPortal.useMutation({
		onSuccess: ({ url }) => window.location.assign(url),
	});
	return (
		<div className='payment-stack'>
			{portal.error && (
				<Alert severity='error'>{portal.error.message}</Alert>
			)}
			<Button
				variant='contained'
				disabled={disabled || portal.isPending}
				onClick={() => portal.mutate()}>
				{portal.isPending ?
					'Opening billing…'
				:	'Payment details & invoices'}
			</Button>
		</div>
	);
}

/** A cancel-only, server-owned fund handoff. Creating/returning from the portal
 * never changes the displayed renewal state; only reconciled provider state can. */
export function FundCancellationButton({
	subscriptionId,
	fundName,
	disabled = false,
}: {
	subscriptionId: string;
	fundName: string;
	disabled?: boolean;
}) {
	const titleId = useId();
	const [open, setOpen] = useState(false);
	const [redirecting, setRedirecting] = useState(false);
	const cancellation = api.billing.createFundCancellationPortal.useMutation({
		onSuccess: ({ url }) => {
			setRedirecting(true);
			window.location.assign(url);
		},
	});
	const busy = cancellation.isPending || redirecting;
	return (
		<>
			<Button
				variant='outlined'
				size='small'
				disabled={disabled || busy}
				aria-label={`Cancel renewal for ${fundName}`}
				onClick={() => {
					cancellation.reset();
					setOpen(true);
				}}>
				Cancel renewal
			</Button>
			{disabled && (
				<small>Cancellation setup is not yet available.</small>
			)}
			<Dialog
				open={open}
				onClose={() => {
					if (!busy) setOpen(false);
				}}
				aria-labelledby={titleId}
				fullWidth
				maxWidth='sm'>
				<DialogTitle id={titleId}>
					Cancel renewal for {fundName}?
				</DialogTitle>
				<DialogContent className='payment-stack'>
					<p>
						You’ll review this recurring fund gift in Stripe.
						Confirm there to stop renewal at the end of its current
						billing period.
					</p>
					<p>
						No refund or new charge is requested here. This opens
						cancellation for this fund gift only, not your general
						payment settings.
					</p>
					<p className='payment-note'>
						Returning to GiveToGive does not by itself confirm
						cancellation. Your renewal status changes only after
						Stripe’s confirmation has been reconciled.
					</p>
					{cancellation.error && (
						<Alert severity='error'>
							{cancellation.error.message}
						</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button
						disabled={busy}
						onClick={() => setOpen(false)}>
						Go back
					</Button>
					<Button
						variant='contained'
						disabled={disabled || busy}
						onClick={() => cancellation.mutate({ subscriptionId })}>
						{busy ?
							'Opening Stripe cancellation…'
						:	'Continue to Stripe cancellation'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}

export function RecipientDashboardButton() {
	const dashboard = api.billing.createRecipientDashboardLink.useMutation({
		onSuccess: ({ url }) => window.location.assign(url),
	});
	return (
		<div className='payment-stack'>
			{dashboard.error && (
				<Alert severity='error'>{dashboard.error.message}</Alert>
			)}
			<Button
				variant='outlined'
				disabled={dashboard.isPending}
				onClick={() => dashboard.mutate()}>
				{dashboard.isPending ?
					'Opening Stripe…'
				:	'Open Stripe Express dashboard'}
			</Button>
		</div>
	);
}

export function PrintReceiptButton() {
	return (
		<Button
			variant='outlined'
			className='payment-no-print'
			onClick={() => window.print()}>
			Print / save receipt
		</Button>
	);
}
