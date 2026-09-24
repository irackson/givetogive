'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Container,
	Link,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export function VerifyEmail({ token }: { token: string }) {
	const started = useRef(false);
	const [email, setEmail] = useState('');
	const verify = api.user.verifyEmail.useMutation();
	const resend = api.user.resendVerification.useMutation();

	useEffect(() => {
		if (token && !started.current) {
			started.current = true;
			verify.mutate({ token });
		}
	}, [token, verify]);

	if (token) {
		return (
			<Container maxWidth='sm'>
				<Stack
					spacing={2}
					alignItems='center'
					sx={{ py: 6 }}>
					<Typography
						component='h1'
						variant='h4'>
						Verify your email
					</Typography>
					{verify.isPending && (
						<>
							<CircularProgress />
							<Typography>Verifying...</Typography>
						</>
					)}
					{verify.error && (
						<Alert severity='error'>{verify.error.message}</Alert>
					)}
					{verify.data && (
						<Alert severity='success'>
							Email verified. You can now sign in.
						</Alert>
					)}
					<Button
						href='/signin'
						variant='contained'>
						Continue to sign in
					</Button>
				</Stack>
			</Container>
		);
	}

	return (
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					resend.mutate({ email });
				}}
				sx={{ py: 4 }}>
				<Stack spacing={2}>
					<Typography
						component='h1'
						variant='h4'>
						Resend verification
					</Typography>
					<Typography color='text.secondary'>
						Enter your email to request a new verification link.
					</Typography>
					<TextField
						label='Email'
						type='email'
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
					{resend.error && (
						<Alert severity='error'>{resend.error.message}</Alert>
					)}
					{resend.data && (
						<Alert severity='success'>
							{resend.data.message}
							{resend.data.previewUrl && (
								<>
									<br />
									<Link href={resend.data.previewUrl}>
										Open the development verification link
									</Link>
								</>
							)}
						</Alert>
					)}
					<Button
						type='submit'
						variant='contained'
						disabled={resend.isPending}>
						{resend.isPending ?
							'Sending...'
						:	'Send verification link'}
					</Button>
					<Button href='/signin'>Back to sign in</Button>
				</Stack>
			</Box>
		</Container>
	);
}
