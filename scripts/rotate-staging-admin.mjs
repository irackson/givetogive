// Rotate only the synthetic stage administrator and its runner credential.
// node --env-file=.env.staging.local scripts/rotate-staging-admin.mjs
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { hashPassword, verifyPassword } from '../src/server/auth/password.ts';

const adminPath = 'tools/simulation/.state/staging-admin.json';
const runnerPath = 'tools/simulation/.state/staging-credentials.json';
const admin = JSON.parse(readFileSync(adminPath, 'utf8'));
const runner = JSON.parse(readFileSync(runnerPath, 'utf8'));
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  if (process.env.APP_ENV !== 'staging' || admin.id !== 'synthetic-stage-admin') throw new Error('Unexpected stage administrator.');
  const [identity] = await sql`select current_database() as database, current_user as role`;
  if (identity.database !== 'givetogive_staging_20260926' || identity.role !== identity.database) throw new Error('Unexpected database.');
  const [marker] = await sql`select * from givetogive_environment_identity where id = 1`;
  if (marker?.environment !== 'staging' || marker.identity !== process.env.DATABASE_IDENTITY || marker.identity !== runner.databaseIdentity) throw new Error('Environment marker mismatch.');
  const [user] = await sql`select id, is_synthetic, role, email_verified, hashed_password from givetogive_user where id = ${admin.id}`;
  if (!user?.is_synthetic || user.role !== 'admin' || !user.email_verified) throw new Error('Expected a verified synthetic administrator.');
  const previousCredentialMatched = await verifyPassword(admin.password, user.hashed_password);
  const nextAdmin = { ...admin, password: randomBytes(32).toString('hex') };
  const nextRunner = { ...runner, runnerToken: randomBytes(32).toString('hex') };
  const passwordHash = await hashPassword(nextAdmin.password);
  const tokenHash = createHash('sha256').update(nextRunner.runnerToken).digest('hex');
  // Persist replacements before the transaction so an interruption never loses credentials.
  writeFileSync(`${adminPath}.next`, JSON.stringify(nextAdmin, null, 2), { mode: 0o600 });
  writeFileSync(`${runnerPath}.next`, JSON.stringify(nextRunner, null, 2), { mode: 0o600 });
  await sql.begin(async (tx) => {
    const [updated] = await tx`update givetogive_user set hashed_password = ${passwordHash}, session_version = session_version + 1 where id = ${admin.id} and is_synthetic = true returning session_version`;
    await tx`update givetogive_api_token set revoked_at = now() where user_id = ${admin.id}`;
    await tx`update givetogive_api_token set token_hash = ${tokenHash}, session_version = ${updated.session_version}, revoked_at = null, expires_at = now() + interval '7 days' where id = 'baseline-runner' and user_id = ${admin.id} and run_id = ${runner.runId}`;
    await tx`insert into givetogive_operation_event (environment,actor_id,entity_type,entity_id,action,outcome,summary) values ('staging',${admin.id},'user',${admin.id},'rotate_synthetic_credentials','succeeded','Synthetic administrator sessions revoked and fixture credentials rotated.')`;
  });
  renameSync(`${adminPath}.next`, adminPath);
  renameSync(`${runnerPath}.next`, runnerPath);
  console.log(JSON.stringify({ rotated: true, previousCredentialMatched, priorSessionsRevoked: true, runnerCredentialRotated: true }));
} finally { await sql.end(); }
