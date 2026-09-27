import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import postgres from 'postgres';

// Read-only permission probes; no production application rows are read.
const production = parseEnv(await readFile('.env.local', 'utf8'));
const productionDatabase = new URL(production.DATABASE_URL).pathname;
for (const [file, environment, database] of [
  ['.env.staging.local', 'staging', 'givetogive_staging_20260926'],
  ['.env.ci.local', 'test', 'givetogive_ci_20260926'],
]) {
  const config = parseEnv(await readFile(file, 'utf8'));
  const url = new URL(config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL);
  assert.equal(url.pathname, `/${database}`);
  assert.equal(url.username, database);
  assert.equal(config.APP_ENV, environment);
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const [identity] = await sql`SELECT current_database() AS database, current_user AS role,
      environment, database_name, identity FROM givetogive_environment_identity WHERE id=1`;
    assert.equal(identity.database, database);
    assert.equal(identity.role, database);
    assert.equal(identity.environment, environment);
    assert.equal(identity.database_name, database);
    assert.equal(identity.identity, config.DATABASE_IDENTITY);
    const [role] = await sql`SELECT rolsuper, rolcreaterole, rolcreatedb, rolinherit
      FROM pg_roles WHERE rolname=current_user`;
    assert.deepEqual(Object.values(role), [false, false, false, false]);
  } finally { await sql.end(); }

  url.pathname = productionDatabase;
  assert.notEqual(url.pathname, `/${database}`);
  const probe = postgres(url.toString(), { max: 1, onnotice: () => {} });
  let productionAccess = 'not checked';
  try {
    const [permissions] = await probe`SELECT count(*)::int AS tables,
      coalesce(bool_or(has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')), false) AS exposed
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'givetogive_%'`;
    assert.ok(permissions.tables > 0, 'Production table permissions could not be verified.');
    assert.equal(permissions.exposed, false, 'Isolated role has production table privileges.');
    productionAccess = 'no application-table read/write privileges';
  } catch (error) {
    if (error.code === '42501') productionAccess = 'database access denied';
    else throw error;
  } finally { await probe.end(); }
  console.log(JSON.stringify({ environment, database, markerVerified: true, restrictedRole: true, productionAccess }));
}
