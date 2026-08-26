import { getServerAuthSession } from '@/server/auth';
import { api, HydrateClient } from '@/trpc/server';
import { Box, Container, Typography } from '@mui/material';

import { CreateAskFormToggle } from './_components/CreateAskFormToggle';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage() {
	const session = await getServerAuthSession();
	const userId = session?.user?.id;
	const filterProps =
		userId != undefined ? { createdById: userId } : undefined;

	await api.ask.getAsks.prefetch(
		filterProps ? { filter: filterProps } : {},
	);

	return (
		<HydrateClient>
			<Container sx={{ py: 4 }}>
				<Typography
					variant='h4'
					component='h1'
					align='center'
					gutterBottom>
					{userId != undefined ? `Your Requests` : `All Requests`}
				</Typography>
				<Box
					display='flex'
					justifyContent='center'
					my={2}>
					<CreateAskFormToggle />
				</Box>
				<RenderAsksIndex filterProps={filterProps} />
			</Container>
		</HydrateClient>
	);
}
