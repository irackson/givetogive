import Link from 'next/link';

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
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
		{
			id: 3,
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
		{
			id: 4,
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
		{
			id: 5,
			title: 'Need help with groceries',
			description:
				'I am unable to go out and get groceries. Can someone help me?',
		},
	];

	return (
		<main className="container mx-auto px-4 py-8">
			<h1 className="mb-6 text-center text-3xl font-semibold">
				Open Requests
			</h1>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{asks?.map((ask) => (
					<div key={ask.id} className="rounded bg-white p-4 shadow">
						<h2 className="text-xl font-bold">{ask.title}</h2>
						<p className="mt-2">{ask.description}</p>
						<Link href={`/asks/${ask.id}`}>
							<button className="mt-4 rounded bg-blue-500 px-4 py-2 text-white">
								View Details
							</button>
						</Link>
					</div>
				))}
			</div>
		</main>
	);
}
