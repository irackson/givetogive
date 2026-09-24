'use client';

import { AuthFrame } from '@/app/_components/AuthFrame';
import { api } from '@/trpc/react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';

export function ResetPasswordForm({ token }: { token: string }) {
	const [password, setPassword] = useState('');
	const resetPassword = api.user.resetPassword.useMutation();

	return (
		<AuthFrame
			variant='reset'
			eyebrow='Reset password'
			title='Choose a new key.'
			description='Use a password you can return to easily. We will take care of the rest.'>
			<Box
				component='form'
				className='auth-form'
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					resetPassword.mutate({ token, password });
				}}>
				<Stack spacing={2}>
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
					<p className='auth-footnote'>
						<a href='/signin'>Back to sign in.</a>
					</p>
				</Stack>
			</Box>
		</AuthFrame>
	);
}
