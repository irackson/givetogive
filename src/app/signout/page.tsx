import { AuthFrame } from '@/app/_components/AuthFrame';
import { SignoutButton } from '@/app/signout/SignoutButton';
import { getBillingAuthSession, signOut } from '@/server/auth';
import { Button, Stack } from '@mui/material';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Sign out | GiveToGive',
	robots: { index: false, follow: false },
};

export default async function SignoutPage() {
	const session = await getBillingAuthSession();
	const billingOnly = session?.access === 'billing_only';

	async function endSession() {
		'use server';
		// Auth.js clears only this browser's session; Next protects the POST's origin.
		await signOut({ redirectTo: '/' });
	}

	return (
		<AuthFrame
			variant='recovery'
			eyebrow='Until next time'
			title={
				session?.user ? 'Stepping out for now?' : 'You are signed out.'
			}
			description={
				session?.user ?
					billingOnly ?
						'Sign out of restricted billing access on this browser? Your account will remain frozen.'
					:	'Your asks, saved finds, and contributions will be here when you return. Sign out of this browser?'

				:	'Thanks for being part of the circle. You can keep browsing or sign in whenever you are ready.'
			}>
			{session?.user ?
				<form
					action={endSession}
					className='auth-form'>
					<Stack spacing={2}>
						<SignoutButton />
						<Button
							href={billingOnly ? '/account/billing' : '/asks'}
							variant='outlined'>
							Stay signed in
						</Button>
					</Stack>
				</form>
			:	<Stack spacing={2}>
					<Button
						href='/signin'
						variant='contained'>
						Sign in
					</Button>
					<Button
						href='/asks'
						variant='outlined'>
						Browse asks
					</Button>
				</Stack>
			}
		</AuthFrame>
	);
}
