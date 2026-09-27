// Keep deployment protection enabled; create only a scoped staging automation secret.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const destination = 'tools/simulation/.state/protection.json';
const projectId = 'prj_HvlFV1kKHVsML73nlsJAFQNA7grP';
const teamId = 'team_TXid48wU77cfhEg28L3EyLpn';
// Standard protection excludes the canonical production domain, including a
// staging project's main alias. Require all URLs, without changing paid plans.
await new Promise((resolve, reject) => {
  const child = spawn('vercel', ['api', `/v9/projects/${projectId}?teamId=${teamId}`, '-X', 'PATCH', '--input', '-', '--raw'], { shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', () => {});
  child.on('error', () => reject(new Error('Could not start Vercel CLI.')));
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error('All-deployment protection could not be configured. Do not expose staging or upgrade plans automatically.'));
    try {
      if (JSON.parse(output).ssoProtection?.deploymentType !== 'all') throw new Error();
      resolve();
    } catch { reject(new Error('Staging all-deployment protection was not confirmed.')); }
  });
  child.stdin.end(JSON.stringify({ ssoProtection: { deploymentType: 'all' } }));
});
console.log('Staging protection applies to all deployment URLs.');
if (existsSync(destination)) {
  console.log('Staging automation credential already exists; no rotation performed.');
} else {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('vercel', ['api', `/v1/projects/${projectId}/protection-bypass?teamId=${teamId}`, '-X', 'PATCH', '--input', '-', '--raw'], { shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', () => {});
    child.on('error', () => reject(new Error('Could not start Vercel CLI.')));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Staging protection setup failed (exit ${code}). No secret printed.`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Unexpected Vercel response. No secret printed.')); }
    });
    child.stdin.end('{}');
  });
  const entries = Object.entries(result.protectionBypass ?? {});
  const candidate = entries.find(([, value]) => value.scope === 'automation-bypass');
  if (!candidate || candidate[0].length < 16) throw new Error('No automation bypass credential in response.');
  mkdirSync('tools/simulation/.state', { recursive: true });
  writeFileSync(destination, JSON.stringify({ vercelProtectionBypass: candidate[0] }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ projectId, protectionStillEnabled: true, secretSavedTo: destination }));
}
