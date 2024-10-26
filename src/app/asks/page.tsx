import Link from 'next/link';
import {
	Container,
	Box,
	Card,
	CardContent,
	Typography,
	Button,
} from '@mui/material';
import { api } from 'code/trpc/server';

export default async function AsksIndexPage({
	createdById,
}: {
	createdById?: string;
}) {
	const asks = await api.ask.getAsks({ createdById });

	return (
		<Container sx={{ py: 4 }}>
			<Typography variant="h4" component="h1" align="center" gutterBottom>
				Open Requests
			</Typography>
			<Box
				display="flex"
				flexWrap="wrap"
				justifyContent="center"
				gap={4}
				mt={2}
			>
				{asks.map((ask) => (
					<Card
						key={ask.id}
						sx={{
							width: 300,
							display: 'flex',
							flexDirection: 'column',
						}}
					>
						<CardContent>
							<Typography variant="h5" component="h2">
								{ask.title}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								{ask.description}
							</Typography>
							<Button
								variant="contained"
								component={Link}
								href={`/asks/${ask.slug}`}
								sx={{ mt: 2 }}
							>
								View Details
							</Button>
						</CardContent>
					</Card>
				))}
			</Box>
		</Container>
	);
}
