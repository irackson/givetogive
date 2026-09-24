'use client';

import {
	Alert,
	Box,
	Button,
	Container,
	Divider,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
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
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={(event) => void handleSubmit(event)}
				sx={{ py: 4 }}>
				<Stack spacing={2}>
					<Typography
						component='h1'
						variant='h4'>
						Welcome back
					</Typography>
					<Typography color='text.secondary'>
						Sign in to create Asks and support your neighbors.
					</Typography>
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
						disabled={pending}>
						{pending ? 'Signing in...' : 'Sign in'}
					</Button>
					<Button href='/forgot-password'>Forgot password?</Button>
					<Button href='/verify-email'>
						Need a new verification link?
					</Button>
					<Divider>or</Divider>
					<Button
						variant='outlined'
						onClick={() =>
							void signIn('discord', { redirectTo: callbackUrl })
						}>
						Continue with Discord
					</Button>
					<Button href='/signup'>Create an account</Button>
				</Stack>
			</Box>
		</Container>
	);
}
