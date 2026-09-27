import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { MemberClient } from '../src/transport.ts';

test('runner member client uses real MCP protocol, private auth/bypass headers, and verified identity', async () => {
  const calls: { name: string; correlation?: unknown }[] = [];
  const token = 'fixture-token-that-is-never-in-a-prompt';
  const bypass = 'fixture-protection-that-is-never-in-a-prompt';
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.headers.authorization !== `Bearer ${token}` || incoming.headers['x-vercel-protection-bypass'] !== bypass) {
      outgoing.writeHead(401); outgoing.end(); return;
    }
    if (incoming.method !== 'POST') { outgoing.writeHead(405); outgoing.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const mcp = new McpServer({ name: 'simulation-wire-fixture', version: '1' });
    mcp.registerTool('get_me', { inputSchema: z.object({}) }, () => ({ content: [], structuredContent: { id: 'user-one' } }));
    mcp.registerTool('save_ask', { inputSchema: z.object({ askId: z.number(), saved: z.boolean() }) }, (args, extra) => {
      calls.push({ name: 'save_ask', correlation: extra._meta?.['givetogive/correlationId'] });
      return { content: [], structuredContent: { ...args } };
    });
    mcp.registerTool('admin_freeze', { inputSchema: z.object({}) }, () => ({ content: [] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await mcp.connect(transport);
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
      const response = await transport.handleRequest(new Request(`http://${incoming.headers.host}/mcp`, { method: 'POST', headers, body: Buffer.concat(chunks) }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } finally { await mcp.close(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const client = new MemberClient(origin, { id: 'one', userId: 'user-one', token }, bypass);
  try {
    assert.deepEqual((await client.connect()).map(tool => tool.name), ['get_me', 'save_ask']);
    assert.deepEqual(await client.call('save_ask', { askId: 42, saved: true }, 'stable-correlation'), { askId: 42, saved: true });
    assert.deepEqual(calls, [{ name: 'save_ask', correlation: 'stable-correlation' }]);
    await assert.rejects(client.call('admin_freeze', {}, 'forbidden'), /not allowed/);
    const wrongIdentity = new MemberClient(origin, { id: 'two', userId: 'user-two', token }, bypass);
    await assert.rejects(wrongIdentity.connect(), /identity does not match/);
    const missingBypass = new MemberClient(origin, { id: 'one', userId: 'user-one', token });
    await assert.rejects(missingBypass.connect());
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
