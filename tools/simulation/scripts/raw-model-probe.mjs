/** Short local inference diagnostic, not autonomous-agent acceptance. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { execFileSync } from 'node:child_process';
const model = process.argv[2];
if (!['gemma', 'qwen'].includes(model))
	throw new Error('Specify gemma or qwen.');
const key = readFileSync(
	new URL('../.runtime/server-key.txt', import.meta.url),
	'utf8',
).trim();
const gib = () => Number((freemem() / 2 ** 30).toFixed(2));
const before = gib();
if (before < 1.5)
	throw new Error(
		'Raw probe requires at least 1.5 GiB free RAM after loading.',
	);
let minimumFreeGiB = before;
const controller = new AbortController();
const monitor = setInterval(() => {
	minimumFreeGiB = Math.min(minimumFreeGiB, gib());
	if (minimumFreeGiB < 1) controller.abort();
}, 500);
const started = performance.now();
const result = {
	capturedAt: new Date().toISOString(),
	model,
	kind: 'raw-local-only-probe',
	maxOutputTokens: 32,
	ramBeforeGiB: before,
};
try {
	const response = await fetch('http://127.0.0.1:8089/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${key}`,
			'Content-Type': 'application/json',
		},
		signal: AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(45000),
		]),
		body: JSON.stringify({
			model,
			messages: [
				{
					role: 'user',
					content:
						'What is one plus one? Reply with only the number.',
				},
			],
			max_tokens: 32,
			temperature: 0,
		}),
	});
	if (!response.ok) throw new Error(`Local server HTTP ${response.status}`);
	const body = await response.json();
	result.correct = body.choices?.[0]?.message?.content?.trim() === '2';
	result.finishReason = body.choices?.[0]?.finish_reason ?? null;
	result.usage = body.usage;
	result.timings = body.timings;
} catch (error) {
	// Deliberately do not serialize provider bodies, prompts or authentication.
	result.correct = false;
	result.error =
		controller.signal.aborted ? 'resource_floor'
		: error?.name === 'TimeoutError' ? 'timeout_45_seconds'
		: 'local_probe_failed';
} finally {
	clearInterval(monitor);
}
result.elapsedMs = Math.round(performance.now() - started);
result.minimumFreeGiB = minimumFreeGiB;
result.ramAfterGiB = gib();
try {
	result.gpu = execFileSync(
		'nvidia-smi',
		[
			'--query-gpu=name,memory.used,memory.total,clocks.sm,clocks.mem,power.draw,temperature.gpu',
			'--format=csv,noheader',
		],
		{ encoding: 'utf8', windowsHide: true },
	).trim();
} catch {
	result.gpu = 'unavailable';
}
const directory = new URL('../.state/benchmarks/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(
	new URL(`${model}-raw-${Date.now()}.json`, directory),
	JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (!result.correct) process.exitCode = 1;
