import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Credentials } from './protocol.ts';

export const clockStateSchema = z.object({ runId: z.string(), clockId: z.string().regex(/^clock_[A-Za-z0-9]+$/), frozenTime: z.number().int().positive(), status: z.enum(['ready', 'advancing']), livemode: z.literal(false) });
export function assertClockCredentials(credentials: Credentials) {
  if (!credentials.clockControl || credentials.mode !== 'deterministic' || !credentials.runId || credentials.agents.length > 3) throw new Error('Clock control requires explicit provisioning of a separate one-to-three member deterministic cohort.');
}
export function clockBindingOperationId(runId: string, actorId: string) {
  const bytes = createHash('sha256').update(`clock-binding:${runId}:${actorId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function parseClockCommand(args: string[]) {
  if (args.length === 1 && ['create', 'read', 'bind'].includes(args[0]!)) return { action: args[0] as 'create' | 'read' | 'bind' };
  if (args.length === 5 && args[0] === 'advance' && args[1] === '--operation-id' && args[3] === '--to') {
    const operationId = z.uuid().safeParse(args[2]); const time = z.iso.datetime().safeParse(args[4]);
    if (operationId.success && time.success) return { action: 'advance' as const, operationId: operationId.data, frozenTime: Math.floor(Date.parse(time.data) / 1000) };
  }
  throw new Error('Clock commands: create, read, bind, or advance --operation-id <stable-UUID> --to <ISO-UTC-time>.');
}
