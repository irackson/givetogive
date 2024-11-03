import { getServerAuthSession } from '@/server/auth';
import { Box, Container, Typography } from '@mui/material';

import { CreateAskFormToggle } from './_components/CreateAskFormToggle';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage() {
	const session = await getServerAuthSession();
	const userId = session?.user?.id;

	return (
		<Container sx={{ py: 4 }}>
			<Typography
				variant='h4'
				component='h1'
				align='center'
				gutterBottom>
				{userId ? `Your Requests` : `All Requests`}
			</Typography>
			<Box
				display='flex'
				justifyContent='center'
				my={2}>
				<CreateAskFormToggle />
			</Box>
			<RenderAsksIndex
				filterProps={userId ? { createdById: userId } : undefined}
			/>
		</Container>
	);
}
