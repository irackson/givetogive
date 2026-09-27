import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

test('official stateless MCP transport initializes, discovers, and executes scoped tools', async () => {
	async function request(body: Record<string, unknown>) {
		// Mirrors the Next route: a new authenticated server and transport for each POST.
		const server = new McpServer({
			name: 'givetogive-contract-test',
			version: '1.0.0',
		});
		server.registerTool(
			'get_me',
			{
				inputSchema: z.object({}).strict(),
				annotations: { readOnlyHint: true },
			},
			() => ({
				content: [{ type: 'text', text: 'synthetic-one' }],
				structuredContent: { id: 'synthetic-one' },
			}),
		);
		server.registerTool(
			'save_ask',
			{
				inputSchema: z
					.object({ askId: z.number().int(), saved: z.boolean() })
					.strict(),
			},
			(args, extra) => ({
				content: [{ type: 'text', text: 'saved' }],
				structuredContent: {
					...args,
					correlationId: extra._meta?.['givetogive/correlationId'],
				},
			}),
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			maxRequestBodySize: 1024,
		});
		await server.connect(transport);
		try {
			const response = await transport.handleRequest(
				new Request('https://givetogive-staging.example/mcp', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json, text/event-stream',
					},
					body: JSON.stringify(body),
				}),
			);
			return {
				status: response.status,
				body: (await response.json()) as {
					result?: {
						tools?: { name: string }[];
						structuredContent?: Record<string, unknown>;
						isError?: boolean;
					};
					error?: { message: string };
				},
			};
		} finally {
			await server.close();
		}
	}
	const initialized = await request({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'test-client', version: '1' },
		},
	});
	assert.equal(initialized.status, 200);
	const listed = await request({
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
	});
	assert.deepEqual(
		listed.body.result?.tools?.map((tool) => tool.name),
		['get_me', 'save_ask'],
	);
	const called = await request({
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/call',
		params: {
			name: 'save_ask',
			arguments: { askId: 42, saved: true },
			_meta: { 'givetogive/correlationId': 'a-test-operation' },
		},
	});
	assert.deepEqual(called.body.result?.structuredContent, {
		askId: 42,
		saved: true,
		correlationId: 'a-test-operation',
	});
	const malformed = await request({
		jsonrpc: '2.0',
		id: 4,
		method: 'tools/call',
		params: {
			name: 'save_ask',
			arguments: { askId: 42, saved: true, actorId: 'another-user' },
		},
	});
	assert.equal(malformed.body.result?.isError, true);
});
