import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/server/db/index.ts';
import {
	apiTokens,
	simulationAgents,
	simulationRuns,
} from '../../src/server/db/operations-schema.ts';
import { users } from '../../src/server/db/schema.ts';
import { clearRateLimit } from '../../src/server/auth/rate-limit.ts';

export async function assertCiSimulationDatabase() {
	assert.equal(process.env['APP_ENV'], 'test');
	assert.equal(
		decodeURIComponent(
			new URL(process.env['DATABASE_URL'] ?? '').pathname.slice(1),
		),
		'givetogive_ci_20260926',
	);
	const [identity] = await db.execute<{ name: string; role: string }>(
		sql`select current_database() as name, current_user as role`,
	);
	assert.equal(identity?.name, 'givetogive_ci_20260926');
	assert.equal(identity?.role, 'givetogive_ci_20260926');
}

/** Preserve append-only evidence, but revoke every test credential and freeze its exact synthetic actors. */
export async function retireCiSimulationFixture(runId: string) {
	await assertCiSimulationDatabase();
	assert.match(runId, /^ci-mcp-[0-9a-f-]{36}$/);
	const run = await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, runId),
	});
	if (!run) return;
	assert.equal(run.databaseIdentity, runId);
	const tokens = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.runId, runId));
	for (const token of tokens)
		await clearRateLimit(
			`simulation-${token.kind}`,
			token.id,
			new Headers(),
		);
	const members = await db
		.select({ userId: simulationAgents.userId })
		.from(simulationAgents)
		.where(eq(simulationAgents.runId, runId));
	const userIds = [
		...members.map((member) => member.userId),
		run.createdById,
	];
	await db.transaction(async (tx) => {
		await tx
			.update(apiTokens)
			.set({ revokedAt: new Date(), expiresAt: new Date() })
			.where(eq(apiTokens.runId, runId));
		await tx
			.update(users)
			.set({
				frozenAt: new Date(),
				sessionVersion: sql`${users.sessionVersion} + 1`,
			})
			.where(inArray(users.id, userIds));
		await tx
			.update(simulationRuns)
			.set({ status: 'completed', finishedAt: new Date() })
			.where(eq(simulationRuns.id, runId));
	});
}
