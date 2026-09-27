'use client';

import { Alert, Button } from '@mui/material';
export default function AdminError({ reset }: { reset: () => void }) {
	return (
		<div className='payment-stack'>
			<Alert severity='error'>
				Operations data could not be loaded. Values are unavailable, not
				zero. No administrative action has been confirmed.
			</Alert>
			<div>
				<Button
					variant='outlined'
					onClick={reset}>
					Reload operations data
				</Button>
			</div>
		</div>
	);
}
