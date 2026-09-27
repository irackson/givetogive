import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { LocalBrain } from '../src/brain.ts';
import { makePersonas } from '../src/personas.ts';
import type { AgentCheckpoint } from '../src/protocol.ts';

test('real Strands SDK handles local streamed tool output and isolates each agent prompt', async () => {
	const prompts: string[] = [];
	const expected = {
		tool: 'save_ask',
		argumentsJson: '{"askId":42,"saved":true}',
		summary: 'Save a useful Ask',
		memory: 'Garden Ask 42 is useful.',
		wakeAfterSeconds: 30,
	};
	const server = createServer(async (request, response) => {
		let body = '';
		for await (const chunk of request) body += String(chunk);
		prompts.push(body);
		response.writeHead(200, { 'content-type': 'text/event-stream' });
		for (const data of [
			{
				id: 'local-fixture',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'test-local',
				choices: [
					{
						index: 0,
						delta: {
							role: 'assistant',
							tool_calls: [
								{
									index: 0,
									id: 'tool-1',
									type: 'function',
									function: {
										name: 'strands_structured_output',
										arguments: JSON.stringify(expected),
									},
								},
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				id: 'local-fixture',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'test-local',
				choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
				usage: {
					prompt_tokens: 30,
					completion_tokens: 30,
					total_tokens: 60,
				},
			},
		])
			response.write(`data: ${JSON.stringify(data)}\n\n`);
		response.end('data: [DONE]\n\n');
	});
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve),
	);
	try {
		const address = server.address();
		assert.ok(address && typeof address === 'object');
		const accounts = [
			{ id: 'one', userId: 'user-one', token: 'super-secret-one' },
			{ id: 'two', userId: 'user-two', token: 'super-secret-two' },
		];
		const personas = makePersonas(accounts, 1);
		const tools = [
			{
				name: 'save_ask',
				description: 'Save an Ask.',
				inputSchema: {
					type: 'object',
					properties: {
						askId: { type: 'integer' },
						saved: { type: 'boolean' },
					},
				},
			},
		];
		for (const [index, persona] of personas.entries()) {
			const brain: LocalBrain = new LocalBrain(
				persona,
				`http://127.0.0.1:${address.port}/v1`,
				'test-local',
			);
			const state: AgentCheckpoint = {
				id: persona.id,
				state: 'idle',
				cycles: 0,
				actions: 0,
				failures: 0,
				nextWakeAt: 0,
				memories: [`private-${index}`],
				observation: 'Ask 42 exists.',
				paused: false,
				spentCents: 0,
			};
			assert.deepEqual(
				await brain.decide(state, tools, AbortSignal.timeout(5000)),
				expected,
			);
			assert.deepEqual(brain.lastDiagnostics, {
				assistantTurns: 1,
				validationFailures: 0,
				invalidFields: [],
			});
			assert.equal(
				brain.agent.messages.length,
				0,
				'completed turns must not retain raw model transcripts',
			);
		}
		assert.equal(prompts.length, 2);
		const requestBody = JSON.parse(prompts[0]!) as {
			tool_choice: unknown;
			chat_template_kwargs: { enable_thinking: boolean };
			max_completion_tokens: number;
		};
		assert.equal(requestBody.tool_choice, 'required');
		assert.equal(requestBody.chat_template_kwargs.enable_thinking, false);
		assert.equal(requestBody.max_completion_tokens, 128);
		assert.ok(prompts[0]!.includes('private-0'));
		assert.ok(!prompts[0]!.includes('private-1'));
		assert.ok(!prompts[1]!.includes('private-0'));
		assert.ok(!prompts.some((prompt) => prompt.includes('super-secret')));
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

test('schema retries expose only bounded diagnostics and discard raw transcripts', async () => {
	let calls = 0;
	const expected = {
		tool: 'wait',
		argumentsJson: '{}',
		summary: 'Wait briefly',
		memory: '',
		wakeAfterSeconds: 30,
	};
	const server = createServer(async (request, response) => {
		for await (const chunk of request) void chunk;
		const decision =
			++calls === 1 ?
				{
					...expected,
					tool: 'secret-untrusted-value',
					wakeAfterSeconds: 0,
				}
			:	expected;
		response.writeHead(200, { 'content-type': 'text/event-stream' });
		for (const data of [
			{
				id: 'retry-fixture',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'test-local',
				choices: [
					{
						index: 0,
						delta: {
							role: 'assistant',
							tool_calls: [
								{
									index: 0,
									id: `tool-${calls}`,
									type: 'function',
									function: {
										name: 'strands_structured_output',
										arguments: JSON.stringify(decision),
									},
								},
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				id: 'retry-fixture',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'test-local',
				choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
				usage: {
					prompt_tokens: 30,
					completion_tokens: 30,
					total_tokens: 60,
				},
			},
		])
			response.write(`data: ${JSON.stringify(data)}\n\n`);
		response.end('data: [DONE]\n\n');
	});
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve),
	);
	try {
		const address = server.address();
		assert.ok(address && typeof address === 'object');
		const [persona] = makePersonas(
			[{ id: 'retry', userId: 'retry-user', token: 'not-a-real-token' }],
			1,
		);
		const brain = new LocalBrain(
			persona!,
			`http://127.0.0.1:${address.port}/v1`,
			'test-local',
		);
		const state: AgentCheckpoint = {
			id: persona!.id,
			state: 'idle',
			cycles: 0,
			actions: 0,
			failures: 0,
			nextWakeAt: 0,
			memories: [],
			observation: 'Nothing needs doing.',
			paused: false,
			spentCents: 0,
		};
		assert.deepEqual(
			await brain.decide(state, [], AbortSignal.timeout(5000)),
			expected,
		);
		assert.equal(calls, 2);
		assert.deepEqual(brain.lastDiagnostics, {
			assistantTurns: 2,
			validationFailures: 1,
			invalidFields: ['tool', 'wakeAfterSeconds'],
		});
		assert.ok(
			!JSON.stringify(brain.lastDiagnostics).includes(
				'secret-untrusted-value',
			),
		);
		assert.equal(brain.agent.messages.length, 0);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
