import { getServerAuthSession } from '@/server/auth';
import { api, HydrateClient } from '@/trpc/server';
import { Box, Container, Typography } from '@mui/material';

import { CreateAskFormToggle } from './_components/CreateAskFormToggle';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage() {
	const session = await getServerAuthSession();

	await api.ask.getAsks.prefetch({});

	return (
		<HydrateClient>
			<Container sx={{ py: 4 }}>
				<Typography
					variant='h4'
					component='h1'
					align='center'
					gutterBottom>
					Community Asks
				</Typography>
				<Typography
					align='center'
					color='text.secondary'>
					Offer what you can. Every partial contribution moves an Ask
					closer to its goal.
				</Typography>
				<Box
					display='flex'
					justifyContent='center'
					my={2}>
					<CreateAskFormToggle
						isAuthenticated={Boolean(session?.user)}
					/>
				</Box>
				<RenderAsksIndex />
			</Container>
		</HydrateClient>
	);
}
