// Secrets travel via stdin, never command arguments or console output.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { isolatedConfiguration, verifyIsolatedTarget } from './isolated-environment.ts';
const project = 'prj_HvlFV1kKHVsML73nlsJAFQNA7grP';
const values = parseEnv(readFileSync('.env.staging.local', 'utf8'));
const configuration = isolatedConfiguration(values, 'staging');
const connection = postgres(configuration.pooledUrl, { max: 1, onnotice: () => {} });
try { await verifyIsolatedTarget(connection, configuration); }
finally { await connection.end(); }
for (const [key, value] of Object.entries(values)) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error('Unexpected environment key.');
  if (key === 'DATABASE_URL_UNPOOLED') continue;
  await new Promise((resolve, reject) => {
    const child = spawn('vercel', ['env', 'add', key, 'production,preview', '--project', project, '--sensitive', '--force', '--yes'], { shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe','ignore','pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Failed to configure ${key}; exit ${code}. ${stderr.includes('Unauthorized') ? 'Authentication required.' : ''}`)));
    child.stdin.end(value);
  });
  console.log(`Configured staging ${key}`);
}
