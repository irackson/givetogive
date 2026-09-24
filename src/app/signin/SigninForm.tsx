'use client';

import { AuthFrame } from '@/app/_components/AuthFrame';
import { Alert, Box, Button, Divider, Stack, TextField } from '@mui/material';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function SigninForm({ callbackUrl }: { callbackUrl: string }) {
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setPending(true);
		setError(undefined);
		try {
			const result = await signIn('credentials', {
				email,
				password,
				redirect: false,
				redirectTo: callbackUrl,
			});
			if (result?.error) {
				setError(
					'Sign-in failed. Check your credentials and verify your email.',
				);
				return;
			}
			router.push(callbackUrl);
			router.refresh();
		} finally {
			setPending(false);
		}
	};

	return (
		<AuthFrame
			variant='signin'
			eyebrow='Good to see you'
			title='Come back into the circle.'
			description='Sign in to post a need, keep track of your contributions, and respond when a neighbor could use you.'>
			<Box
				component='form'
				onSubmit={(event) => void handleSubmit(event)}
				className='auth-form'>
				<Stack spacing={2}>
					<TextField
						label='Email'
						type='email'
						autoComplete='email'
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
					<TextField
						label='Password'
						type='password'
						autoComplete='current-password'
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
					{error && <Alert severity='error'>{error}</Alert>}
					<Button
						type='submit'
						variant='contained'
						color='primary'
						disabled={pending}>
						{pending ? 'Signing you in...' : 'Sign in'}
					</Button>
					<div className='auth-inline-links'>
						<Button href='/forgot-password'>
							Forgot password?
						</Button>
						<Button href='/verify-email'>
							Resend verification
						</Button>
					</div>
					<Divider className='auth-divider'>
						or use a connected account
					</Divider>
					<Button
						variant='outlined'
						onClick={() =>
							void signIn('discord', { redirectTo: callbackUrl })
						}>
						Continue with Discord
					</Button>
					<p className='auth-footnote'>
						New here? <a href='/signup'>Make your free account.</a>
					</p>
				</Stack>
			</Box>
		</AuthFrame>
	);
}
