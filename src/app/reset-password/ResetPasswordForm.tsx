'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Box,
	Button,
	Container,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';

export function ResetPasswordForm({ token }: { token: string }) {
	const [password, setPassword] = useState('');
	const resetPassword = api.user.resetPassword.useMutation();

	return (
		<Container maxWidth='sm'>
			<Box
				component='form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					resetPassword.mutate({ token, password });
				}}
				sx={{ py: 4 }}>
				<Stack spacing={2}>
					<Typography
						component='h1'
						variant='h4'>
						Choose a new password
					</Typography>
					{!token && (
						<Alert severity='warning'>
							Open this page from a password reset link.
						</Alert>
					)}
					<TextField
						label='New password'
						type='password'
						autoComplete='new-password'
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						inputProps={{ minLength: 8, maxLength: 128 }}
						required
						disabled={!token || Boolean(resetPassword.data)}
					/>
					{resetPassword.error && (
						<Alert severity='error'>
							{resetPassword.error.message}
						</Alert>
					)}
					{resetPassword.data && (
						<Alert severity='success'>
							Your password has been updated. You can sign in now.
						</Alert>
					)}
					<Button
						type='submit'
						variant='contained'
						disabled={
							!token ||
							resetPassword.isPending ||
							Boolean(resetPassword.data)
						}>
						{resetPassword.isPending ?
							'Updating...'
						:	'Update password'}
					</Button>
					<Button href='/signin'>Back to sign in</Button>
				</Stack>
			</Box>
		</Container>
	);
}
