import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UiCheckoutPreparation } from '../src/ui-checkout-preparation.ts';
import { ApiRejection, type UiApi } from '../src/ui-session.ts';
import type { SandboxPlan } from '../src/sandbox-plan.ts';

const step: SandboxPlan['steps'][number] = {
	operationId: 'b94f5374-b8d9-4909-967b-116d0469f5a4',
	agentId: 'actor',
	scenario: 'success',
	maximumAmountCents: 500,
	checkout: { kind: 'supporter', tier: 'supporter', recurring: false },
};
const plan: SandboxPlan = {
	runId: 'test',
	runBudgetCents: 500,
	actorBudgetCents: 500,
	steps: [step],
};
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), 'givetogive-ui-checkout-'));
	const path = join(directory, 'intents.sqlite');
	return { path, cleanup: () => rmSync(directory, { recursive: true }) };
}
test('ordinary UI preparation is durably admitted before the mutation and cannot be repeated after restart', async () => {
	const f = fixture();
	let journal = new UiCheckoutPreparation(f.path, plan);
	let calls = 0;
	const session: UiApi = {
		userId: 'member',
		query: async () => undefined,
		mutate: async (procedure, input) => {
			calls++;
			assert.equal(journal.state(step.operationId), 'preparing');
			assert.equal(procedure, 'billing.createCheckout');
			assert.deepEqual(input, {
				...step.checkout,
				operationId: step.operationId,
			});
			return { id: 'private response' };
		},
	};
	try {
		await journal.prepare(session, 'member', step);
		assert.equal(journal.state(step.operationId), 'prepared');
		journal.close();
		journal = new UiCheckoutPreparation(f.path, plan);
		await assert.rejects(
			journal.prepare(session, 'member', step),
			/already admitted/,
		);
		assert.equal(calls, 1);
		await assert.rejects(
			journal.prepare(session, 'member', {
				...step,
				operationId: 'd6335715-02b9-437c-984c-685cfe52131f',
			}),
			/budget exhausted/,
		);
		assert.throws(
			() =>
				new UiCheckoutPreparation(f.path, {
					...plan,
					runBudgetCents: 1000,
				}),
			/cannot be changed/,
		);
	} finally {
		journal.close();
		f.cleanup();
	}
});
test('ambiguous and rejected preparations remain spent and never expose raw failures', async () => {
	for (const failure of [
		new Error('private provider URL and key'),
		new ApiRejection(500, 'INTERNAL_SERVER_ERROR'),
		new ApiRejection(403, 'FORBIDDEN'),
	]) {
		const f = fixture();
		const journal = new UiCheckoutPreparation(f.path, plan);
		let calls = 0;
		const session: UiApi = {
			userId: 'member',
			query: async () => undefined,
			mutate: async () => {
				calls++;
				throw failure;
			},
		};
		try {
			await assert.rejects(
				journal.prepare(session, 'member', step),
				/did not resolve/,
			);
			assert.equal(
				journal.state(step.operationId),
				failure instanceof ApiRejection && failure.status < 500 ?
					'rejected'
				:	'unresolved',
			);
			await assert.rejects(
				journal.prepare(session, 'member', step),
				/already admitted/,
			);
			assert.equal(calls, 1);
		} finally {
			journal.close();
			f.cleanup();
		}
	}
});
test('a different member session cannot admit or purchase for another actor', async () => {
	const f = fixture();
	const journal = new UiCheckoutPreparation(f.path, plan);
	try {
		await assert.rejects(
			journal.prepare(
				{
					userId: 'wrong',
					query: async () => undefined,
					mutate: async () => assert.fail(),
				},
				'member',
				step,
			),
			/normal session/,
		);
		assert.equal(journal.state(step.operationId), undefined);
	} finally {
		journal.close();
		f.cleanup();
	}
});
test('missing fee review and under-budget tiers fail before admission or a UI request', async () => {
	const f = fixture();
	const journal = new UiCheckoutPreparation(f.path, plan);
	const session: UiApi = {
		userId: 'member',
		query: async () => undefined,
		mutate: async () => assert.fail(),
	};
	try {
		await assert.rejects(
			journal.prepare(session, 'member', {
				...step,
				checkout: {
					kind: 'ask',
					askId: 1,
					grossAmount: 500,
					recurring: false,
				},
			}),
			/fee quote/,
		);
		await assert.rejects(
			journal.prepare(session, 'member', {
				...step,
				checkout: {
					kind: 'supporter',
					tier: 'sustainer',
					recurring: false,
				},
			}),
			/tier price/,
		);
		assert.equal(journal.state(step.operationId), undefined);
	} finally {
		journal.close();
		f.cleanup();
	}
});
