'use client';

import { Alert, Button } from '@mui/material';
import { useEffect } from 'react';
import { PaymentPage } from './PaymentPrimitives';

export default function PaymentError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error('Payment view failed', { digest: error.digest });
	}, [error]);
	return (
		<PaymentPage
			eyebrow='A little interruption'
			title='Let’s try that again.'
			description='We could not load this view. Your payment status has not been changed.'>
			<Alert severity='error'>
				This information is temporarily unavailable. Refresh before
				starting another payment.
			</Alert>
			<div>
				<Button
					variant='contained'
					onClick={reset}>
					Try again
				</Button>
			</div>
		</PaymentPage>
	);
}
