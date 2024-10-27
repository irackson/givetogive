import { Container, Typography } from '@mui/material';
import { getServerAuthSession } from 'code/server/auth';
import { RenderAsksIndex } from './_components/RenderAsksIndex';

export default async function AsksIndexPage() {
	const session = await getServerAuthSession();
	const userId = session?.user?.id;

	return (
		<Container sx={{ py: 4 }}>
			<Typography variant="h4" component="h1" align="center" gutterBottom>
				{userId ? `Your Requests` : `All Requests`}
			</Typography>
			<RenderAsksIndex createdById={userId} />
		</Container>
	);
}
