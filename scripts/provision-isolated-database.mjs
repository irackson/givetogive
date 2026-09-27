// Creates only named, empty test databases. Never clones or migrates production.
// Usage: node --env-file=.env.local scripts/provision-isolated-database.mjs staging|ci
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';

const environment = process.argv[2];
if (!['staging', 'ci'].includes(environment)) throw new Error('Choose staging or ci explicitly.');
const databaseName = `givetogive_${environment}_20260926`;
const roleName = `givetogive_${environment}_20260926`;
const output = `.env.${environment}.local`;
const originalUrl = new URL(process.env.DATABASE_URL);
const sourceDatabase = decodeURIComponent(originalUrl.pathname.slice(1));
if (sourceDatabase === databaseName) throw new Error('Expected the existing provisioning connection, not the target.');
originalUrl.hostname = originalUrl.hostname.replace('-pooler.', '.');
const admin = postgres(originalUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
let step = 'inspect privileges';
try {
  const [permissions] = await admin`SELECT current_user AS role, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
  if (!permissions.rolcreatedb || !permissions.rolcreaterole) throw new Error('Provisioning account cannot create isolated database/role.');
  const existing = existsSync(output) ? parseEnv(readFileSync(output, 'utf8')) : null;
  const password = existing?.DATABASE_PASSWORD ?? randomBytes(32).toString('hex');
  const target = new URL(originalUrl);
  target.username = roleName; target.password = password; target.pathname = `/${databaseName}`;
  const pooled = new URL(target); pooled.hostname = pooled.hostname.replace(/^([^.]+)\./, '$1-pooler.');
  if (existing && (existing.DATABASE_DATABASE !== databaseName || existing.DATABASE_USER !== roleName)) throw new Error('Existing file belongs to a different target; refusing overwrite.');
  const [foundRole] = await admin`SELECT rolname FROM pg_roles WHERE rolname = ${roleName}`;
  const [foundDatabase] = await admin`SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${databaseName}`;
  if ((foundRole || foundDatabase) && !existing) throw new Error('Target already exists without matching saved credentials; refusing takeover.');
  if (foundDatabase && foundDatabase.owner !== roleName) throw new Error('Target database has an unexpected owner.');
  if (!existing) {
    const appUrl = environment === 'staging' ? 'https://givetogive-staging.vercel.app' : 'http://localhost:3012';
    const settings = {
      APP_ENV: environment === 'ci' ? 'test' : 'staging', APP_URL: appUrl,
      DATABASE_IDENTITY: randomUUID(), DATABASE_DATABASE: databaseName, DATABASE_USER: roleName,
      DATABASE_PASSWORD: password, DATABASE_HOST: pooled.hostname, DATABASE_URL: pooled.toString(), DATABASE_URL_UNPOOLED: target.toString(),
      NEXTAUTH_SECRET: randomBytes(48).toString('base64url'), NEXTAUTH_URL: appUrl,
      DISCORD_CLIENT_ID: 'disabled-in-isolated-environment', DISCORD_CLIENT_SECRET: randomBytes(32).toString('hex'),
      ADMIN_ENCRYPTION_KEY: randomBytes(48).toString('base64url'), STAGING_ACCESS_SECRET: randomBytes(48).toString('base64url'),
      CRON_SECRET: randomBytes(48).toString('base64url'), SIMULATION_ENABLED: environment === 'staging' ? 'true' : 'false',
      PAYMENTS_ENABLED: 'false', SUPPORTERS_ENABLED: 'false', FUNDS_ENABLED: 'false', STRIPE_LIVE_APPROVED: 'false',
      STRIPE_PROCESSING_BPS: '290', STRIPE_PROCESSING_FIXED_CENTS: '30',
    };
    writeFileSync(output, Object.entries(settings).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (!foundRole) {
    step = 'create isolated role';
    // Generated hex password only; identifiers are fixed above, never user input.
    await admin.unsafe(`CREATE ROLE ${quote(roleName)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  }
  // Postgres requires the provisioning role to be able to SET ROLE to a new owner.
  // This grants access to the new empty sandbox, never to the production role.
  step = 'authorize isolated database ownership';
  if (!foundDatabase) await admin.unsafe(`GRANT ${quote(roleName)} TO ${quote(permissions.role)}`);
  step = 'create isolated database';
  if (!foundDatabase) await admin.unsafe(`CREATE DATABASE ${quote(databaseName)} OWNER ${quote(roleName)} TEMPLATE template0`);
  step = 'restrict isolated database access';
  await admin.unsafe(`REVOKE ALL ON DATABASE ${quote(databaseName)} FROM PUBLIC`);
  const test = postgres(target.toString(), { max: 1, prepare: false });
  try {
    const [identity] = await test`SELECT current_database() AS database, current_user AS role`;
    if (identity.database !== databaseName || identity.role !== roleName) throw new Error('Isolated identity verification failed.');
    const [{ tables }] = await test`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log(JSON.stringify({ environment, database: databaseName, role: roleName, tables, credentialsFile: output, productionDataCopied: false }));
  } finally { await test.end(); }
} catch (error) {
  // Never print Postgres error objects: they can include a credential-bearing query.
  console.error(`Isolated provisioning failed at ${step}.`, error?.code ?? error?.message ?? 'Unknown failure');
  process.exitCode = 1;
} finally { await admin.end(); }
