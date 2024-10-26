import { notFound } from 'next/navigation';

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
		<main className="container mx-auto px-4 py-8">
			<h1 className="mb-4 text-3xl font-bold">{ask.title}</h1>
			<p className="mb-4 text-lg">{ask.description}</p>
			{/* Add more fields here as needed, like the user who posted it, date created, etc. */}
			<button className="rounded bg-green-500 px-4 py-2 text-white">
				Offer Help
			</button>
		</main>
	);
}
