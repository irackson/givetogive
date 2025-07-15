import { relations, sql } from 'drizzle-orm';
import {
	index,
	integer,
	pgTableCreator,
	primaryKey,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { type AdapterAccount } from 'next-auth/adapters';

export const createTable = pgTableCreator((name) => `givetogive_${name}`);

//! TODO fix with https://chatgpt.com/c/6726f09e-d8b4-800d-9645-cc1ba73bce8c after drizzle fixes db:generate / db:migrate error ("undefined" is not valid JSON)
// eslint-disable-next-line deprecation/deprecation
export const asks = createTable(
	'ask',
	{
		id: serial('id').primaryKey(),
		slug: varchar('slug', { length: 256 }).notNull().unique(),
		title: varchar('title', { length: 256 }).notNull(),
		description: text('description').notNull(),
		difficulty: integer('difficulty').notNull(),
		estimatedMinutesToComplete: integer(
			'estimated_minutes_to_complete',
		).notNull(),
		status: varchar('status', { length: 50 })
			.notNull()
			.$type<'not_started' | 'in_progress' | 'complete'>()
			.default('not_started'),
		createdById: varchar('created_by', { length: 255 })
			.notNull()
			.references(() => users.id),
		fullFilledById: varchar('fulfilled_by', { length: 255 }).references(
			() => users.id,
		),
		createdAt: timestamp('created_at', { withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).$onUpdate(
			() => new Date(),
		),
	},
	(ask) => ({
		createdByIdIdx: index('ask_created_by_idx').on(ask.createdById),
		slugIndex: index('asks_slug_idx').on(ask.slug),
		titleIndex: index('ask_title_idx').on(ask.title),
		difficultyIndex: index('ask_difficulty_idx').on(ask.difficulty),
	}),
);

export const insertAskSchema = createInsertSchema(asks, {
	title: (schema) =>
		schema.title.min(3, 'Title must be at least 3 characters long'),
	description: (schema) =>
		schema.description.min(
			10,
			'Description must be at least 10 characters long',
		),
	difficulty: (schema) =>
		schema.difficulty
			.int()
			.min(1, 'Difficulty must be at least 1')
			.max(5, 'Difficulty must be at most 5'),
	estimatedMinutesToComplete: (schema) =>
		schema.estimatedMinutesToComplete
			.int()
			.positive('Must be a positive number'),
});

export const selectAskSchema = createSelectSchema(asks);

export const asksRelations = relations(asks, ({ one }) => ({
	createdBy: one(users, {
		fields: [asks.createdById],
		references: [users.id],
	}),
	fullFilledBy: one(users, {
		fields: [asks.fullFilledById],
		references: [users.id],
	}),
}));

export const users = createTable('user', {
	id: varchar('id', { length: 255 })
		.notNull()
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: varchar('name', { length: 255 }),
	email: varchar('email', { length: 255 }).notNull(),
	emailVerified: timestamp('email_verified', {
		mode: 'date',
		withTimezone: true,
	}).default(sql`CURRENT_TIMESTAMP`),
	image: varchar('image', { length: 255 }),
});

export const usersRelations = relations(users, ({ many }) => ({
	accounts: many(accounts),
}));

// eslint-disable-next-line deprecation/deprecation
export const accounts = createTable(
	'account',
	{
		userId: varchar('user_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		type: varchar('type', { length: 255 })
			.$type<AdapterAccount['type']>()
			.notNull(),
		provider: varchar('provider', { length: 255 }).notNull(),
		providerAccountId: varchar('provider_account_id', {
			length: 255,
		}).notNull(),
		refresh_token: text('refresh_token'),
		access_token: text('access_token'),
		expires_at: integer('expires_at'),
		token_type: varchar('token_type', { length: 255 }),
		scope: varchar('scope', { length: 255 }),
		id_token: text('id_token'),
		session_state: varchar('session_state', { length: 255 }),
	},
	(account) => ({
		compoundKey: primaryKey({
			columns: [account.provider, account.providerAccountId],
		}),
		userIdIdx: index('account_user_id_idx').on(account.userId),
	}),
);

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

// eslint-disable-next-line deprecation/deprecation
export const sessions = createTable(
	'session',
	{
		sessionToken: varchar('session_token', { length: 255 })
			.notNull()
			.primaryKey(),
		userId: varchar('user_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		expires: timestamp('expires', {
			mode: 'date',
			withTimezone: true,
		}).notNull(),
	},
	(session) => ({
		userIdIdx: index('session_user_id_idx').on(session.userId),
	}),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

// eslint-disable-next-line deprecation/deprecation
export const verificationTokens = createTable(
	'verification_token',
	{
		identifier: varchar('identifier', { length: 255 }).notNull(),
		token: varchar('token', { length: 255 }).notNull(),
		expires: timestamp('expires', {
			mode: 'date',
			withTimezone: true,
		}).notNull(),
	},
	(vt) => ({
		compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
	}),
);
