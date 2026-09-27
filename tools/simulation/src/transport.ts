import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { allowedTools, controlSchema, type AgentCredentials, type Credentials, type SimulationEvent } from './protocol.ts';
import { validateManifest } from './config.ts';
import { protectionHeaders } from './protection.ts';

export class HostedTransport {
  private credentials: Credentials;
  private bypass?: string;
  constructor(credentials: Credentials, bypass?: string) { this.credentials = credentials; this.bypass = bypass; }
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, this.credentials.origin), {
      ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.credentials.runnerToken}`, ...protectionHeaders(this.bypass), ...init.headers },
    });
    if (!response.ok) throw new Error(`Hosted transport ${response.status} on ${new URL(path, this.credentials.origin).pathname}`);
    return response.json() as Promise<unknown>;
  }
  async manifest() { return validateManifest(await this.request('/api/simulation/manifest'), this.credentials); }
  async events(runId: string, events: SimulationEvent[]): Promise<string[]> {
    if (!events.length) return [];
    const result = await this.request('/api/simulation/events', { method: 'POST', body: JSON.stringify({ runId, events }) }) as { acceptedIds?: unknown };
    if (!Array.isArray(result.acceptedIds) || result.acceptedIds.some((id) => typeof id !== 'string')) throw new Error('Invalid event acknowledgement.');
    const submitted = new Set(events.map(({ id }) => id));
    return (result.acceptedIds as string[]).filter((id) => submitted.has(id));
  }
  async control(runId: string, cursor: string) {
    return controlSchema.parse(await this.request(`/api/simulation/control?runId=${encodeURIComponent(runId)}&after=${encodeURIComponent(cursor)}`));
  }
  async clock(command: { action: 'create' | 'read' } | { action: 'advance'; operationId: string; frozenTime: number }) {
    if (!this.credentials.clockControl) throw new Error('This credential file does not grant explicit clock control.');
    return this.request('/api/simulation/clock', { method: 'POST', body: JSON.stringify(command) });
  }
}

export type RemoteTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export function modelSafePaymentResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelSafePaymentResult);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/url|client.?secret|token/i.test(key)).map(([key, child]) => [key, modelSafePaymentResult(child)]));
  return typeof value === 'string' && /https:\/\/(?:checkout|billing)\.stripe\.com\//.test(value) ? '[private Stripe URL withheld]' : value;
}
export class MemberClient {
  private client?: Client;
  private origin: string;
  private credentials: AgentCredentials;
  private bypass?: string;
  constructor(origin: string, credentials: AgentCredentials, bypass?: string) { this.origin = origin; this.credentials = credentials; this.bypass = bypass; }
  async connect(): Promise<RemoteTool[]> {
    const client = new Client({ name: `givetogive-simulation-${this.credentials.id}`, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', this.origin), {
      requestInit: { headers: { Authorization: `Bearer ${this.credentials.token}`, ...protectionHeaders(this.bypass) }, redirect: 'error' },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== new URL(this.origin).origin) throw new Error('Cross-origin MCP request blocked.');
        return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30000)]) });
      },
    });
    try {
      await client.connect(transport);
      this.client = client;
      const listed = await client.listTools();
      const result = listed.tools.filter((tool) => allowedTools.includes(tool.name as typeof allowedTools[number]));
      if (!result.some((tool) => tool.name === 'get_me')) throw new Error('MCP must expose get_me for identity verification.');
      const me = await this.call('get_me', {}, 'identity-verification');
      let identity = me as { id?: string; user?: { id?: string } };
      if (Array.isArray(me)) {
        const block = me.find((entry: { type?: string }) => entry.type === 'text') as { text?: string } | undefined;
        if (block?.text) identity = JSON.parse(block.text) as typeof identity;
      }
      if ((identity.user?.id ?? identity.id) !== this.credentials.userId) throw new Error('MCP identity does not match provisioned account.');
      return result as RemoteTool[];
    } catch (error) { await client.close().catch(() => undefined); this.client = undefined; throw error; }
  }
  async call(name: string, input: Record<string, unknown>, correlationId: string) {
    if (!this.client) throw new Error('MCP is not connected.');
    if (!allowedTools.includes(name as typeof allowedTools[number])) throw new Error('Tool not allowed.');
    const result = await this.client.callTool({ name, arguments: input, _meta: { 'givetogive/correlationId': correlationId } }, undefined, { timeout: 30000 });
    if (result.isError) throw new Error(`MCP rejected ${name}: ${JSON.stringify(result.content).slice(0, 400)}`);
    const output = result.structuredContent ?? result.content;
    return ['prepare_checkout', 'get_operation_status'].includes(name) ? modelSafePaymentResult(output) : output;
  }
  /** Not returned in model discovery and not accepted by call()/decisionSchema. */
  async sandboxRead(kind: 'context' | 'outcome', operationId: string) {
    if (!this.client) throw new Error('MCP is not connected.');
    const name = kind === 'context' ? 'get_test_checkout_context' : 'get_test_checkout_outcome';
    const result = await this.client.callTool({ name, arguments: { operationId } }, undefined, { timeout: 30000 });
    if (result.isError || !result.structuredContent) throw new Error('The private sandbox verification read is unavailable.');
    return result.structuredContent;
  }
  async bindTestClock(correlationId: string) {
    if (!this.client) throw new Error('MCP is not connected.');
    const result = await this.client.callTool({ name: 'bind_test_clock', arguments: {}, _meta: { 'givetogive/correlationId': correlationId } }, undefined, { timeout: 30000 });
    if (result.isError || !result.structuredContent) throw new Error('Own-account sandbox clock binding failed.');
    return result.structuredContent;
  }
  async close() { await this.client?.close(); this.client = undefined; }
}
