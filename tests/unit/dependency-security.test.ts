import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse, stringify, stringifyAsync, uneval } from 'devalue';

// Regression for GHSA-j22f-vq7h-c4qm. A Buffer view must not serialize the
// unrelated bytes in its backing allocation, even in durable workflow inputs.
function fixture() {
	const allocation = Buffer.alloc(64, 0x7a);
	const visible = allocation.subarray(20, 22);
	visible.set([0x41, 0x42]);
	return visible;
}

function verifyVisibleBytes(serialized: string) {
	const restored = parse(serialized) as Uint8Array;
	assert.deepEqual(Array.from(restored), [0x41, 0x42]);
	assert.equal(restored.buffer.byteLength, 2);
}

test('workflow serializer isolates synchronous Buffer views', () => {
	verifyVisibleBytes(stringify(fixture()));
});

test('workflow serializer isolates asynchronous Buffer views', async () => {
	verifyVisibleBytes(await stringifyAsync(fixture()));
});

test('workflow uneval serializes only the visible Buffer bytes', () => {
	const generated = uneval(fixture());
	// Execute only the trusted library's fixed non-secret fixture output.
	const restored = runInNewContext(generated) as Uint8Array;
	assert.deepEqual(Array.from(restored), [0x41, 0x42]);
	assert.equal(restored.buffer.byteLength, 2);
});
