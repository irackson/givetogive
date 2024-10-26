import Link from 'next/link';
import {
	Container,
	Box,
	Card,
	CardContent,
	Typography,
	Button,
} from '@mui/material';

export default async function AsksIndexPage() {
	const asks = [
		{
			id: 1,
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
		{
			id: 2,
			title: 'Need help with moving',
			description:
				'I need help moving some furniture around my apartment.',
		},
		{
			id: 3,
			title: 'Looking for someone to talk to',
			description: 'Feeling lonely and would love a friendly chat!',
		},
		{
			id: 4,
			title: 'Help with yard work',
			description: 'My yard needs some serious cleanup. Any volunteers?',
		},
		{
			id: 5,
			title: 'Assist with tech setup',
			description: 'Need help setting up a new phone and computer.',
		},
	];

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
								href={`/asks/${ask.id}`}
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
