import type { Store } from './store.ts';
import type { SimulationEvent } from './protocol.ts';

/** Drain every bounded batch; failed acknowledgement never drops an event. */
export async function flushOutbox(store: Pick<Store, 'pendingEvents' | 'acknowledge'>, send: (events: SimulationEvent[]) => Promise<string[]>, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (store.pendingEvents().length) {
    if (Date.now() >= deadline) throw new Error('Telemetry sync deadline exceeded; remaining events retained locally.');
    const accepted = await send(store.pendingEvents());
    if (!accepted.length) throw new Error('No telemetry acknowledged; events retained locally.');
    store.acknowledge(accepted);
  }
}
