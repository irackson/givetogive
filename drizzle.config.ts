import { env } from '@/env';
import { type Config } from 'drizzle-kit';

export default {
	schema: ['./src/server/db/schema.ts', './src/server/db/operations-schema.ts', './src/server/db/payments-schema.ts'],
	dialect: 'postgresql',
	dbCredentials: {
		url: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
	},
	tablesFilter: ['givetogive_*'],
} satisfies Config;
