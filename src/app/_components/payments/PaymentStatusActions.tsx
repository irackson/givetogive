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
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function PaymentStatusActions({
	id,
	pending,
	cancellable,
}: {
	id: string;
	pending: boolean;
	cancellable: boolean;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const cancel = api.billing.cancelCheckout.useMutation({
		onSuccess: () => {
			setOpen(false);
			router.refresh();
		},
	});
	useEffect(() => {
		if (!pending) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') router.refresh();
		}, 5000);
		return () => clearInterval(timer);
	}, [pending, router]);
	return (
		<div className='payment-stack'>
			{cancel.error && (
				<Alert severity='error'>{cancel.error.message}</Alert>
			)}
			{cancel.data && (
				<Alert severity={cancel.data.canceled ? 'info' : 'warning'}>
					{cancel.data.canceled ?
						'The unfinished Checkout has been canceled. The updated payment record shows its confirmed status.'
					:	'This Checkout already completed. Cancellation cannot undo a submitted payment; wait for the confirmed outcome.'
					}
				</Alert>
			)}
			<div className='payment-actions'>
				{pending && (
					<Button
						variant='outlined'
						disabled={waiting}
						onClick={() => {
							setWaiting(true);
							router.refresh();
							setTimeout(() => setWaiting(false), 1500);
						}}>
						{waiting ? 'Checking…' : 'Refresh payment status'}
					</Button>
				)}
				{cancellable && (
					<Button
						variant='outlined'
						color='error'
						onClick={() => setOpen(true)}>
						Cancel unfinished Checkout
					</Button>
				)}
			</div>
			<Dialog
				open={open}
				onClose={() => {
					if (!cancel.isPending) setOpen(false);
				}}
				maxWidth='sm'
				fullWidth
				aria-labelledby='cancel-checkout-title'>
				<DialogTitle id='cancel-checkout-title'>
					Cancel this unfinished Checkout?
				</DialogTitle>
				<DialogContent>
					This expires an open Checkout session. It does not reverse a
					payment that was already submitted or confirmed.
				</DialogContent>
				<DialogActions>
					<Button
						disabled={cancel.isPending}
						onClick={() => setOpen(false)}>
						Keep Checkout
					</Button>
					<Button
						color='error'
						variant='contained'
						disabled={cancel.isPending}
						onClick={() => cancel.mutate({ id })}>
						{cancel.isPending ?
							'Checking with Stripe…'
						:	'Cancel unfinished Checkout'}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}
