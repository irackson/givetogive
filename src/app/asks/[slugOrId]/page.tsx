import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import { Box, Button, Container, Typography } from '@mui/material';
import { ensureErrMessage } from 'code/lib/utils/errorParsing';
import { api } from 'code/trpc/server';
import { notFound } from 'next/navigation';

export default async function AskDetailPage({
	params: { slugOrId },
}: {
	params: { slugOrId: string };
}) {
	const askQuery = isNaN(Number(slugOrId))
		? {
				slug: slugOrId,
			}
		: {
				id: Number(slugOrId),
			};

	const ask = await api.ask.getAsk({ ...askQuery }).catch((e) => {
		const { message } = ensureErrMessage(e);
		return message;
	});

	if (typeof ask === 'string') {
		return <p>{ask}</p>;
	}

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
