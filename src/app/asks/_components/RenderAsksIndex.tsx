'use client';

import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from 'code/server/api/root';
import { api } from 'code/trpc/react';
import type { Route } from 'next';
import Link from 'next/link';

export function RenderAsksIndex({
	filterProps,
}: {
	filterProps: inferRouterInputs<AppRouter>['ask']['getAsks']['filter'];
}) {
	const [asks] = api.ask.getAsks.useSuspenseQuery(
		filterProps ?
			{
				filter: {
					createdById: filterProps.createdById,
				},
			}
		:	{},
	);

	return (
		<Box
			display='flex'
			flexWrap='wrap'
			justifyContent='center'
			gap={4}
			mt={2}>
			{asks.map((ask) => (
				<Card
					key={ask.id}
					sx={{
						width: 300,
						display: 'flex',
						flexDirection: 'column',
					}}>
					<CardContent>
						<Typography variant='h5' component='h2'>
							{ask.title}
						</Typography>
						<Typography variant='body2' color='text.secondary'>
							{ask.description}
						</Typography>
						<Link href={`/asks/${ask.slug}` as Route} passHref>
							<Button variant='contained' sx={{ mt: 2 }}>
								View Details
							</Button>
						</Link>
					</CardContent>
				</Card>
			))}
		</Box>
	);
}
