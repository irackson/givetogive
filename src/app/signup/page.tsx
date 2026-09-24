'use client';

import { AuthFrame } from '@/app/_components/AuthFrame';
import { api } from '@/trpc/react';
import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';

export default function SignupPage() {
	const [email, setEmail] = useState('');
	const [name, setName] = useState('');
	const [password, setPassword] = useState('');
	const register = api.user.register.useMutation();

	return (
		<AuthFrame
			variant='signup'
			eyebrow='A useful place to belong'
			title='Make room for good turns.'
			description='Create an account to ask clearly, contribute in pieces, and keep the network personal.'>
			<Box
				component='form'
				className='auth-form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					register.mutate({ email, name, password });
				}}>
				<Stack spacing={2}>
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
							:	'We could not send the verification email. Please try again.'}
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
						variant='contained'
						color='secondary'>
						{register.isPending ?
							'Creating your account...'
						:	'Create account'}
					</Button>
					<p className='auth-footnote'>
						Already have a place here?{' '}
						<a href='/signin'>Sign in.</a>
					</p>
				</Stack>
			</Box>
		</AuthFrame>
	);
}
