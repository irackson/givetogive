import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { isolatedConfiguration, verifyIsolatedTarget } from './isolated-environment.ts';
const port = process.env.PORT ?? '3010';
const command = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(command)) throw new Error('Expected dev, build or start.');
const configuration = isolatedConfiguration(process.env, 'staging');
const connection = postgres(configuration.pooledUrl, { max: 1, onnotice: () => {} });
try { await verifyIsolatedTarget(connection, configuration); }
finally { await connection.end(); }
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', command, ...(command === 'build' ? [] : ['--port', port])], {
  env: { ...process.env, NODE_ENV: command === 'dev' ? 'development' : 'production',
    ...(command === 'build' ? {} : { APP_URL: `http://localhost:${port}`, NEXTAUTH_URL: `http://localhost:${port}` }) },
  stdio: 'inherit', windowsHide: true,
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
