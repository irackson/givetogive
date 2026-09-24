'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Box,
	Button,
	Container,
	Link,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState('');
	const requestReset = api.user.requestPasswordReset.useMutation();

	return (
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					requestReset.mutate({ email });
				}}
				sx={{ py: 4 }}>
				<Stack spacing={2}>
					<Typography
						component='h1'
						variant='h4'>
						Reset your password
					</Typography>
					<Typography color='text.secondary'>
						Enter your email and we will send a time-limited reset
						link.
					</Typography>
					<TextField
						label='Email'
						type='email'
						autoComplete='email'
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
					{requestReset.error && (
						<Alert severity='error'>
							{requestReset.error.message}
						</Alert>
					)}
					{requestReset.data && (
						<Alert severity='success'>
							{requestReset.data.message}
							{requestReset.data.previewUrl && (
								<>
									<br />
									<Link href={requestReset.data.previewUrl}>
										Open the development reset link
									</Link>
								</>
							)}
						</Alert>
					)}
					<Button
						type='submit'
						variant='contained'
						disabled={requestReset.isPending}>
						{requestReset.isPending ?
							'Sending...'
						:	'Send reset link'}
					</Button>
					<Button href='/signin'>Back to sign in</Button>
				</Stack>
			</Box>
		</Container>
	);
}
