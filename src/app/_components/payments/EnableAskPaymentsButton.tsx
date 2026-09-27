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
import { useState } from 'react';

export function EnableAskPaymentsButton({
	askId,
	title,
	disabled,
}: {
	askId: number;
	title: string;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const enable = api.billing.enableAskPayments.useMutation({
		onSuccess: () => {
			setOpen(false);
			router.refresh();
		},
	});
	return (
		<>
			<Button
				size='small'
				variant='outlined'
				disabled={disabled}
				onClick={() => setOpen(true)}>
				Enable verified payments
			</Button>
			<Dialog
				open={open}
				onClose={() => {
					if (!enable.isPending) setOpen(false);
				}}
				fullWidth
				maxWidth='sm'
				aria-labelledby={`enable-ask-${askId}`}>
				<DialogTitle id={`enable-ask-${askId}`}>
					Receive verified payments
				</DialogTitle>
				<DialogContent>
					<p>
						<strong>{title}</strong> will accept Stripe-backed
						contributions toward its net recipient goal.
					</p>
					<p className='payment-muted'>
						Only eligible USD money Asks without legacy pledges can
						enroll. Existing off-platform records will never be
						converted into payments. Donors see the 5% platform fee
						and processing deduction before Checkout.
					</p>
					{enable.error && (
						<Alert severity='error'>{enable.error.message}</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button
						disabled={enable.isPending}
						onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant='contained'
						disabled={enable.isPending}
						onClick={() => enable.mutate({ askId })}>
						{enable.isPending ?
							'Enabling…'
						:	'Enable verified payments'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
