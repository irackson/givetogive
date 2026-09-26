'use client';

import { Button } from '@mui/material';
import { useFormStatus } from 'react-dom';

export function SignoutButton() {
	const { pending } = useFormStatus();
	return (
		<Button type='submit' variant='contained' disabled={pending}>
			{pending ? 'Signing you out…' : 'Sign out'}
		</Button>
	);
}
