import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { environmentIdentity } from '@/server/db/operations-schema';
import { simulationTarget } from '@/lib/environment';

export async function assertSimulationEnvironment() {
	const target = simulationTarget();
	const marker = await db.query.environmentIdentity.findFirst({
		where: eq(environmentIdentity.id, 1),
	});
	const [database] = await db
		.select({ name: sql<string>`current_database()` })
		.from(environmentIdentity)
		.limit(1);
	if (
		!marker ||
		marker.environment !== 'staging' ||
		marker.identity !== target.databaseIdentity ||
		marker.databaseName !== database?.name
	) {
		throw new Error(
			'Simulation database identity mismatch. Refusing to run.',
		);
	}
	return target;
}
