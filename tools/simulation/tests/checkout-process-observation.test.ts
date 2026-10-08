import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CheckoutProcessObservation, checkoutProcessIdentity, readCheckoutProcessTable, type CheckoutProcessIdentity } from '../src/checkout-process-observation.ts';
const row = (pid: number, parentPid: number, overrides: Partial<CheckoutProcessIdentity> = {}): CheckoutProcessIdentity =>
	({ pid, parentPid, processGroup: 100, session: 100, startTicks: String(pid + 1000), state: 'S', ...overrides });

test('kernel parser reuses exact PID/start-tick binding without exposing command names', () => {
	const fields = ['S', '90', '100', '100', ...Array<string>(15).fill('0'), '1100'];
	assert.deepEqual(checkoutProcessIdentity(`100 (private (nested) process) ${fields.join(' ')}`, 100), row(100, 90));
	for (const raw of ['100 (x) S 90 invalid', `101 (x) ${fields.join(' ')}`, 'x'.repeat(8193)])
		assert.throws(() => checkoutProcessIdentity(raw, 100));
});

test('launcher ownership needs a freshly detached direct child, never arbitrary PID attachment', () => {
	for (const overrides of [{ parentPid: 91 }, { processGroup: 99 }, { session: 99 }, { state: 'Z' }])
		assert.throws(() => new CheckoutProcessObservation(row(100, 90, overrides), 90));
});

test('root exit is insufficient while Chromium descendants or group orphans survive', () => {
	const observer = new CheckoutProcessObservation(row(100, 90), 90);
	assert.equal(observer.inspect([row(100, 90), row(101, 100), row(102, 101)]).liveObservedProcesses, 3);
	assert.equal(observer.inspect([row(101, 1), row(102, 101)]).ownedGroupClosed, false);
	assert.equal(observer.inspect([row(102, 1)]).ownedGroupClosed, false);
	const closed = observer.inspect([]);
	assert.equal(closed.ownedGroupClosed, true);
	assert.equal(closed.browserProtocolClosureProved, false);
	assert.equal(closed.paymentAccepted, false);
});

test('a reparented group member first observed after root exit prevents premature closure', () => {
	const observer = new CheckoutProcessObservation(row(100, 90), 90);
	assert.equal(observer.inspect([row(102, 1)]).ownedGroupClosed, false);
});

test('observed cross-session descendants permanently invalidate group-based closure', () => {
	const observer = new CheckoutProcessObservation(row(100, 90), 90);
	const escaped = row(101, 100, { processGroup: 101, session: 101 });
	assert.equal(observer.inspect([row(100, 90), escaped]).escapedDescendantObserved, true);
	assert.equal(observer.inspect([row(101, 1, { processGroup: 101, session: 101 })]).ownedGroupClosed, false);
	assert.equal(observer.inspect([]).ownedGroupClosed, false);
});

test('PID reuse and unrelated process groups are not mistaken for surviving owned children', () => {
	const observer = new CheckoutProcessObservation(row(100, 90), 90);
	observer.inspect([row(100, 90), row(101, 100)]);
	assert.equal(observer.inspect([row(101, 1, { startTicks: '9000', processGroup: 500, session: 500 })]).ownedGroupClosed, true);
	assert.throws(() => observer.inspect([row(101, 1), row(101, 1)]));
});

test('real Linux detached child exit does not conceal its live reparented descendant', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
	// Public fixture only. No provider, database, password, broker key or browser.
	const child = spawn(process.execPath, ['-e', `
		const {spawn}=require('node:child_process');
		const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:{PATH:process.env.PATH}});
		process.send({pid:descendant.pid});setInterval(()=>{},1000);
	`], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
	let descendant: CheckoutProcessIdentity | undefined;
	const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('close', () => resolve()); });
	try {
		const pid = await new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
			child.once('error', () => { clearTimeout(timer); reject(new Error('Fixture startup failed')); });
			child.once('message', raw => {
				clearTimeout(timer);
				if (raw && typeof raw === 'object' && 'pid' in raw && typeof raw.pid === 'number') resolve(raw.pid);
				else reject(new Error('Fixture identity rejected'));
			});
		});
		assert.ok(child.pid);
		const table = readCheckoutProcessTable();
		const root = table.find(row => row.pid === child.pid);
		descendant = table.find(row => row.pid === pid);
		assert.ok(root && descendant);
		assert.equal(descendant.parentPid, root.pid);
		assert.equal(realpathSync(`/proc/${pid}/exe`), realpathSync(process.execPath));
		const observer = new CheckoutProcessObservation(root, process.pid);
		assert.equal(observer.inspect(table).ownedGroupClosed, false);
		child.kill('SIGTERM'); await exited;
		assert.equal(observer.inspect(readCheckoutProcessTable()).ownedGroupClosed, false);
		const stillOwned = checkoutProcessIdentity(readFileSync(`/proc/${pid}/stat`, 'utf8'), pid);
		assert.equal(stillOwned.startTicks, descendant.startTicks);
		process.kill(pid, 'SIGTERM');
		for (let attempt = 0; attempt < 100; attempt++) {
			if (observer.inspect(readCheckoutProcessTable()).ownedGroupClosed) return;
			await sleep(25);
		}
		assert.fail('Owned fixture closure was not observed');
	} finally {
		if (descendant) {
			try {
				const current = checkoutProcessIdentity(readFileSync(`/proc/${descendant.pid}/stat`, 'utf8'), descendant.pid);
				if (current.startTicks === descendant.startTicks && !['Z','X','x'].includes(current.state ?? '')) process.kill(current.pid, 'SIGTERM');
			} catch { /* Already exited; never signal a replacement PID. */ }
		}
		child.kill('SIGTERM'); await exited;
	}
});
