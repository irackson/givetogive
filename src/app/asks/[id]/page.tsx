import { notFound } from 'next/navigation';
import { Container, Typography, Button, Box } from '@mui/material';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';

export default async function AskDetailPage({
	params,
}: {
	params: { id: string };
}) {
	const asks = [
		{
			id: 1,
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
	];

	const ask = asks.find((ask) => ask.id === Number(params.id));

	if (!ask) return notFound();

	return (
		<Container sx={{ py: 4 }}>
			<Typography variant="h4" component="h1" gutterBottom>
				{ask.title}
			</Typography>
			<Typography variant="body1" paragraph>
				{ask.description}
			</Typography>
			<Box mt={4}>
				<Button
					variant="contained"
					color="success"
					size="large"
					startIcon={<VolunteerActivismIcon />}
				>
					Offer Help
				</Button>
			</Box>
		</Container>
	);
}
