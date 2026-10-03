import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiMutations, uiQueries } from '../src/ui-session.ts';

test('financial member transport permits only existing UI billing procedures with the correct method', () => {
	const router = readFileSync(
		new URL('../../../src/server/api/routers/billing.ts', import.meta.url),
		'utf8',
	);
	const definitions = [...router.matchAll(/^\t([A-Za-z]+):/gm)];
	for (const [allowlist, method] of [
		[uiQueries, 'query'],
		[uiMutations, 'mutation'],
	] as const) {
		for (const procedure of allowlist) {
			if (!procedure.startsWith('billing.')) continue;
			const name = procedure.slice('billing.'.length);
			const index = definitions.findIndex(
				(definition) => definition[1] === name,
			);
			assert.ok(index >= 0, `UI procedure ${name} exists`);
			const source = router.slice(
				definitions[index]!.index,
				definitions[index + 1]?.index ?? router.length,
			);
			assert.match(source, new RegExp(`\\.${method}\\(`));
			assert.doesNotMatch(source, /assert(?:Financial)?Admin/);
		}
	}
});

test('normal member transport cannot use operator controls or sandbox shortcuts', () => {
	for (const procedure of [
		'billing.adminCreateFund',
		'billing.adminAllocate',
		'billing.adminRefund',
		'billing.adminOperations',
		'billing.adminAudit',
		'billing.adminReconcile',
		'admin.createSimulationRun',
		'member.sandboxRead',
		'member.prepare_checkout',
		'simulation.clock.create',
	]) {
		assert.equal(uiQueries.has(procedure), false);
		assert.equal(uiMutations.has(procedure), false);
	}
	for (const procedure of uiQueries)
		assert.equal(uiMutations.has(procedure), false);
});
