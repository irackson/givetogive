import 'server-only';
import { db } from '@/server/db';
import { operationEvents } from '@/server/db/operations-schema';
import { applicationEnvironment } from '@/lib/environment';
import { redactDetails, redactText } from '@/lib/redaction';

type Executor = Pick<typeof db, 'insert'>;
type EventInput = Omit<typeof operationEvents.$inferInsert, 'id' | 'environment'>;

export async function recordEvent(event: EventInput, tx: Executor = db) {
	const [record] = await tx.insert(operationEvents).values({
		...event,
		environment: applicationEnvironment(),
		summary: event.summary ? redactText(event.summary).slice(0, 500) : null,
		details: redactDetails(event.details ?? {}),
	}).onConflictDoNothing({ target: operationEvents.externalId }).returning({ id: operationEvents.id });
	return record?.id;
}
