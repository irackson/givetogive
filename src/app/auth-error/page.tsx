import { AuthFrame } from '@/app/_components/AuthFrame';
import { Button, Stack } from '@mui/material';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Sign-in help | GiveToGive',
	robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
	return (
		<AuthFrame
			variant='reset'
			eyebrow='A small detour'
			title='Let’s try that again.'
			description='We could not finish signing you in. The connection may have expired or been interrupted. Try again, or use your email and password.'>
			<Stack spacing={2}>
				<Button href='/signin' variant='contained'>Back to sign in</Button>
				<Button href='/asks' variant='outlined'>Browse asks</Button>
				<p className='auth-footnote'>
					Forgot your password? <a href='/forgot-password'>Reset it here.</a>
				</p>
			</Stack>
		</AuthFrame>
	);
}
