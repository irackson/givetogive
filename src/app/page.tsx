import Link from 'next/link';
import { LatestPost } from 'code/app/_components/post';
import { getServerAuthSession } from 'code/server/auth';
import { api, HydrateClient } from 'code/trpc/server';
import { Typography, Button, Box } from '@mui/material';

export default async function Home() {
	const hello = await api.post.hello({ text: 'give to give' });
	const session = await getServerAuthSession();

	void api.post.getLatest.prefetch();

	return (
		<HydrateClient>
			<Box
				display="flex"
				flexDirection="column"
				alignItems="center"
				justifyContent="center"
				minHeight="calc(100vh - 64px)"
				py={4}
			>
				<Typography variant="h4" gutterBottom>
					{hello ? hello.greeting : 'Loading...'}
				</Typography>
				{session && (
					<Typography variant="h6" gutterBottom>
						Logged in as {session.user?.name}
					</Typography>
				)}
				<Button
					component={Link}
					href={session ? '/api/auth/signout' : '/api/auth/signin'}
					variant="contained"
					color="secondary"
					sx={{ mt: 2 }}
				>
					{session ? 'Sign out' : 'Sign in'}
				</Button>
				{session?.user && <LatestPost />}
			</Box>
		</HydrateClient>
	);
}
