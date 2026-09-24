import { ASK_TYPES, type AskType } from '@/lib/asks';
import { relations, sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgTableCreator,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { type AdapterAccount } from 'next-auth/adapters';
import { z } from 'zod';

export const createTable = pgTableCreator((name) => `givetogive_${name}`);
export const askTypeSchema = z.enum(ASK_TYPES);

//! TODO fix with https://chatgpt.com/c/6726f09e-d8b4-800d-9645-cc1ba73bce8c after drizzle fixes db:migrate error
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
		type: varchar('type', { length: 20 })
			.notNull()
			.$type<AskType>()
			.default('task'),
		goalAmount: integer('goal_amount').notNull().default(1),
		currency: varchar('currency', { length: 3 }),
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
		currencyCheck: check(
			'ask_currency_check',
			sql`${ask.type} <> 'money' OR ${ask.currency} IS NOT NULL`,
		),
		createdByIdIdx: index('ask_created_by_idx').on(ask.createdById),
		difficultyCheck: check(
			'ask_difficulty_check',
			sql`${ask.difficulty} BETWEEN 1 AND 5`,
		),
		difficultyIndex: index('ask_difficulty_idx').on(ask.difficulty),
		goalAmountCheck: check(
			'ask_goal_amount_check',
			sql`${ask.goalAmount} > 0`,
		),
		slugIndex: index('asks_slug_idx').on(ask.slug),
		statusIndex: index('ask_status_idx').on(ask.status),
		statusCheck: check(
			'ask_status_check',
			sql`${ask.status} IN ('not_started', 'in_progress', 'complete')`,
		),
		titleIndex: index('ask_title_idx').on(ask.title),
		typeIndex: index('ask_type_idx').on(ask.type),
		typeCheck: check(
			'ask_type_check',
			sql`${ask.type} IN ('time', 'task', 'item', 'money', 'resource')`,
		),
	}),
);
export const insertAskSchema = createInsertSchema(asks, {
	title: (schema) =>
		schema.min(3, 'Title must be at least 3 characters long'),
	description: (schema) =>
		schema.min(10, 'Description must be at least 10 characters long'),
	difficulty: (schema) =>
		schema
			.min(1, 'Difficulty must be at least 1')
			.max(5, 'Difficulty must be at most 5'),
	estimatedMinutesToComplete: (schema) =>
		schema.positive('Must be a positive number'),
	type: () => askTypeSchema,
	goalAmount: (schema) => schema.positive('Goal must be positive'),
	currency: (schema) => schema.length(3, 'Use a three-letter currency code'),
});

export const selectAskSchema = createSelectSchema(asks);

export const asksRelations = relations(asks, ({ many, one }) => ({
	createdBy: one(users, {
		fields: [asks.createdById],
		references: [users.id],
	}),
	fullFilledBy: one(users, {
		fields: [asks.fullFilledById],
		references: [users.id],
	}),
	contributions: many(askContributions),
}));

export const users = createTable(
	'user',
	{
		id: varchar('id', { length: 255 })
			.notNull()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: varchar('name', { length: 255 }),
		email: varchar('email', { length: 255 }).notNull(),
		hashedPassword: varchar('hashed_password', { length: 255 }),
		emailVerified: timestamp('email_verified', {
			mode: 'date',
			withTimezone: true,
		}),
		image: varchar('image', { length: 255 }),
	},
	(user) => ({
		emailLowerUniqueIndex: uniqueIndex('user_email_lower_unique_idx').on(
			sql`lower(${user.email})`,
		),
	}),
);

export const usersRelations = relations(users, ({ many }) => ({
	accounts: many(accounts),
	contributions: many(askContributions),
}));

export const askContributions = createTable(
	'ask_contribution',
	{
		id: serial('id').primaryKey(),
		askId: integer('ask_id')
			.notNull()
			.references(() => asks.id, { onDelete: 'cascade' }),
		contributorId: varchar('contributor_id', { length: 255 })
			.notNull()
			.references(() => users.id),
		amount: integer('amount').notNull(),
		note: text('note'),
		status: varchar('status', { length: 20 })
			.notNull()
			.$type<'pledged' | 'completed' | 'cancelled'>()
			.default('pledged'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).$onUpdate(
			() => new Date(),
		),
	},
	(contribution) => ({
		amountCheck: check(
			'ask_contribution_amount_check',
			sql`${contribution.amount} > 0`,
		),
		askIdIdx: index('ask_contribution_ask_idx').on(contribution.askId),
		contributorIdIdx: index('ask_contribution_contributor_idx').on(
			contribution.contributorId,
		),
		statusIdx: index('ask_contribution_status_idx').on(contribution.status),
		statusCheck: check(
			'ask_contribution_status_check',
			sql`${contribution.status} IN ('pledged', 'completed', 'cancelled')`,
		),
	}),
);

export const insertAskContributionSchema = createInsertSchema(
	askContributions,
	{
		amount: (schema) => schema.positive('Contribution must be positive'),
		note: (schema) =>
			schema.max(500, 'Note must be 500 characters or less'),
	},
);

export const askContributionsRelations = relations(
	askContributions,
	({ one }) => ({
		ask: one(asks, {
			fields: [askContributions.askId],
			references: [asks.id],
		}),
		contributor: one(users, {
			fields: [askContributions.contributorId],
			references: [users.id],
		}),
	}),
);

export const authTokens = createTable(
	'auth_token',
	{
		id: serial('id').primaryKey(),
		userId: varchar('user_id', { length: 255 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		purpose: varchar('purpose', { length: 30 })
			.notNull()
			.$type<'email_verification' | 'password_reset'>(),
		tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
		expiresAt: timestamp('expires_at', {
			mode: 'date',
			withTimezone: true,
		}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(token) => ({
		purposeCheck: check(
			'auth_token_purpose_check',
			sql`${token.purpose} IN ('email_verification', 'password_reset')`,
		),
		userPurposeIdx: index('auth_token_user_purpose_idx').on(
			token.userId,
			token.purpose,
		),
	}),
);

export const authRateLimits = createTable(
	'auth_rate_limit',
	{
		key: varchar('key', { length: 64 }).primaryKey(),
		attempts: integer('attempts').notNull().default(0),
		windowStartedAt: timestamp('window_started_at', {
			mode: 'date',
			withTimezone: true,
		}).notNull(),
		blockedUntil: timestamp('blocked_until', {
			mode: 'date',
			withTimezone: true,
		}),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(rateLimit) => ({
		attemptsCheck: check(
			'auth_rate_limit_attempts_check',
			sql`${rateLimit.attempts} >= 0`,
		),
	}),
);

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
