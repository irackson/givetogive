import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { communityShutdownMessage, registerCommunityShutdown } from '../src/community-shutdown.ts';
import { CommunitySupervision } from '../src/community-supervision.ts';

test('supervisor IPC requests graceful drain without force-killing a Windows child', () => {
	const runtime = new EventEmitter();
	let stops = 0;
	const unregister = registerCommunityShutdown(() => { stops++; }, runtime);
	for (const message of [null, 'stop', { type: 'community_shutdown' }, { ...communityShutdownMessage, protocolVersion: 2 }, { ...communityShutdownMessage, shell: 'arbitrary' }]) runtime.emit('message', message);
	assert.equal(stops, 0);
	runtime.emit('message', communityShutdownMessage);
	assert.equal(stops, 1);
	runtime.emit('SIGINT');
	runtime.emit('SIGTERM');
	assert.equal(stops, 3);
	unregister();
	runtime.emit('message', communityShutdownMessage);
	assert.equal(stops, 3);
});

test('progress and terminal milestones remain durable after stdout disappears', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'g2g-supervision-')), 'supervision.jsonl');
	let outputCalls = 0;
	const supervision = new CommunitySupervision(path, () => { outputCalls++; throw Object.assign(new Error('Pipe closed'), { code: 'EPIPE' }); });
	supervision.record({ started: true, ownedProcessId: 12 });
	supervision.record({ progress: { success: 3 } });
	supervision.record({ terminal: true, exitCode: 0 });
	const rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	assert.equal(outputCalls, 1);
	assert.equal(rows.length, 3);
	assert.equal(rows[2].terminal, true);
	assert.equal(rows[2].exitCode, 0);
	assert.ok(rows.every(row => Number.isFinite(Date.parse(row.recordedAt))));
});
