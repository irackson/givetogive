import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { isolatedConfiguration, verifyIsolatedTarget } from './isolated-environment.ts';
const configuration = isolatedConfiguration(process.env);
const databaseName = configuration.database;
const connection = postgres(configuration.directUrl, { max: 1, onnotice: () => {} });
try {
  // Existing markers are checked BEFORE the migrator can write anything.
  // Only a genuinely empty, separately owned database can bootstrap a marker.
  await verifyIsolatedTarget(connection, configuration, true);
  await migrate(drizzle(connection), { migrationsFolder: './drizzle' });
  const markerEnvironment = process.env.APP_ENV === 'staging' ? 'staging' : 'test';
  const [marker] = await connection`select identity, environment, database_name from givetogive_environment_identity where id = 1`;
  if (marker && (marker.identity !== process.env.DATABASE_IDENTITY || marker.database_name !== databaseName || marker.environment !== markerEnvironment)) throw new Error('Existing database identity mismatch.');
  await connection`insert into givetogive_environment_identity (id, environment, database_name, identity) values (1, ${markerEnvironment}, ${databaseName}, ${process.env.DATABASE_IDENTITY}) on conflict (id) do nothing`;
  const [{ tables }] = await connection`select count(*)::int as tables from information_schema.tables where table_schema='public'`;
  console.log(JSON.stringify({ database: databaseName, environment: markerEnvironment, tables, migrated: true }));
} finally { await connection.end(); }
