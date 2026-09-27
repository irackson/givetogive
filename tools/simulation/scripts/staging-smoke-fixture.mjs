// Maintainer-only synthetic acceptance fixture. Normal runs are created in the admin UI.
import postgres from 'postgres';
const [command, runId] = process.argv.slice(2);
if (!['create', 'report', 'resume-agents', 'retire'].includes(command) || !/^sim-smoke-deterministic-[a-z0-9-]{1,35}$/.test(runId ?? '')) throw new Error('Expected create|report|resume-agents|retire and a sim-smoke-deterministic-* ID.');
if (process.env.APP_ENV !== 'staging' || process.env.SIMULATION_ENABLED !== 'true' || !process.env.DATABASE_IDENTITY) throw new Error('Isolated staging configuration required.');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [identity] = await sql`select current_database() as name, current_user as role`;
  const [marker] = await sql`select * from givetogive_environment_identity where id=1`;
  if (identity.name !== 'givetogive_staging_20260926' || identity.role !== identity.name || marker?.environment !== 'staging' || marker.database_name !== identity.name || marker.identity !== process.env.DATABASE_IDENTITY) throw new Error('Unexpected staging identity.');
  if (command === 'create') await sql.begin(async tx => {
    const [admin] = await tx`select * from givetogive_user where id='synthetic-stage-admin' for share`;
    if (!admin?.is_synthetic || admin.role !== 'admin' || !admin.email_verified || admin.frozen_at) throw new Error('Expected active synthetic staging administrator.');
    await tx`insert into givetogive_simulation_run (id,name,mode,environment,database_identity,created_by,agent_count,settings) values (${runId},'Deterministic ten-member acceptance smoke','deterministic','staging',${marker.identity},${admin.id},10,${tx.json({ acceptance: 'deterministic-only', paidEntitlementsProvisioned: false })})`;
    await tx`insert into givetogive_operation_event (external_id,environment,actor_id,entity_type,entity_id,action,outcome,run_id,summary) values (${`${runId}:fixture-created`},'staging',${admin.id},'simulation',${runId},'simulation_smoke_provision_requested','created',${runId},'Explicitly authorized synthetic deterministic acceptance run; not an autonomous or financial acceptance run.')`;
  });
  const [run] = await sql`select * from givetogive_simulation_run where id=${runId}`;
  if (!run || run.created_by !== 'synthetic-stage-admin' || run.database_identity !== marker.identity || run.mode !== 'deterministic' || run.agent_count !== 10) throw new Error('Unexpected smoke fixture ownership.');
  if (command === 'resume-agents') {
    if (['completed', 'stopped', 'cancelled'].includes(run.status)) throw new Error('Terminal smoke runs cannot resume.');
    await sql`insert into givetogive_simulation_command (run_id,actor_id,type,agent_id) select ${runId},${run.created_by},'resume_agent',id from givetogive_simulation_agent where run_id=${runId}`;
  }
  if (command === 'retire') await sql.begin(async tx => {
    await tx`update givetogive_api_token set revoked_at=now(),expires_at=now() where run_id=${runId}`;
    await tx`update givetogive_simulation_run set status='stopped',finished_at=coalesce(finished_at,now()) where id=${runId} and status not in ('completed','stopped','cancelled')`;
    await tx`insert into givetogive_operation_event (external_id,environment,actor_id,entity_type,entity_id,action,outcome,run_id,summary) values (${`${runId}:fixture-retired`},'staging',${run.created_by},'simulation',${runId},'simulation_smoke_retired','stopped',${runId},'Run-scoped tokens revoked and expired; immutable run and action history retained.') on conflict (external_id) do nothing`;
  });
  const [current] = await sql`select id,status,mode,agent_count,last_heartbeat_at,started_at,finished_at,metrics from givetogive_simulation_run where id=${runId}`;
  const agents = await sql`select id,state,cycles,last_action,updated_at from givetogive_simulation_agent where run_id=${runId} order by id`;
  const audit = await sql`select action,outcome,count(*)::int as count from givetogive_operation_event where run_id=${runId} group by action,outcome order by action,outcome`;
  const tokens = await sql`select count(*)::int as total,count(*) filter(where revoked_at is not null)::int as revoked from givetogive_api_token where run_id=${runId}`;
  const failures = await sql`select summary from givetogive_operation_event where run_id=${runId} and outcome='failed' order by id desc limit 10`;
  console.log(JSON.stringify({ run: current, agents, audit, tokens, failures }, null, 2));
} catch (error) {
  if (error?.code || error?.query || error?.parameters) throw new Error('Staging smoke fixture query failed; sensitive database details omitted.');
  throw error;
} finally { await sql.end(); }
