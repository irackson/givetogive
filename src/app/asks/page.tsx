import { Container, Typography } from '@mui/material';
import { RenderAsksIndex } from 'code/app/_components/ask';
import { getServerAuthSession } from 'code/server/auth';

export default async function AsksIndexPage() {
	// Fetch session to get the logged-in user's ID
	const session = await getServerAuthSession();
	const userId = session?.user?.id; // `userId` is defined if the user is logged in

	return (
		<Container sx={{ py: 4 }}>
			<Typography variant="h4" component="h1" align="center" gutterBottom>
				Open Requests
			</Typography>
			{/* Pass `userId` as `createdByUserId` if the user is logged in */}
			<RenderAsksIndex createdByUserId={userId} />
		</Container>
	);
}
