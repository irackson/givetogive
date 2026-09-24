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

export default function SignupPage() {
	const [email, setEmail] = useState('');
	const [name, setName] = useState('');
	const [password, setPassword] = useState('');
	const register = api.user.register.useMutation();

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		register.mutate({ email, name, password });
	};

	return (
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={handleSubmit}
				sx={{ py: 4 }}>
				<Stack spacing={2}>
					<Typography
						component='h1'
						variant='h4'>
						Create an account
					</Typography>
					<Typography color='text.secondary'>
						Join the community to ask for help or contribute to an
						Ask.
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
						helperText='Use 8 to 128 characters.'
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
					{register.data && (
						<Alert severity='success'>
							Account created.{' '}
							{register.data.emailDelivered ?
								'Check your email for a verification link.'
							:	'Email delivery is not configured yet.'}
							{register.data.verificationUrl && (
								<>
									<br />
									<Link href={register.data.verificationUrl}>
										Open the development verification link
									</Link>
								</>
							)}
						</Alert>
					)}
					<Button
						disabled={register.isPending || Boolean(register.data)}
						type='submit'
						variant='contained'>
						{register.isPending ?
							'Creating account...'
						:	'Create account'}
					</Button>
					<Button href='/signin'>Already have an account?</Button>
				</Stack>
			</Box>
		</Container>
	);
}
