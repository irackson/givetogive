'use client';

import { AuthFrame } from '@/app/_components/AuthFrame';
import { api } from '@/trpc/react';
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Link,
	Stack,
	TextField,
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
			<AuthFrame
				variant='verify'
				eyebrow='One last step'
				title='Confirm your email.'
				description='This keeps the neighborhood network accountable and your account ready to use.'>
				<Stack
					spacing={2}
					className='auth-form auth-form--status'>
					{verify.isPending && (
						<>
							<CircularProgress />
							<span>Verifying your link...</span>
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
			</AuthFrame>
		);
	}

	return (
		<AuthFrame
			variant='verify'
			eyebrow='Need a new link?'
			title='Resend verification.'
			description='No verification token was included in this address. Open the complete link from your latest email; verification only needs one link. If you need a replacement, request it below. Test sites may capture links instead of sending email.'>
			<Box
				component='form'
				className='auth-form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					resend.mutate({ email });
				}}>
				<Stack spacing={2}>
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
						<Alert severity={resend.data.emailCaptured ? 'info' : 'success'}>
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
					<p className='auth-footnote'>
						<a href='/signin'>Back to sign in.</a>
					</p>
				</Stack>
			</Box>
		</AuthFrame>
	);
}
