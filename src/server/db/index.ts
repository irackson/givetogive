import { env } from '@/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as coreSchema from './schema';
import * as operationsSchema from './operations-schema';
import * as paymentsSchema from './payments-schema';

const schema = { ...coreSchema, ...operationsSchema, ...paymentsSchema };

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
	conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 15 });
if (env.NODE_ENV !== 'production') globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
