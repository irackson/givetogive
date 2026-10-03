// Private production-runtime old/new/rollback browser rehearsal on the reviewed copy only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { freemem } from 'node:os';
import postgres from 'postgres';
import { chromium, expect } from '@playwright/test';
import superjson from 'superjson';
import { releaseRehearsalEnvironment, verifyReleaseRehearsalBinding, RELEASE_REHEARSAL_TARGET } from './release-rehearsal-environment.ts';
import { hashPassword } from '../src/server/auth/password.ts';
import { readMigrationFiles, verifyMigrationHistory } from './migration-history.ts';
import { releaseSourceDigest, releaseGeneratedWorkflowDigest } from './release-rehearsal-fingerprint.mjs';

const currentName = process.argv[2];
assert.match(currentName ?? '', /^release-current-[a-f0-9]{12}$/);
const port = 3111, origin = `http://127.0.0.1:${port}`, runId = randomUUID();
const out = resolve('tmp', `release-compatibility-${runId}`);
mkdirSync(out, { recursive: true });
const env = releaseRehearsalEnvironment(process.env, port); // Fresh secret shared only within this one run, never on disk.
const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice() {}, connection: { statement_timeout: 15000, lock_timeout: 3000 } });
const checks = [], serverChecks = [], browserErrors = [], consoleErrors = [], unexpectedRequests = [];
let phase = 'built-source-preflight', child, browser, members = [], context, helperContext, page, helper, oldAsk, newAsk, cleanupVerified = false;
async function binding() {
  const [identity] = await sql`select current_database() as database,current_setting('neon.project_id',true) as project,current_setting('neon.branch_id',true) as branch`;
  verifyReleaseRehearsalBinding(identity);
  const migrations = verifyMigrationHistory(readMigrationFiles(), await sql`select hash,created_at from drizzle.__drizzle_migrations order by created_at,id`);
  assert.equal(migrations.appliedMigrationCount, 19); assert.equal(migrations.pendingMigrations.length, 0);
}
function builtSnapshot(name) {
  const snapshot = resolve('tmp', name);
  assert.equal(lstatSync(snapshot).isSymbolicLink(), false);
  assert.equal(readdirSync(snapshot).some(n => /^\.env($|\.)/.test(n) && n !== '.env.example'), false);
  const manifest = JSON.parse(readFileSync(join(snapshot, '.release-rehearsal-build.json'), 'utf8'));
  assert.equal(manifest.targetBranch, RELEASE_REHEARSAL_TARGET.branch);
  assert.equal(manifest.paymentsDisabled, true); assert.equal(manifest.externalEmailDisabled, true);
  assert.equal(manifest.sourceDigest, releaseSourceDigest(snapshot));
  assert.equal(manifest.generatedWorkflowDigest ?? null, releaseGeneratedWorkflowDigest(snapshot));
  if (name === 'release-old-e2cd44d') assert.equal(manifest.sourceDigest, '860be01437a305c0a3cc9b8e63a9b92df1d4797e4750957f28496be75d1527b9');
  assert.equal(manifest.buildId, readFileSync(join(snapshot, '.next', 'BUILD_ID'), 'utf8').trim());
  return { snapshot, manifest };
}
function listenerOwner() {
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; ConvertTo-Json -Compress -InputObject @($p)`], { encoding: 'utf8', windowsHide: true });
  return JSON.parse(raw || '[]');
}
async function ownedListener() { assert.deepEqual(listenerOwner(), [child.pid]); await binding(); }
async function stop() {
  if (!child) return;
  const owned = child; child = undefined;
  if (owned.exitCode === null) {
    owned.kill('SIGTERM');
    await Promise.race([new Promise(r => owned.once('exit', r)), new Promise((__unused, reject) => setTimeout(() => reject(new Error('Owned server did not stop')), 15000))]);
  }
  await expect.poll(listenerOwner, { timeout: 15000 }).toEqual([]);
}
async function start(name) {
  assert.equal(freemem() >= 1.5 * 2 ** 30, true);
  await binding(); assert.deepEqual(listenerOwner(), []);
  const { snapshot, manifest } = builtSnapshot(name);
  const info = { snapshot: name, digest: manifest.sourceDigest, diagnosticChunks: 0, diagnosticCategories: [], serverExitedUnexpectedly: false };
  child = spawn(process.execPath, [join(snapshot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: snapshot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => {
    info.diagnosticChunks++;
    const text = chunk.toString();
    // Emit only categories, never raw SQL/Auth.js/provider diagnostics or paths.
    const warningOnly = !/\b(?:Error|error|failed|Failed)\b|\[auth\]/.test(text);
    info.diagnosticCategories.push(warningOnly && text.includes('Warning: Next.js inferred your workspace root') ? 'next-workspace-root-warning'
      : warningOnly && text.includes('[baseline-browser-mapping]') ? 'baseline-browser-mapping-warning' : 'unknown-diagnostic');
  }); child.stdout.on('data', () => {});
  child.once('exit', () => { if (child) info.serverExitedUnexpectedly = true; });
  await expect.poll(listenerOwner, { timeout: 45000 }).toEqual([child.pid]);
  await expect.poll(async () => { try { return (await fetch(`${origin}/signin`)).status; } catch { return 0; } }, { timeout: 45000 }).toBe(200);
  await ownedListener(); serverChecks.push(info);
}
async function rpc(p, procedure, input, method = 'post') {
  await ownedListener();
  const serialized = superjson.serialize(input);
  const response = method === 'get' ? await p.request.get(`${origin}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(serialized))}`) : await p.request.post(`${origin}/api/trpc/${procedure}`, { data: serialized });
  const body = await response.json();
  return { status: response.status(), data: body.result ? superjson.deserialize(body.result.data) : undefined };
}
async function login(p, member) {
  await ownedListener();
  const existing = await p.request.get(`${origin}/api/auth/session`).then(r => r.json());
  if (existing?.user?.id) {
    await p.goto(`${origin}/signout`); await ownedListener();
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(p).toHaveURL(`${origin}/`);
    assert.equal((await p.request.get(`${origin}/api/auth/session`).then(r => r.json()))?.user, undefined);
  }
  await p.goto(`${origin}/signin`);
  await p.getByLabel('Email').fill(member.email); await p.getByLabel('Password').fill(member.password);
  await ownedListener(); await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p).toHaveURL(`${origin}/`, { timeout: 30000 });
  assert.equal((await p.request.get(`${origin}/api/auth/session`).then(r => r.json())).user.id, member.id);
}
async function createAsk(p, title) {
  await p.goto(`${origin}/asks`); await p.getByRole('button', { name: 'Post an ask' }).click();
  await p.getByLabel('Title').fill(title); await p.getByLabel('Description').fill('Private release rehearsal. Two tasks need practical neighbor help.');
  await p.getByLabel('Goal (tasks)').fill('2'); await ownedListener(); await p.getByRole('button', { name: 'Create Ask' }).click();
  await expect(p.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 30000 });
  const slug = new URL(p.url()).pathname.split('/').pop();
  const result = await rpc(p, 'ask.getAsk', { slug }, 'get'); assert.equal(result.status, 200);
  assert.equal(result.data.createdById, members[0].id); return { id: result.data.id, slug, title };
}
async function contribute(p, ask, amount, note) {
  await p.goto(`${origin}/asks/${ask.slug}`); await p.getByRole('button', { name: 'Offer a contribution' }).click();
  await p.getByLabel('Amount (tasks)').fill(String(amount)); await p.getByLabel('A note for the asker (optional)').fill(note);
  await ownedListener(); await p.getByRole('button', { name: 'Confirm contribution' }).click();
  await expect(p.getByRole('dialog')).toHaveCount(0); await expect(p.getByText(note, { exact: true })).toBeVisible();
  const result = await rpc(p, 'ask.getAsk', { id: ask.id }, 'get'); assert.equal(result.status, 200);
  const contribution = result.data.contributions.find(c => c.note === note);
  assert.equal(contribution.contributorId, members[1].id); return contribution.id;
}
async function save(p, ask) {
  await p.goto(`${origin}/asks?q=${encodeURIComponent(ask.title)}`);
  const card = p.locator('.ask-card').filter({ has: p.getByRole('heading', { name: ask.title, exact: true }) });
  await expect(card).toHaveCount(1); await ownedListener(); await card.getByRole('button', { name: /save/i }).click();
  await expect(card.getByRole('button', { name: /unsave|remove/i })).toBeVisible();
  assert.equal((await rpc(p, 'ask.getAsks', { savedOnly: true, query: ask.title }, 'get')).data.some(a => a.id === ask.id), true);
}
async function screenshot(p, label) { await p.screenshot({ path: join(out, `${label}.png`), fullPage: true }); }
try {
  builtSnapshot('release-old-e2cd44d'); builtSnapshot(currentName);
  phase = 'binding'; await binding(); phase = 'fixture-bootstrap';
  const password = `Private-${randomUUID()}!`, hash = await hashPassword(password);
  members = ['Compatibility Owner', 'Compatibility Helper'].map((name, i) => ({ id: randomUUID(), name, email: `givetogive-release-compat-${runId}-${i}@example.invalid`, password }));
  // IDs alone permit safe cleanup after a host crash; no password/session secret is serialized.
  writeFileSync(join(out, 'fixture-identities.json'), JSON.stringify({ runId, ids: members.map(m => m.id) }, null, 2));
  await binding();
  await sql`insert into givetogive_user ${sql(members.map(({ id, name, email }) => ({ id, name, email, hashed_password: hash, email_verified: new Date(), is_synthetic: true })))}`;
  browser = await chromium.launch({ headless: true }); context = await browser.newContext(); helperContext = await browser.newContext();
  page = await context.newPage(); helper = await helperContext.newPage();
  for (const p of [page, helper]) {
    p.on('pageerror', () => browserErrors.push({ phase, category: 'pageerror' }));
    p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ phase, category: 'console-error' }); });
    await p.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'about:', 'blob:'].includes(url.protocol)) { unexpectedRequests.push({ phase, host: url.hostname }); return route.abort(); }
      return route.continue();
    });
  }
  phase = 'legacy-ui'; await start('release-old-e2cd44d');
  phase = 'legacy-ui-login'; await login(page, members[0]); await login(helper, members[1]); phase = 'legacy-ui-actions';
  oldAsk = await createAsk(page, `Compatibility old ${runId}`); await save(helper, oldAsk);
  const oldContribution = await contribute(helper, oldAsk, 1, 'Old UI contribution survives rollout.');
  const oldOwnerSession = await page.request.get(`${origin}/api/auth/session`).then(r => r.json());
  assert.equal(oldOwnerSession.user.role, undefined);
  await screenshot(page, 'legacy-owner'); await screenshot(helper, 'legacy-helper'); checks.push('legacy-real-ui-login-create-save-partial-contribution');
  await stop(); phase = 'current-ui-existing-cookie'; await start(currentName);
  const upgraded = await page.request.get(`${origin}/api/auth/session`).then(r => r.json());
  assert.equal(upgraded.user.id, members[0].id); assert.equal(upgraded.user.role, 'member'); assert.equal(upgraded.user.authenticatedAt, 0);
  await page.goto(`${origin}/asks/${oldAsk.slug}`); await expect(page.getByText('This is your Ask.')).toBeVisible();
  await helper.goto(`${origin}/asks?saved=1&q=${encodeURIComponent(oldAsk.title)}`); await expect(helper.locator('.ask-card')).toHaveCount(1);
  await page.goto(`${origin}/asks/${oldAsk.slug}`); await ownedListener(); await page.getByRole('button', { name: /mark complete/i }).click();
  const completion = page.getByRole('dialog'); if (await completion.count()) await completion.getByRole('button', { name: /mark complete|confirm/i }).click();
  await expect.poll(async () => (await rpc(page, 'ask.getAsk', { id: oldAsk.id }, 'get')).data.completedAmount).toBe(1);
  assert.equal((await rpc(page, 'ask.getAsk', { id: oldAsk.id }, 'get')).data.contributions.find(c => c.id === oldContribution).status, 'completed');
  checks.push('legacy-cookie-current-refresh-no-fabricated-step-up-and-legacy-data-ui');
  phase = 'current-ui-fresh-login'; await login(page, members[0]); await login(helper, members[1]); phase = 'current-ui-actions';
  newAsk = await createAsk(page, `Compatibility current ${runId}`); await save(helper, newAsk);
  const newContribution = await contribute(helper, newAsk, 1, 'Current UI contribution survives rollback.');
  await screenshot(page, 'current-owner'); await screenshot(helper, 'current-helper'); checks.push('current-real-ui-login-create-save-partial-contribution');
  await stop(); phase = 'legacy-rollback-existing-cookie'; await start('release-old-e2cd44d');
  assert.equal((await page.request.get(`${origin}/api/auth/session`).then(r => r.json())).user.id, members[0].id);
  await page.goto(`${origin}/asks/${newAsk.slug}`); await expect(page.getByText('This is your Ask.')).toBeVisible();
  await helper.goto(`${origin}/asks?saved=1&q=${encodeURIComponent(newAsk.title)}`); await expect(helper.locator('.ask-card')).toHaveCount(1);
  await page.goto(`${origin}/asks/${newAsk.slug}`); await ownedListener(); await page.getByRole('button', { name: /mark complete/i }).click();
  const dialog = page.getByRole('dialog'); if (await dialog.count()) await dialog.getByRole('button', { name: /mark complete|confirm/i }).click();
  await expect.poll(async () => (await rpc(page, 'ask.getAsk', { id: newAsk.id }, 'get')).data.completedAmount).toBe(1);
  assert.equal((await rpc(page, 'ask.getAsk', { id: newAsk.id }, 'get')).data.contributions.find(c => c.id === newContribution).status, 'completed');
  await screenshot(page, 'rollback-owner'); checks.push('current-cookie-and-new-data-real-legacy-rollback-ui');
  assert.deepEqual(browserErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedRequests, []);
  assert.equal(serverChecks.every(check => !check.diagnosticCategories.includes('unknown-diagnostic') && !check.serverExitedUnexpectedly), true);
  checks.push('no-browser-errors-or-external-provider-requests');
} catch (error) {
  process.exitCode = 1;
  const sourceLocation = /rehearse-release-browser\.mjs:(\d+):(\d+)/.exec(error?.stack ?? '');
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ phase, category: error?.name ?? 'runtime', harnessLine: sourceLocation ? Number(sourceLocation[1]) : null, completed: checks, detailsWithheld: true }, null, 2));
  console.log(JSON.stringify({ compatibility: 'incomplete', phase, completed: checks, detailsWithheld: true, evidenceDirectory: out }));
} finally {
  try { await browser?.close(); await stop(); } catch { process.exitCode = 1; }
  try {
    phase = 'fixture-cleanup'; await binding();
    const ids = members.map(m => m.id);
    if (ids.length) await sql.begin(async transaction => {
      const rows = await transaction`select id,email,is_synthetic from givetogive_user where id in ${transaction(ids)}`;
      assert.equal(rows.every(row => row.is_synthetic && row.email.startsWith(`givetogive-release-compat-${runId}-`) && row.email.endsWith('@example.invalid')), true);
      await transaction`delete from givetogive_saved_ask where user_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_ask_activity where actor_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_ask_contribution where contributor_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_ask where created_by in ${transaction(ids)}`;
      await transaction`delete from givetogive_auth_token where user_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_session where user_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_account where user_id in ${transaction(ids)}`;
      await transaction`delete from givetogive_user where id in ${transaction(ids)}`;
    });
    cleanupVerified = !ids.length || (await sql`select id from givetogive_user where id in ${sql(ids)}`).length === 0;
  } catch { process.exitCode = 1; }
  await sql.end();
  const evidence = { observedAt: new Date().toISOString(), runId, targetBranch: RELEASE_REHEARSAL_TARGET.branch, checks, serverChecks, browserErrors, consoleErrors, unexpectedRequests,
    productionWrites: false, fixturesRemoved: cleanupVerified, realOAuthVerified: false, externalEmailVerified: false, paymentAcceptanceVerified: false,
    browserCompatibilityVerified: process.exitCode !== 1, evidenceDirectory: out };
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
}
