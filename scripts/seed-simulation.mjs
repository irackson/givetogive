// Provision an existing isolated staging run. No paid entitlements are granted.
// node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id <run-id>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';
import { hashPassword, verifyPassword } from '../src/server/auth/password.ts';
import { assertStagingOrigin } from '../tools/simulation/src/config.ts';
import { assertClockProvisioning, assertProvisionableRun, baselineRunId, credentialsPath, fixtureIds, makeCredentials, parseProvisionArgs, runNamespace, targetTier, validateSavedCredentials } from '../tools/simulation/src/provisioning.ts';

const runId = parseProvisionArgs(process.argv.slice(2));
const clockControl = process.argv.includes('--clock-cohort');
const origin = assertStagingOrigin(process.env.APP_URL ?? '').origin;
if (process.env.APP_ENV !== 'staging' || process.env.SIMULATION_ENABLED !== 'true') throw new Error('An explicitly enabled simulation staging environment is required.');
if (!process.env.DATABASE_URL || !process.env.DATABASE_IDENTITY) throw new Error('Missing isolated database configuration.');
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
const credentialsFile = credentialsPath(runId);
const hash = value => createHash('sha256').update(value).digest('hex');
const agentScopes = ['member:read', 'asks:write', 'contributions:write', 'payments:prepare'];
const runnerScopes = ['simulation:read', 'simulation:events', ...(clockControl ? ['simulation:clock'] : [])];
try {
  const [{ database, role }] = await connection`select current_database() as database, current_user as role`;
  if (database !== 'givetogive_staging_20260926' || role !== database) throw new Error('Unexpected database or database role.');
  const [marker] = await connection`select * from givetogive_environment_identity where id = 1`;
  if (marker?.environment !== 'staging' || marker.database_name !== database || marker.identity !== process.env.DATABASE_IDENTITY) throw new Error('Staging identity marker mismatch.');
  const [initialRun] = await connection`select * from givetogive_simulation_run where id = ${runId}`;
  if (!initialRun) throw new Error('Create this run in the staging admin dashboard first. Provisioning never invents a run or administrator.');
  assertProvisionableRun(initialRun, marker.identity);
  assertClockProvisioning(initialRun, clockControl);
  const expected = { runId, mode: initialRun.mode, origin, databaseIdentity: marker.identity, population: initialRun.agent_count };
  const credentials = existsSync(credentialsFile)
    ? validateSavedCredentials(JSON.parse(readFileSync(credentialsFile, 'utf8')), expected)
    : { ...makeCredentials(initialRun, origin, marker.identity), ...(clockControl ? { clockControl: true } : {}) };
  if (Boolean(credentials.clockControl) !== clockControl) throw new Error('Clock scope cannot be added to or removed from an existing credential file. Provision a fresh run with explicit --clock-cohort.');
  // Preserve credentials before committing hashes. Failed transactions can retry the same
  // identities; existing files and revoked credentials are never silently overwritten.
  mkdirSync(dirname(credentialsFile), { recursive: true });
  if (!existsSync(credentialsFile)) writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
  const counts = { createdMembers: 0, createdTokens: 0, createdAsks: 0 };
  await connection.begin(async tx => {
    const [run] = await tx`select * from givetogive_simulation_run where id = ${runId} for update`;
    assertProvisionableRun(run, marker.identity);
    if (run.mode !== initialRun.mode || run.agent_count !== initialRun.agent_count || run.created_by !== initialRun.created_by) throw new Error('Run changed during provisioning; review its configuration before retrying.');
    const [administrator] = await tx`select id, role, email_verified, frozen_at, session_version from givetogive_user where id = ${run.created_by} for share`;
    if (!administrator || administrator.role !== 'admin' || !administrator.email_verified || administrator.frozen_at) throw new Error('The run creator must be an active verified staging administrator.');
    const mayCreate = run.status === 'created';
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const ensureToken = async (id, user, raw, kind, scopes) => {
      const [existing] = await tx`select * from givetogive_api_token where id = ${id}`;
      if (existing) {
        if (existing.user_id !== user.id || existing.run_id !== runId || existing.token_hash !== hash(raw) || existing.kind !== kind || existing.environment !== 'staging' || existing.session_version !== user.session_version || existing.revoked_at || new Date(existing.expires_at).getTime() <= Date.now() || JSON.stringify([...existing.scopes].sort()) !== JSON.stringify([...scopes].sort())) throw new Error('Saved token does not match an active run-scoped credential. Create a fresh run; expired or revoked tokens are never reactivated.');
        return;
      }
      if (!mayCreate) throw new Error('Cannot add missing credentials after a run starts. Create a fresh run.');
      await tx`insert into givetogive_api_token (id,user_id,token_hash,kind,scopes,run_id,session_version,expires_at) values (${id},${user.id},${hash(raw)},${kind},${tx.json(scopes)},${runId},${user.session_version},${expiresAt})`;
      counts.createdTokens++;
    };
    const firstNames = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Avery', 'Riley', 'Jamie', 'Robin'];
    const lastNames = ['Rivera', 'Chen', 'Brooks', 'Patel', 'Reed', 'Kim', 'Santos', 'Nguyen', 'Parker', 'Diaz'];
    const seedCount = Math.ceil(run.agent_count / 2);
    for (const [index, account] of credentials.agents.entries()) {
      const ids = fixtureIds(runId, index);
      const name = `${firstNames[index % 10]} ${lastNames[Math.floor(index / 10)]} (simulation)`;
      const candidates = await tx`select * from givetogive_user where id = ${ids.userId} or email = ${ids.email} for share`;
      let member = candidates[0];
      if (member) {
        if (candidates.length !== 1 || member.id !== ids.userId || member.email !== ids.email || !member.is_synthetic || member.role !== 'member' || !member.email_verified || member.frozen_at || !member.hashed_password || !await verifyPassword(account.password, member.hashed_password)) throw new Error('Refusing to overwrite or reuse a mismatched, nonsynthetic, or inactive account.');
      } else {
        if (!mayCreate) throw new Error('Cannot add missing members after a run starts. Create a fresh run.');
        const passwordHash = await hashPassword(account.password);
        [member] = await tx`insert into givetogive_user (id,name,email,email_verified,hashed_password,role,is_synthetic,bio) values (${ids.userId},${name},${ids.email},now(),${passwordHash},'member',true,'Clearly labeled synthetic participant for isolated GiveToGive testing.') returning *`;
        counts.createdMembers++;
      }
      const tier = targetTier(index, run.agent_count);
      const [agent] = await tx`select * from givetogive_simulation_agent where id = ${ids.id} or (run_id = ${runId} and user_id = ${member.id})`;
      if (agent) {
        if (agent.id !== ids.id || agent.run_id !== runId || agent.user_id !== member.id || agent.tier !== tier) throw new Error('Existing simulation member mapping does not match this run.');
      } else {
        if (!mayCreate) throw new Error('Cannot add members to an experiment that has started.');
        await tx`insert into givetogive_simulation_agent (id,run_id,user_id,name,tier,persona) values (${ids.id},${runId},${member.id},${name},${tier},${tx.json({ targetTier: tier, synthetic: true, actualPaidEntitlement: false, disposition: ['generous', 'practical', 'curious', 'cautious', 'busy'][index % 5] })})`;
      }
      await ensureToken(ids.tokenId, member, account.token, 'agent', agentScopes);
      if (index < seedCount) {
        const type = runId === baselineRunId ? (index < 30 ? 'money' : ['time', 'task', 'item', 'resource'][index % 4]) : ['time', 'task', 'item', 'money', 'resource'][index % 5];
        const slug = runId === baselineRunId ? `simulation-ask-${index + 1}` : `simulation-${runNamespace(runId)}-${index + 1}`;
        const [existing] = await tx`select created_by from givetogive_ask where slug = ${slug}`;
        if (existing && existing.created_by !== member.id) throw new Error('Refusing to overwrite another account’s existing Ask.');
        if (!existing && mayCreate) {
          const title = { money: 'Help stock the neighborhood pantry', time: 'Share an hour in the community garden', task: 'Help assemble a donated bookcase', item: 'Spare kitchen tools for a new home', resource: 'Share a local repair guide' }[type];
          await tx`insert into givetogive_ask (title,description,slug,difficulty,estimated_minutes_to_complete,status,type,goal_amount,currency,created_by) values (${`${title} — ${index + 1} (simulation)`},'Synthetic Ask for an isolated testing environment. No real money or services are requested.',${slug},${index % 5 + 1},${30 + index % 4 * 15},'not_started',${type},${type === 'money' ? 20000 : type === 'time' ? 120 : 5},${type === 'money' ? 'USD' : null},${member.id})`;
          counts.createdAsks++;
        }
      }
    }
    const [{ count }] = await tx`select count(*)::int as count from givetogive_simulation_agent where run_id = ${runId}`;
    if (count !== run.agent_count) throw new Error('Run has unexpected additional members.');
    await ensureToken(runId === baselineRunId ? 'baseline-runner' : `runner-${runNamespace(runId)}`, administrator, credentials.runnerToken, 'runner', runnerScopes);
    if (clockControl) await tx`insert into givetogive_operation_event (external_id,environment,actor_id,entity_type,entity_id,action,outcome,run_id,summary,details) values (${`clock-provision:${runId}`},'staging',${administrator.id},'simulation_run',${runId},'simulation_clock_scope_provisioned','completed',${runId},'Operator explicitly provisioned clock control for a tiny synthetic cohort.',${tx.json({ population: run.agent_count })}) on conflict (external_id) do nothing`;
  });
  console.log(JSON.stringify({ runId, mode: initialRun.mode, population: initialRun.agent_count, ...counts, clockControl, paidEntitlementsGranted: 0, credentialsFile, localRunnerStarted: false }));
} catch (error) {
  // Database errors can contain interpolated values. Never log raw SQL exceptions.
  if (error?.code || error?.query || error?.parameters) throw new Error('Database provisioning failed; transaction rolled back. Review the isolated database privately.');
  throw error;
} finally { await connection.end(); }
