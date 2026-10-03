/** Scoped-MCP integration on the dedicated CI database. Never targets the staging or production DB. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { and, eq, ne } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { db } from '../../src/server/db/index.ts';
import { asks, users } from '../../src/server/db/schema.ts';
import {
	apiTokens,
	operationEvents,
	simulationAgents,
	simulationRuns,
} from '../../src/server/db/operations-schema.ts';
import {
	authenticateSimulation,
	resolveSimulationCredentials,
	requireSimulationScope,
	type SimulationActor,
} from '../../src/server/simulation/auth.ts';
import {
	hashSimulationToken,
	simulationScopes,
} from '../../src/server/simulation/policy.ts';
import {
	atomicToolOperation,
	operationStatus,
} from '../../src/server/mcp/operations.ts';
import { createMemberMcpServer } from '../../src/server/mcp/server.ts';
import { ingestSimulationEvents } from '../../src/server/simulation/endpoints.ts';
import {
	changeSimulationController,
	requireControllerOwnership,
	recoverSimulationController,
	controllerRecoveryConfirmation,
} from '../../src/server/simulation/controller.ts';
import {
	assertCiSimulationDatabase,
	retireCiSimulationFixture,
} from './simulation-fixture.ts';

const runId = `ci-mcp-${randomUUID()}`;
const terminalRunId = `ci-mcp-${randomUUID()}`;
const controllerRunIds = [`ci-mcp-${randomUUID()}`, `ci-mcp-${randomUUID()}`];
const terminalTokens = [
	randomBytes(32).toString('hex'),
	randomBytes(32).toString('hex'),
];
const ids = [randomUUID(), randomUUID(), randomUUID()];
const tokenIds = [randomUUID(), randomUUID(), randomUUID()];
const rawTokens = ids.map(() => randomBytes(32).toString('hex'));
const target = {
	origin: 'https://givetogive-staging.example',
	databaseIdentity: runId,
	stripeMode: 'unconfigured' as const,
};
let fixtureReady = false;
let effectAskId: number;
const request = (index = 1, origin = target.origin) =>
	new Request(`${target.origin}/mcp`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${rawTokens[index]}`,
			Origin: origin,
		},
	});

before(async () => {
	await assertCiSimulationDatabase();
	await db.transaction(async (tx) => {
		await tx.insert(users).values(
			ids.map((id, index) => ({
				id,
				name: `CI MCP ${index}`,
				email: `${id}@example.invalid`,
				emailVerified: new Date(),
				isSynthetic: true,
				role: index === 0 ? ('admin' as const) : ('member' as const),
			})),
		);
		await tx.insert(simulationRuns).values({
			id: runId,
			name: 'CI-only scoped MCP fixture',
			createdById: ids[0]!,
			environment: 'staging',
			databaseIdentity: runId,
			agentCount: 2,
			status: 'running',
		});
		await tx.insert(simulationRuns).values({
			id: terminalRunId,
			name: 'CI terminal lifecycle fixture',
			createdById: ids[0]!,
			environment: 'staging',
			databaseIdentity: terminalRunId,
			agentCount: 1,
			status: 'running',
		});
		await tx.insert(simulationAgents).values({
			id: `${terminalRunId}-0`,
			runId: terminalRunId,
			userId: ids[1]!,
			name: 'CI terminal member',
		});
		for (const id of controllerRunIds) {
			await tx.insert(simulationRuns).values({
				id,
				name: 'CI community fencing fixture',
				createdById: ids[0]!,
				environment: 'staging',
				databaseIdentity: id,
				mode: 'scripted',
				agentCount: 1,
				status: 'created',
			});
			await tx.insert(simulationAgents).values({
				id: `${id}-0`,
				runId: id,
				userId: ids[1]!,
				name: 'CI shared controller member',
			});
		}
		await tx.insert(apiTokens).values(
			terminalTokens.map((token, index) => ({
				id: randomUUID(),
				userId: ids[index]!,
				runId: terminalRunId,
				tokenHash: hashSimulationToken(token),
				kind: index === 0 ? ('runner' as const) : ('agent' as const),
				scopes:
					index === 0 ?
						[
							simulationScopes.runnerRead,
							simulationScopes.runnerEvents,
						]
					:	[simulationScopes.read, simulationScopes.asks],
				expiresAt: new Date(Date.now() + 3600000),
			})),
		);
		await tx.insert(simulationAgents).values(
			ids.slice(1).map((userId, index) => ({
				id: `${runId}-${index}`,
				runId,
				userId,
				name: `CI member ${index}`,
			})),
		);
		await tx.insert(apiTokens).values(
			ids.map((userId, index) => ({
				id: tokenIds[index],
				userId,
				runId,
				tokenHash: hashSimulationToken(rawTokens[index]!),
				kind: index === 0 ? ('runner' as const) : ('agent' as const),
				scopes:
					index === 0 ?
						[
							simulationScopes.runnerRead,
							simulationScopes.runnerEvents,
						]
					:	[
							simulationScopes.read,
							simulationScopes.asks,
							simulationScopes.contributions,
						],
				expiresAt: new Date(Date.now() + 3600000),
			})),
		);
		const [effect] = await tx
			.insert(asks)
			.values({
				createdById: ids[1]!,
				title: 'CI transactional effect fixture',
				description: 'Original CI effect',
				slug: `effect-${runId}`,
				type: 'task',
				difficulty: 1,
				estimatedMinutesToComplete: 1,
				goalAmount: 1,
			})
			.returning({ id: asks.id });
		effectAskId = effect!.id;
	});
	fixtureReady = true;
});
after(async () => {
	try {
		if (fixtureReady) {
			await retireCiSimulationFixture(runId);
			await retireCiSimulationFixture(terminalRunId);
			for (const id of controllerRunIds)
				await retireCiSimulationFixture(id);
		}
	} finally {
		await db.$client.end();
	}
});

test('server controller fencing is atomic across hosts, journals and overlapping cohorts; uncertain ownership never expires', async () => {
	const runner = await resolveSimulationCredentials(
		request(0),
		'runner',
		target,
	);
	const run = await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, controllerRunIds[0]!),
	});
	const actor: SimulationActor = {
		...runner,
		run: run!,
		target: { ...target, databaseIdentity: run!.databaseIdentity },
	};
	const command = {
		runId: run!.id,
		controllerId: randomUUID(),
		journalId: randomUUID(),
		programDigest: 'a'.repeat(64),
		action: 'acquire' as const,
	};
	const competing = { ...command, controllerId: randomUUID() };
	const outcomes = await Promise.allSettled([
		changeSimulationController(actor, command),
		changeSimulationController(actor, competing),
	]);
	assert.equal(
		outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
		1,
	);
	let current = (await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, run!.id),
	}))!;
	const owner = current.settings['controllerId'] as string;
	const winner = { ...command, controllerId: owner };
	const loser = {
		...command,
		controllerId:
			owner === command.controllerId ?
				competing.controllerId
			:	command.controllerId,
	};
	assert.throws(() => requireControllerOwnership(current), /ownership/);
	assert.throws(
		() => requireControllerOwnership(current, loser.controllerId),
		/ownership/,
	);
	requireControllerOwnership(current, owner);
	await db
		.update(simulationRuns)
		.set({ lastHeartbeatAt: new Date(0) })
		.where(eq(simulationRuns.id, run!.id));
	await assert.rejects(changeSimulationController(actor, loser), /takeover/);
	await assert.rejects(
		changeSimulationController(actor, {
			...winner,
			journalId: randomUUID(),
		}),
		/journal/,
	);
	await assert.rejects(
		changeSimulationController(actor, {
			...winner,
			programDigest: 'b'.repeat(64),
		}),
		/program/,
	);
	await assert.rejects(
		changeSimulationController(actor, { ...loser, action: 'release' }),
	);
	const otherRun = (await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, controllerRunIds[1]!),
	}))!;
	const otherActor: SimulationActor = {
		...runner,
		run: otherRun,
		target: { ...target, databaseIdentity: otherRun.databaseIdentity },
	};
	await assert.rejects(
		changeSimulationController(otherActor, {
			...competing,
			runId: otherRun.id,
		}),
		/another run/,
	);
	const event = {
		id: randomUUID(),
		agentId: 'runner',
		sequence: 1,
		kind: 'heartbeat',
		state: 'idle',
		occurredAt: new Date().toISOString(),
		correlationId: randomUUID(),
		summary: 'CI fenced heartbeat',
		data: { actions: 0 },
	};
	const body = { runId: run!.id, events: [event] };
	await assert.rejects(ingestSimulationEvents(actor, body));
	await assert.rejects(
		ingestSimulationEvents(actor, body, loser.controllerId),
	);
	await ingestSimulationEvents(actor, body, owner);
	const recovery = {
		runId: run!.id,
		controllerId: owner,
		confirmation: controllerRecoveryConfirmation,
	};
	await assert.rejects(
		recoverSimulationController(ids[0]!, run!.databaseIdentity, recovery),
		/recent controller/,
	);
	await assert.rejects(
		recoverSimulationController(ids[1]!, run!.databaseIdentity, recovery),
	);
	await assert.rejects(
		recoverSimulationController(ids[0]!, run!.databaseIdentity, {
			...recovery,
			confirmation: 'yes',
		}),
	);
	current = (await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, run!.id),
	}))!;
	await db
		.update(simulationRuns)
		.set({
			lastHeartbeatAt: new Date(0),
			settings: {
				...current.settings,
				controllerAcquiredAt: new Date(0).toISOString(),
			},
		})
		.where(eq(simulationRuns.id, run!.id));
	await assert.rejects(
		recoverSimulationController(ids[0]!, 'wrong-database', recovery),
	);
	await assert.rejects(
		recoverSimulationController(ids[0]!, run!.databaseIdentity, {
			...recovery,
			controllerId: randomUUID(),
		}),
	);
	assert.deepEqual(
		await recoverSimulationController(
			ids[0]!,
			run!.databaseIdentity,
			recovery,
		),
		{ recovered: true, alreadyRecovered: false },
	);
	assert.deepEqual(
		await recoverSimulationController(
			ids[0]!,
			run!.databaseIdentity,
			recovery,
		),
		{ recovered: true, alreadyRecovered: true },
	);
	current = (await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, run!.id),
	}))!;
	assert.equal(current.status, 'paused');
	assert.deepEqual(
		await (await ingestSimulationEvents(actor, body, owner)).json(),
		{ acceptedIds: [event.id] },
	);
	await assert.rejects(
		ingestSimulationEvents(
			actor,
			{ ...body, events: [{ ...event, id: randomUUID(), sequence: 2 }] },
			owner,
		),
	);
	await changeSimulationController(actor, loser);
	await assert.rejects(
		changeSimulationController(actor, { ...winner, action: 'release' }),
	);
	await assert.rejects(ingestSimulationEvents(actor, body, owner));
	await changeSimulationController(actor, { ...loser, action: 'release' });
	await db
		.update(simulationRuns)
		.set({ status: 'completed' })
		.where(eq(simulationRuns.id, run!.id));
	await assert.rejects(changeSimulationController(actor, loser));
	current = (await db.query.simulationRuns.findFirst({
		where: eq(simulationRuns.id, run!.id),
	}))!;
	assert.equal(current.settings['controllerId'], null);
	assert.equal(current.settings['controllerJournalId'], command.journalId);
});

test('HTTP guard rejects CI environment; credential layer enforces origin, kind, and per-user scope', async () => {
	await assert.rejects(
		authenticateSimulation(request(), 'agent'),
		/disabled outside/,
	);
	const actor = await resolveSimulationCredentials(
		request(),
		'agent',
		target,
	);
	assert.equal(actor.user.id, ids[1]);
	requireSimulationScope(actor, simulationScopes.asks);
	const ordinaryRunner = await resolveSimulationCredentials(
		request(0),
		'runner',
		target,
	);
	assert.throws(
		() => requireSimulationScope(ordinaryRunner, simulationScopes.clock),
		/scope/,
	);
	assert.throws(
		() => requireSimulationScope(actor, simulationScopes.payments),
		/scope/,
	);
	await assert.rejects(
		resolveSimulationCredentials(request(0), 'agent', target),
	);
	await assert.rejects(
		resolveSimulationCredentials(request(1), 'runner', target),
	);
	await assert.rejects(
		resolveSimulationCredentials(
			request(1, 'https://evil.example'),
			'agent',
			target,
		),
	);
	await assert.rejects(
		resolveSimulationCredentials(request(), 'agent', {
			...target,
			databaseIdentity: 'wrong-database',
		}),
	);
});

test('revocation, expired tokens, session rotation, and frozen accounts immediately invalidate authentication', async () => {
	await db
		.update(apiTokens)
		.set({ revokedAt: new Date() })
		.where(eq(apiTokens.id, tokenIds[1]!));
	await assert.rejects(
		resolveSimulationCredentials(request(), 'agent', target),
	);
	await db
		.update(apiTokens)
		.set({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })
		.where(eq(apiTokens.id, tokenIds[1]!));
	await assert.rejects(
		resolveSimulationCredentials(request(), 'agent', target),
	);
	await db
		.update(apiTokens)
		.set({ expiresAt: new Date(Date.now() + 3600000) })
		.where(eq(apiTokens.id, tokenIds[1]!));
	await db
		.update(users)
		.set({ sessionVersion: 1 })
		.where(eq(users.id, ids[1]!));
	await assert.rejects(
		resolveSimulationCredentials(request(), 'agent', target),
	);
	await db
		.update(users)
		.set({ sessionVersion: 0, frozenAt: new Date() })
		.where(eq(users.id, ids[1]!));
	await assert.rejects(
		resolveSimulationCredentials(request(), 'agent', target),
	);
	await db.update(users).set({ frozenAt: null }).where(eq(users.id, ids[1]!));
});

test('simultaneous same-correlation mutations execute once and atomically retain the result', async () => {
	const actor = await resolveSimulationCredentials(
		request(),
		'agent',
		target,
	);
	const correlationId = randomUUID();
	let calls = 0;
	const execute = async (
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	) => {
		calls++;
		await tx
			.update(asks)
			.set({ description: 'Exactly once CI effect' })
			.where(eq(asks.id, effectAskId));
		return { created: 'one', actorId: actor.user.id };
	};
	const results = await Promise.all(
		Array.from({ length: 5 }, () =>
			atomicToolOperation(
				actor,
				'ci_test_mutation',
				correlationId,
				{ value: 7 },
				execute,
			),
		),
	);
	assert.equal(calls, 1);
	for (const result of results) assert.deepEqual(result, results[0]);
	assert.deepEqual(
		(await operationStatus(actor.user.id, correlationId)).result,
		results[0],
	);
	assert.deepEqual(await operationStatus(ids[2]!, correlationId), {
		status: 'not_found',
	});
	await assert.rejects(
		atomicToolOperation(
			actor,
			'ci_test_mutation',
			correlationId,
			{ value: 8 },
			execute,
		),
		/different inputs/,
	);
	const audit = await db
		.select()
		.from(operationEvents)
		.where(
			and(
				eq(operationEvents.runId, runId),
				eq(operationEvents.correlationId, correlationId),
			),
		);
	assert.equal(audit.length, 1);
});

test('domain effects roll back on failure while the terminal operation result survives retries', async () => {
	const actor = await resolveSimulationCredentials(
		request(),
		'agent',
		target,
	);
	const correlationId = randomUUID();
	let calls = 0;
	const execute = async (
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	) => {
		calls++;
		await tx
			.update(asks)
			.set({ description: 'Must be rolled back' })
			.where(eq(asks.id, effectAskId));
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Intentional CI domain failure',
		});
	};
	await assert.rejects(
		atomicToolOperation(
			actor,
			'ci_failed_mutation',
			correlationId,
			{},
			execute,
		),
		/Intentional CI/,
	);
	await assert.rejects(
		atomicToolOperation(
			actor,
			'ci_failed_mutation',
			correlationId,
			{},
			execute,
		),
		/Intentional CI/,
	);
	assert.equal(calls, 1);
	const ask = await db.query.asks.findFirst({
		where: eq(asks.id, effectAskId),
	});
	assert.equal(ask?.description, 'Exactly once CI effect');
	assert.equal(
		(await operationStatus(actor.user.id, correlationId)).status,
		'failed',
	);
});

test('mutation authorization is rechecked inside the transaction after authentication', async () => {
	const actor = await resolveSimulationCredentials(
		request(),
		'agent',
		target,
	);
	let executed = false;
	const execute = async () => {
		executed = true;
		return {};
	};
	await db
		.update(apiTokens)
		.set({ scopes: [simulationScopes.read] })
		.where(eq(apiTokens.id, actor.token.id));
	await assert.rejects(
		atomicToolOperation(actor, 'save_ask', randomUUID(), {}, execute),
	);
	await db
		.update(apiTokens)
		.set({ scopes: actor.token.scopes })
		.where(eq(apiTokens.id, actor.token.id));
	const forged = { ...actor, user: { ...actor.user, id: ids[2]! } };
	await assert.rejects(
		atomicToolOperation(forged, 'save_ask', randomUUID(), {}, execute),
	);
	assert.equal(executed, false);
});

test('runner telemetry is deduplicated, sequence-ordered, actor-bound, and nonfinancial', async () => {
	const runner = await resolveSimulationCredentials(
		request(0),
		'runner',
		target,
	);
	const agent = await resolveSimulationCredentials(
		request(1),
		'agent',
		target,
	);
	const event = {
		id: randomUUID(),
		agentId: `${runId}-0`,
		sequence: 100,
		kind: 'agent_state',
		state: 'idle',
		occurredAt: new Date().toISOString(),
		correlationId: randomUUID(),
		summary: 'Synthetic activity',
		data: {
			cycles: 5,
			password: 'never-store-this',
			paymentSucceeded: true,
		},
	};
	const input = { runId, events: [event] };
	const first = await ingestSimulationEvents(runner, input);
	assert.deepEqual(await first.json(), { acceptedIds: [event.id] });
	assert.deepEqual(
		await (await ingestSimulationEvents(runner, input)).json(),
		{ acceptedIds: [event.id] },
	);
	const audit = await db
		.select()
		.from(operationEvents)
		.where(
			eq(operationEvents.externalId, `simulation:${runId}:${event.id}`),
		);
	assert.equal(audit.length, 1);
	assert.equal(audit[0]?.actorId, agent.user.id);
	assert.deepEqual(audit[0]?.details, {
		cycles: 5,
		sequence: 100,
		source: 'runner_telemetry',
	});
	await ingestSimulationEvents(runner, {
		runId,
		events: [
			{
				...event,
				id: randomUUID(),
				sequence: 99,
				state: 'failed',
				data: { cycles: 0 },
			},
		],
	});
	const member = await db.query.simulationAgents.findFirst({
		where: eq(simulationAgents.id, event.agentId),
	});
	assert.equal(member?.state, 'idle');
	assert.equal(member?.cycles, 5);
	await assert.rejects(ingestSimulationEvents(agent, input));
	await assert.rejects(
		ingestSimulationEvents(runner, {
			runId: 'not-owned-run',
			events: [event],
		}),
	);
	await assert.rejects(
		ingestSimulationEvents(runner, {
			runId,
			events: [{ ...event, agentId: 'not-a-member' }],
		}),
	);
	await ingestSimulationEvents(runner, {
		runId,
		events: [
			{
				...event,
				id: randomUUID(),
				agentId: 'runner',
				sequence: 199,
				kind: 'heartbeat',
				data: { cycles: 31, actions: 30, failures: 1, ramFreeGiB: 4 },
			},
			{
				...event,
				id: randomUUID(),
				agentId: 'runner',
				sequence: 200,
				kind: 'run_paused',
				state: 'paused',
				data: {},
			},
		],
	});
	await ingestSimulationEvents(runner, {
		runId,
		events: [
			{
				...event,
				id: randomUUID(),
				agentId: 'runner',
				sequence: 199,
				kind: 'heartbeat',
			},
		],
	});
	assert.equal(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, runId),
			})
		)?.status,
		'paused',
	);
	assert.deepEqual(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, runId),
			})
		)?.metrics,
		{ cycles: 31, actions: 30, failures: 1, ramFreeGiB: 4 },
	);
	await ingestSimulationEvents(runner, {
		runId,
		events: [
			{
				...event,
				id: randomUUID(),
				agentId: 'runner',
				sequence: 201,
				kind: 'run_started',
			},
		],
	});
	assert.equal(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, runId),
			})
		)?.status,
		'running',
	);
	assert.deepEqual(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, runId),
			})
		)?.metrics,
		{ cycles: 31, actions: 30, failures: 1, ramFreeGiB: 4 },
	);
});

test('terminal runs cannot restart through telemetry, late heartbeats, or previously authenticated mutations', async () => {
	const terminalTarget = { ...target, databaseIdentity: terminalRunId };
	const makeRequest = (index: number) =>
		new Request(`${target.origin}/mcp`, {
			headers: { Authorization: `Bearer ${terminalTokens[index]}` },
		});
	const runner = await resolveSimulationCredentials(
		makeRequest(0),
		'runner',
		terminalTarget,
	);
	const agent = await resolveSimulationCredentials(
		makeRequest(1),
		'agent',
		terminalTarget,
	);
	const event = {
		id: randomUUID(),
		agentId: 'runner',
		sequence: 2,
		kind: 'run_stopped',
		state: 'paused',
		occurredAt: new Date().toISOString(),
		correlationId: randomUUID(),
		summary: 'CI terminal lifecycle',
		data: { cycles: 30 },
	};
	const started = {
		...event,
		id: randomUUID(),
		sequence: 1,
		kind: 'run_started',
		state: 'idle',
	};
	await ingestSimulationEvents(runner, {
		runId: terminalRunId,
		events: [started],
	});
	await ingestSimulationEvents(runner, {
		runId: terminalRunId,
		events: [
			event,
			{
				...event,
				id: randomUUID(),
				sequence: 3,
				kind: 'heartbeat',
				state: 'idle',
			},
		],
	});
	await assert.rejects(
		ingestSimulationEvents(runner, {
			runId: terminalRunId,
			events: [
				{
					...event,
					id: randomUUID(),
					sequence: 4,
					kind: 'run_started',
				},
			],
		}),
		/cannot restart/,
	);
	assert.deepEqual(
		await (
			await ingestSimulationEvents(runner, {
				runId: terminalRunId,
				events: [started],
			})
		).json(),
		{ acceptedIds: [started.id] },
	);
	assert.equal(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, terminalRunId),
			})
		)?.metrics['cycles'],
		30,
	);
	assert.equal(
		(
			await db.query.simulationRuns.findFirst({
				where: eq(simulationRuns.id, terminalRunId),
			})
		)?.status,
		'stopped',
	);
	await assert.rejects(
		resolveSimulationCredentials(makeRequest(1), 'agent', terminalTarget),
	);
	let executed = false;
	await assert.rejects(
		atomicToolOperation(agent, 'save_ask', randomUUID(), {}, async () => {
			executed = true;
			return {};
		}),
	);
	assert.equal(executed, false);
});

async function tool(
	actor: SimulationActor,
	name: string,
	args: Record<string, unknown>,
	correlationId = randomUUID(),
) {
	const server = createMemberMcpServer(actor, new Headers());
	const transport = new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		const response = await transport.handleRequest(
			new Request(`${target.origin}/mcp`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name,
						arguments: args,
						_meta: { 'givetogive/correlationId': correlationId },
					},
				}),
			}),
		);
		const body = (await response.json()) as {
			result?: {
				isError?: boolean;
				structuredContent?: Record<string, unknown>;
			};
		};
		return body.result;
	} finally {
		await server.close();
	}
}

test('real MCP business tools reject forged actor fields and cannot edit another user’s Ask', async () => {
	const owner = await resolveSimulationCredentials(
		request(1),
		'agent',
		target,
	);
	const other = await resolveSimulationCredentials(
		request(2),
		'agent',
		target,
	);
	const input = {
		title: `CI only ${runId}`,
		description:
			'Synthetic MCP domain fixture, removed by exact fixture ownership after this test.',
		type: 'task',
		difficulty: 1,
		estimatedMinutesToComplete: 15,
		goalAmount: 2,
		currency: 'USD',
	};
	assert.equal(
		(
			await tool(owner, 'create_ask', {
				...input,
				createdById: other.user.id,
			})
		)?.isError,
		true,
	);
	const correlationId = randomUUID();
	// All five pool connections can be occupied: nested auth must use the same transaction.
	const concurrent = await Promise.all(
		Array.from({ length: 5 }, () =>
			tool(owner, 'create_ask', input, correlationId),
		),
	);
	const first = concurrent[0];
	for (const result of concurrent) {
		assert.notEqual(result?.isError, true);
		assert.deepEqual(result?.structuredContent, first?.structuredContent);
	}
	assert.notEqual(first?.isError, true);
	assert.deepEqual(
		(await tool(owner, 'create_ask', input, correlationId))
			?.structuredContent,
		first?.structuredContent,
	);
	const created = await db
		.select()
		.from(asks)
		.where(
			and(eq(asks.createdById, owner.user.id), ne(asks.id, effectAskId)),
		);
	assert.equal(created.length, 1);
	assert.equal(
		(
			await tool(other, 'update_ask', {
				askId: created[0]!.id,
				title: 'Unauthorized owner change',
			})
		)?.isError,
		true,
	);
	assert.equal(
		(await tool(other, 'get_me', {}))?.structuredContent?.['id'],
		other.user.id,
	);
	const readOnly: SimulationActor = {
		...other,
		token: { ...other.token, scopes: [simulationScopes.read] },
	};
	assert.equal(
		(
			await tool(readOnly, 'save_ask', {
				askId: created[0]!.id,
				saved: true,
			})
		)?.isError,
		true,
	);
});
