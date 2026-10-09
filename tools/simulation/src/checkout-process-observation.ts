/** Independent Linux process metadata for the dedicated Checkout launcher.
 * Import/construction are inert. No signal, environment, command line or payment IO.
 * Group closure is not a same-UID sandbox or proof of browser/API protocol closure. */
import { readFileSync, readdirSync } from 'node:fs';
import { linuxProcessIdentity } from './hosted-community-attention.ts';

export type CheckoutProcessIdentity = ReturnType<typeof linuxProcessIdentity> & {
	processGroup: number;
	session: number;
};
const fail = () => { throw new Error('Checkout process observation rejected; private details withheld.'); };
export function checkoutProcessIdentity(raw: string, pid: number): CheckoutProcessIdentity {
	if (raw.length > 8192 || !Number.isSafeInteger(pid) || pid < 1) fail();
	const identity = linuxProcessIdentity(raw, pid);
	const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
	const number = (field: string | undefined) => {
		if (!field || !/^[0-9]+$/.test(field) || !Number.isSafeInteger(Number(field))) return fail();
		return Number(field);
	};
	// Kernel threads may legitimately start at tick zero; retain the exact value.
	if (!/^[RSDZTtXxKWPI]$/.test(identity.state ?? '') || !Number.isSafeInteger(identity.parentPid)) fail();
	return { ...identity, processGroup: number(fields[2]), session: number(fields[3]) };
}

/** Explicit bounded read-only /proc sampling. A disappearing process is normal;
 * permission/read failures are not evidence that it has exited. */
export function readCheckoutProcessTable(): CheckoutProcessIdentity[] {
	if (process.platform !== 'linux') return fail();
	const entries = readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name));
	if (entries.length > 65536) fail();
	const table: CheckoutProcessIdentity[] = [];
	for (const entry of entries) {
		try { table.push(checkoutProcessIdentity(readFileSync(`/proc/${entry}/stat`, 'utf8'), Number(entry))); }
		catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
			return fail();
		}
	}
	return table;
}
const key = (identity: CheckoutProcessIdentity) => `${identity.pid}:${identity.startTicks}`;
const live = (identity: CheckoutProcessIdentity) => !['Z', 'X', 'x'].includes(identity.state ?? '');

/** Bind a freshly launched detached child, then independently retain descendants.
 * Terminal inspection refuses a surviving group/orphan or any observed descendant.
 * An escaped descendant permanently invalidates group-based closure evidence. */
export class CheckoutProcessObservation {
	private readonly root: CheckoutProcessIdentity;
	private readonly observed = new Map<string, CheckoutProcessIdentity>();
	private readonly browserGroups = new Map<string, CheckoutProcessIdentity>();
	private escaped = false;
	constructor(root: CheckoutProcessIdentity, parentPid: number) {
		if (!Number.isSafeInteger(parentPid) || parentPid < 1 || root.parentPid !== parentPid ||
			root.pid === parentPid || root.processGroup !== root.pid || root.session !== root.pid || !live(root)) fail();
		this.root = Object.freeze({ ...root });
		this.observed.set(key(root), this.root);
	}
	/** Playwright on Linux creates its browser in a separate session/group.
	 * Admit ONE independently executable-verified direct child while the original
	 * member is live. Never attach an arbitrary/reparented PID, clear an escape,
	 * permit a second browser launch, or infer ownership from a serialized receipt. */
	admitOwnedBrowserGroup(leader: CheckoutProcessIdentity, table: readonly CheckoutProcessIdentity[],
		verifyExecutable: (row: CheckoutProcessIdentity) => boolean) {
		if (this.escaped || table.length > 65536 || new Set(table.map(row => row.pid)).size !== table.length) fail();
		const member = table.find(row => row.pid === this.root.pid), current = table.find(row => row.pid === leader.pid);
		if (!member || key(member) !== key(this.root) || !live(member) || !current || key(current) !== key(leader) ||
			!live(current) || current.parentPid !== this.root.pid || current.pid === this.root.pid ||
			current.processGroup !== current.pid || current.session !== current.pid || !verifyExecutable(current)) return fail();
		const prior = this.browserGroups.get(key(current));
		if (prior) {
			if (prior.processGroup !== current.processGroup || prior.session !== current.session) fail();
			return;
		}
		if (this.browserGroups.size !== 0) fail();
		this.browserGroups.set(key(current), Object.freeze({ ...current }));
		this.observed.set(key(current), { ...current });
	}
	/** Used only with fresh executable and descendant checks by the native owner. */
	ownsProcessGroup(row: CheckoutProcessIdentity): boolean {
		return (row.processGroup === this.root.processGroup && row.session === this.root.session) ||
			[...this.browserGroups.values()].some(group => row.processGroup === group.processGroup && row.session === group.session);
	}
	inspect(table: readonly CheckoutProcessIdentity[]) {
		if (table.length > 65536 || new Set(table.map(row => row.pid)).size !== table.length) fail();
		const byPid = new Map(table.map(row => [row.pid, row]));
		const descendants = new Set<number>();
		const currentRoot = byPid.get(this.root.pid);
		if (currentRoot && key(currentRoot) === key(this.root)) descendants.add(this.root.pid);
		// A root may have exited while its observed children were reparented.
		for (const row of table) if (this.observed.has(key(row))) descendants.add(row.pid);
		for (let depth = 0; depth < 64; depth++) {
			let added = false;
			for (const row of table) if (!descendants.has(row.pid) && descendants.has(row.parentPid)) {
				descendants.add(row.pid); added = true;
			}
			if (!added) break;
			if (depth === 63) fail();
		}
		for (const row of table) {
			const browserGroup = [...this.browserGroups.values()].find(group => row.processGroup === group.processGroup && row.session === group.session);
			const replacementLeader = browserGroup && byPid.get(browserGroup.pid);
			const browserGroupCurrent = browserGroup && (!replacementLeader || key(replacementLeader) === key(browserGroup));
			const sameGroup = (row.processGroup === this.root.processGroup && row.session === this.root.session) || !!browserGroupCurrent;
			// Group ID reuse cannot turn a replacement session leader into our child.
			if (sameGroup && row.pid === this.root.pid && key(row) !== key(this.root)) continue;
			if (!descendants.has(row.pid) && !sameGroup) continue;
			if (descendants.has(row.pid) && !sameGroup) this.escaped = true;
			this.observed.set(key(row), { ...row });
		}
		const survivors = table.filter(row => this.observed.has(key(row)) && live(row)).length;
		return {
			observedProcesses: this.observed.size,
			liveObservedProcesses: survivors,
			escapedDescendantObserved: this.escaped,
			ownedGroupClosed: survivors === 0 && !this.escaped,
			browserProtocolClosureProved: false as const,
			paymentAccepted: false as const,
		};
	}
}
