import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { credentialsSchema } from './protocol.ts';
import { loadOptions } from './config.ts';
import { SimulationRunner } from './runner.ts';
import { Store } from './store.ts';
import { HostedTransport } from './transport.ts';
import { protectionSecret } from './protection.ts';
import { flushOutbox } from './outbox.ts';

const command = process.argv[2] ?? 'run';
try {
  if (command === 'report') {
    const file = process.env.SIM_CREDENTIALS ?? '.state/credentials.json';
    const runId = process.env.SIM_RUN_ID ?? (existsSync(file) ? credentialsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).runId : undefined);
    if (!runId) throw new Error('Set SIM_RUN_ID or SIM_CREDENTIALS to identify the report.');
    const store = new Store(join(process.env.SIM_STATE_DIRECTORY ?? '.state', 'simulation.sqlite'), runId);
    console.log(JSON.stringify(store.report(), null, 2)); store.close();
  } else if (command === 'sync') {
    const { options, credentials } = loadOptions();
    const store = new Store(join(options.stateDirectory, 'simulation.sqlite'), options.runId);
    const hosted = new HostedTransport(credentials, protectionSecret());
    try { await hosted.manifest(); await flushOutbox(store, events => hosted.events(options.runId, events)); console.log(JSON.stringify({ runId: options.runId, pendingEvents: 0, actorsStarted: false })); }
    finally { store.close(); }
  } else if (command === 'run' || command === 'preflight') {
    const { options, credentials } = loadOptions();
    const runner = new SimulationRunner(options, credentials);
    process.once('SIGINT', () => runner.stop()); process.once('SIGTERM', () => runner.stop());
    if (command === 'preflight') { console.log(JSON.stringify(await runner.preflight(), null, 2)); runner.store.close(); }
    else await runner.run();
  } else throw new Error('Commands: run, preflight, report, sync. Configuration uses SIM_* environment variables.');
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
