import { getServerAuthSession } from '@/server/auth';
import { HydrateClient } from '@/trpc/server';
import { Box, Button, Typography } from '@mui/material';

export default async function Home() {
	const session = await getServerAuthSession();

	return (
		<HydrateClient>
			<Box
				display='flex'
				flexDirection='column'
				alignItems='center'
				justifyContent='center'
				minHeight='calc(100vh - 64px)'
				py={4}>
				{session && (
					<Typography
						variant='h6'
						gutterBottom>
						Logged in as {session.user?.name}
					</Typography>
				)}
				<Button
					href={session ? '/api/auth/signout' : '/signin'}
					variant='contained'
					color='secondary'
					sx={{ mt: 2 }}>
					{session ? 'Sign out' : 'Sign in'}
				</Button>
				{!session && (
					<Button
						href='/signup'
						variant='outlined'
						color='secondary'
						sx={{ mt: 2 }}>
						Create account
					</Button>
				)}
			</Box>
		</HydrateClient>
	);
}
