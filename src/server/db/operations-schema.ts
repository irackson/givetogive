import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core';
import { createTable, users } from './schema';

export const operationEvents = createTable(
	'operation_event',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		externalId: varchar('external_id', { length: 255 }),
		environment: varchar('environment', { length: 20 }).notNull(),
		actorId: varchar('actor_id', { length: 255 }),
		entityType: varchar('entity_type', { length: 60 }).notNull(),
		entityId: varchar('entity_id', { length: 255 }),
		action: varchar('action', { length: 100 }).notNull(),
		outcome: varchar('outcome', { length: 40 }).notNull(),
		correlationId: varchar('correlation_id', { length: 255 }),
		runId: varchar('run_id', { length: 64 }),
		summary: varchar('summary', { length: 500 }),
		details: jsonb('details')
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		occurredAt: timestamp('occurred_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex('operation_event_external_unique').on(table.externalId),
		index('operation_event_run_id_idx').on(table.runId, table.id),
		index('operation_event_entity_idx').on(
			table.entityType,
			table.entityId,
			table.id,
		),
		index('operation_event_actor_idx').on(table.actorId, table.id),
		index('operation_event_environment_created_idx').on(
			table.environment,
			table.createdAt,
		),
	],
);

export const userSecurity = createTable('user_security', {
	userId: varchar('user_id', { length: 255 })
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	totpCiphertext: text('totp_ciphertext'),
	totpPendingCiphertext: text('totp_pending_ciphertext'),
	totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
	totpLastStep: bigint('totp_last_step', { mode: 'number' }),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const simulationRuns = createTable('simulation_run', {
	id: varchar('id', { length: 64 })
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: varchar('name', { length: 160 }).notNull(),
	status: varchar('status', { length: 30 }).notNull().default('created'),
	mode: varchar('mode', { length: 30 }).notNull().default('autonomous'),
	environment: varchar('environment', { length: 20 })
		.notNull()
		.default('staging'),
	databaseIdentity: varchar('database_identity', { length: 128 }).notNull(),
	createdById: varchar('created_by', { length: 255 })
		.notNull()
		.references(() => users.id),
	agentCount: integer('agent_count').notNull().default(100),
	settings: jsonb('settings')
		.$type<Record<string, unknown>>()
		.notNull()
		.default({}),
	metrics: jsonb('metrics')
		.$type<Record<string, unknown>>()
		.notNull()
		.default({}),
	lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
	startedAt: timestamp('started_at', { withTimezone: true }),
	finishedAt: timestamp('finished_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const simulationAgents = createTable(
	'simulation_agent',
	{
		id: varchar('id', { length: 64 }).primaryKey(),
		runId: varchar('run_id', { length: 64 })
			.notNull()
			.references(() => simulationRuns.id),
		userId: varchar('user_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		name: varchar('name', { length: 160 }).notNull(),
		tier: varchar('tier', { length: 20 }).notNull().default('neighbor'),
		state: varchar('state', { length: 40 }).notNull().default('idle'),
		sequence: integer('sequence').notNull().default(0),
		cycles: integer('cycles').notNull().default(0),
		persona: jsonb('persona')
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		lastAction: varchar('last_action', { length: 500 }),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex('simulation_agent_run_user_unique').on(
			table.runId,
			table.userId,
		),
	],
);

export const simulationCommands = createTable(
	'simulation_command',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		runId: varchar('run_id', { length: 64 })
			.notNull()
			.references(() => simulationRuns.id),
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		type: varchar('type', { length: 40 }).notNull(),
		agentId: varchar('agent_id', { length: 64 }),
		value: jsonb('value').$type<
			number | string | Record<string, unknown>
		>(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index('simulation_command_cursor_idx').on(table.runId, table.id),
	],
);

export const apiTokens = createTable('api_token', {
	id: varchar('id', { length: 64 })
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: varchar('user_id', { length: 255 })
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
	kind: varchar('kind', { length: 20 }).notNull().$type<'agent' | 'runner'>(),
	scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
	runId: varchar('run_id', { length: 64 })
		.notNull()
		.references(() => simulationRuns.id),
	environment: varchar('environment', { length: 20 })
		.notNull()
		.default('staging'),
	sessionVersion: integer('session_version').notNull().default(0),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

export const emailSink = createTable('email_sink', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	to: varchar('recipient', { length: 255 }).notNull(),
	purpose: varchar('purpose', { length: 40 }).notNull(),
	urlCiphertext: text('url_ciphertext').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

// This marker is provisioned only into an empty, isolated synthetic database.
export const environmentIdentity = createTable('environment_identity', {
	id: integer('id').primaryKey(),
	environment: varchar('environment', { length: 20 }).notNull(),
	databaseName: varchar('database_name', { length: 128 }).notNull(),
	identity: varchar('identity', { length: 128 }).notNull().unique(),
});

export const toolOperations = createTable(
	'tool_operation',
	{
		actorId: varchar('actor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		correlationId: varchar('correlation_id', { length: 64 }).notNull(),
		tool: varchar('tool', { length: 80 }).notNull(),
		inputHash: varchar('input_hash', { length: 64 }).notNull(),
		status: varchar('status', { length: 20 }).notNull().default('pending'),
		result: jsonb('result').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.actorId, table.correlationId] })],
);

// Bounded aggregate telemetry: no request payloads, identities, URLs or tokens.
export const requestMetrics = createTable(
	'request_metric',
	{
		environment: varchar('environment', { length: 20 }).notNull(),
		bucketStart: timestamp('bucket_start', {
			withTimezone: true,
		}).notNull(),
		procedure: varchar('procedure', { length: 100 }).notNull(),
		outcome: varchar('outcome', { length: 16 }).notNull(),
		count: integer('count').notNull().default(1),
		durationSumMs: bigint('duration_sum_ms', { mode: 'number' }).notNull(),
		durationMaxMs: integer('duration_max_ms').notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.environment,
				table.bucketStart,
				table.procedure,
				table.outcome,
			],
		}),
	],
);
