'use client';

import { AuthFrame } from '@/app/_components/AuthFrame';
import { api } from '@/trpc/react';
import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState('');
	const requestReset = api.user.requestPasswordReset.useMutation();

	return (
		<AuthFrame
			variant='recovery'
			eyebrow='A fresh start'
			title='Let’s get you back in.'
			description='Enter your email and we will send a time-limited link to choose a new password.'>
			<Box
				component='form'
				className='auth-form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					requestReset.mutate({ email });
				}}>
				<Stack spacing={2}>
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
					<p className='auth-footnote'>
						<a href='/signin'>Back to sign in.</a>
					</p>
				</Stack>
			</Box>
		</AuthFrame>
	);
}
