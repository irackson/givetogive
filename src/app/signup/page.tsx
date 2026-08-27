'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Box,
	Button,
	Container,
	TextField,
	Typography,
} from '@mui/material';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';

export default function SignupPage() {
	const [email, setEmail] = useState('');
	const [name, setName] = useState('');
	const [password, setPassword] = useState('');
	const register = api.user.register.useMutation();

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		try {
			await register.mutateAsync({ email, name, password });
		} catch {
			return;
		}

		await signIn('credentials', {
			email,
			password,
			redirectTo: '/',
		});
	};

	return (
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={(event) => void handleSubmit(event)}
				sx={{
					display: 'flex',
					flexDirection: 'column',
					gap: 2,
					py: 4,
				}}>
				<Typography
					component='h1'
					variant='h4'>
					Create an account
				</Typography>
				<TextField
					autoComplete='name'
					label='Name'
					onChange={(event) => setName(event.target.value)}
					required
					value={name}
				/>
				<TextField
					autoComplete='email'
					label='Email'
					onChange={(event) => setEmail(event.target.value)}
					required
					type='email'
					value={email}
				/>
				<TextField
					autoComplete='new-password'
					helperText='Use at least 8 characters.'
					inputProps={{ minLength: 8, maxLength: 128 }}
					label='Password'
					onChange={(event) => setPassword(event.target.value)}
					required
					type='password'
					value={password}
				/>
				{register.error && (
					<Alert severity='error'>{register.error.message}</Alert>
				)}
				<Button
					disabled={register.isPending}
					type='submit'
					variant='contained'>
					{register.isPending ?
						'Creating account…'
					:	'Create account'}
				</Button>
				<Button href='/api/auth/signin'>
					Already have an account?
				</Button>
			</Box>
		</Container>
	);
}
