'use client';

import { setAdminElevation } from '@/lib/admin-elevation';
import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
} from '@mui/material';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Panel, PaymentLoading, StatusPill } from './PaymentPrimitives';

export function SecuritySettings() {
	const me = api.security.me.useQuery();
	const utils = api.useUtils();
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');
	const [enrollment, setEnrollment] = useState<{
		secret: string;
		uri: string;
	} | null>(null);
	const [revokeOpen, setRevokeOpen] = useState(false);
	const begin = api.security.beginTotp.useMutation({
		onSuccess: (data) => {
			setEnrollment(data);
		},
	});
	const confirm = api.security.confirmTotp.useMutation({
		onSuccess: () => {
			setEnrollment(null);
			setCode('');
			setPassword('');
			begin.reset();
			void utils.security.me.invalidate();
		},
	});
	const revoke = api.security.revokeSessions.useMutation({
		onSuccess: () => {
			setAdminElevation(null);
			void signOut({ callbackUrl: '/signin' });
		},
	});
	if (me.isPending)
		return <PaymentLoading label='Loading account security' />;
	if (me.error) return <Alert severity='error'>{me.error.message}</Alert>;
	return (
		<div className='payment-stack'>
			<Panel
				title='An extra layer of care.'
				action={
					<StatusPill
						status={me.data.totpEnabled ? 'enabled' : 'not_enabled'}
					/>
				}>
				<p className='payment-muted'>
					An authenticator code protects sensitive administrative
					actions. It is required before live money can be refunded or
					allocated. Your authenticator secret stays out of activity
					logs.
				</p>
				{!me.data.totpEnabled && !enrollment && (
					<div className='payment-form'>
						{!me.data.recentAuthentication && (
							<TextField
								label='Current password'
								type='password'
								autoComplete='current-password'
								value={password}
								onChange={(event) =>
									setPassword(event.target.value)
								}
								helperText='Confirm your password, or sign in again with your account provider.'
							/>
						)}
						{begin.error && (
							<Alert severity='error'>
								{begin.error.message}
							</Alert>
						)}
						<div>
							<Button
								variant='contained'
								disabled={begin.isPending}
								onClick={() =>
									begin.mutate(password ? { password } : {})
								}>
								{begin.isPending ?
									'Preparing…'
								:	'Set up authenticator'}
							</Button>
						</div>
					</div>
				)}
				{enrollment && (
					<div className='payment-form'>
						<Alert severity='warning'>
							Add this private setup key to your authenticator. Do
							not share it or include it in screenshots.
						</Alert>
						<TextField
							label='Authenticator setup key'
							value={enrollment.secret}
							inputProps={{ readOnly: true }}
						/>
						<a
							className='text-link'
							href={enrollment.uri}>
							Open in your authenticator app ↗
						</a>
						<TextField
							label='Six-digit authenticator code'
							value={code}
							onChange={(event) =>
								setCode(
									event.target.value
										.replace(/\D/g, '')
										.slice(0, 6),
								)
							}
							inputProps={{
								inputMode: 'numeric',
								autoComplete: 'one-time-code',
								pattern: '[0-9]{6}',
							}}
						/>
						{confirm.error && (
							<Alert severity='error'>
								{confirm.error.message}
							</Alert>
						)}
						<div className='payment-actions'>
							<Button
								variant='contained'
								disabled={
									code.length !== 6 || confirm.isPending
								}
								onClick={() =>
									confirm.mutate({
										code,
										...(password ? { password } : {}),
									})
								}>
								{confirm.isPending ?
									'Confirming…'
								:	'Confirm authenticator'}
							</Button>
							<Button
								disabled={confirm.isPending}
								onClick={() => {
									setEnrollment(null);
									setCode('');
								}}>
								Cancel setup
							</Button>
						</div>
					</div>
				)}
				{me.data.totpEnabled && (
					<Alert severity='success'>
						Your authenticator is enabled. Keep access to your
						authenticator app safe.
					</Alert>
				)}
			</Panel>
			{me.data.role === 'admin' && (
				<Panel title='Confirm sensitive actions.'>
					<p className='payment-muted'>
						Elevated access is short-lived and kept only in this
						browser tab’s memory. Refreshing or signing out clears
						it.
					</p>
					<AdminElevation />
				</Panel>
			)}
			<Panel title='Sign out everywhere.'>
				<p className='payment-muted'>
					If you no longer trust a signed-in device, revoke your
					sessions and issued agent tokens. This also signs you out
					here; you will need to sign in again.
				</p>
				{revoke.error && (
					<Alert severity='error'>{revoke.error.message}</Alert>
				)}
				<Button
					variant='outlined'
					color='error'
					onClick={() => setRevokeOpen(true)}>
					Revoke all sessions
				</Button>
			</Panel>
			<Dialog
				open={revokeOpen}
				onClose={() => {
					if (!revoke.isPending) setRevokeOpen(false);
				}}
				aria-labelledby='revoke-sessions-title'
				maxWidth='sm'
				fullWidth>
				<DialogTitle id='revoke-sessions-title'>
					Sign out on every device?
				</DialogTitle>
				<DialogContent>
					Your existing sessions and issued agent tokens will stop
					working. Active automations using those tokens will need new
					credentials.
				</DialogContent>
				<DialogActions>
					<Button
						disabled={revoke.isPending}
						onClick={() => setRevokeOpen(false)}>
						Keep sessions
					</Button>
					<Button
						color='error'
						variant='contained'
						disabled={revoke.isPending}
						onClick={() => revoke.mutate()}>
						{revoke.isPending ? 'Revoking…' : 'Revoke and sign out'}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}

export function AdminElevation() {
	const me = api.security.me.useQuery();
	const [code, setCode] = useState('');
	const [password, setPassword] = useState('');
	const [expiresAt, setExpiresAt] = useState<Date | null>(null);
	const [expired, setExpired] = useState(false);
	useEffect(() => {
		if (!expiresAt) return;
		const timeout = window.setTimeout(
			() => {
				setExpired(true);
				setAdminElevation(null);
			},
			Math.max(0, expiresAt.getTime() - Date.now()),
		);
		return () => window.clearTimeout(timeout);
	}, [expiresAt]);
	const elevate = api.security.elevate.useMutation({
		onSuccess: (data) => {
			setAdminElevation(data.token);
			setExpiresAt(data.expiresAt);
			setExpired(false);
			setCode('');
			setPassword('');
		},
	});
	if (me.isPending)
		return <PaymentLoading label='Checking administrator security' />;
	if (me.error) return <Alert severity='error'>{me.error.message}</Alert>;
	if (!me.data.totpEnabled)
		return (
			<Alert severity='info'>
				Set up your authenticator in Account security before elevating
				administrator access.
			</Alert>
		);
	return (
		<form
			className='payment-form'
			onSubmit={(event) => {
				event.preventDefault();
				elevate.mutate({ code, ...(password ? { password } : {}) });
			}}>
			{expired && (
				<Alert severity='info'>
					Sensitive-action authorization has expired. Confirm a new
					authenticator code to continue.
				</Alert>
			)}
			{expiresAt && !expired && (
				<Alert severity='success'>
					Sensitive actions authorized until{' '}
					{new Date(expiresAt).toLocaleTimeString()}. Server
					authorization is checked for every action.
				</Alert>
			)}
			{!me.data.recentAuthentication && (
				<TextField
					label='Current password'
					type='password'
					autoComplete='current-password'
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			)}
			<TextField
				label='Authenticator code'
				value={code}
				onChange={(event) =>
					setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
				}
				inputProps={{
					inputMode: 'numeric',
					autoComplete: 'one-time-code',
					pattern: '[0-9]{6}',
				}}
			/>
			{elevate.error && (
				<Alert severity='error'>{elevate.error.message}</Alert>
			)}
			<div>
				<Button
					type='submit'
					variant='outlined'
					disabled={code.length !== 6 || elevate.isPending}>
					{elevate.isPending ?
						'Verifying…'
					:	'Authorize sensitive actions'}
				</Button>
			</div>
		</form>
	);
}
