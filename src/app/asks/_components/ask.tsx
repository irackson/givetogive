'use client';

import Link from 'next/link';
import { Box, Card, CardContent, Typography, Button } from '@mui/material';
import { api } from 'code/trpc/react';

type RenderAsksIndexProps = {
	createdByUserId?: string;
};

export function RenderAsksIndex({ createdByUserId }: RenderAsksIndexProps) {
	// Fetch asks with `useSuspenseQuery`, filtering by `createdByUserId` if provided
	const [asks] = api.ask.getAsks.useSuspenseQuery({
		createdById: createdByUserId,
	});

	return (
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
	);
}
