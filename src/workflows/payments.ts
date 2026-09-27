import { sleep } from 'workflow';

async function webhookStep(id: string) {
	'use step';
	const { processWebhook } = await import('@/server/payments/webhooks');
	await processWebhook(id);
}
webhookStep.maxRetries = 8;

async function paymentStep(id: string) {
	'use step';
	const { reconcilePayment } = await import('@/server/payments/recovery');
	await reconcilePayment(id);
}
paymentStep.maxRetries = 8;

async function refundStep(id: string) {
	'use step';
	const { processRefund } = await import('@/server/payments/refunds');
	await processRefund(id);
}
refundStep.maxRetries = 8;

async function allocationStep(id: string) {
	'use step';
	const { processAllocation } = await import('@/server/payments/funds');
	await processAllocation(id);
}
allocationStep.maxRetries = 8;

async function supporterChangeStep(id: string) {
	'use step';
	const { reconcileSupporterChange } =
		await import('@/server/payments/supporter-changes');
	const result = await reconcileSupporterChange(id);
	// Do not persist an invoice handoff URL, account details or provider payload
	// into the workflow event log. Pending payment/scheduled states await webhooks.
	return { status: result.status, effectiveAt: result.effectiveAt };
}
supporterChangeStep.maxRetries = 3;

async function recoveryBatchStep() {
	'use step';
	const { recoveryBatch } = await import('@/server/payments/recovery');
	return recoveryBatch();
}

export async function stripeWebhookWorkflow(id: string) {
	'use workflow';
	await webhookStep(id);
}

export async function paymentReservationWorkflow(id: string) {
	'use workflow';
	await sleep('36m');
	await paymentStep(id);
	await sleep('1d');
	await paymentStep(id);
}

export async function refundWorkflow(id: string) {
	'use workflow';
	await refundStep(id);
}

export async function fundAllocationWorkflow(id: string) {
	'use workflow';
	await allocationStep(id);
}

export async function supporterChangeWorkflow(id: string) {
	'use workflow';
	let status = 'recovery_required';
	let effectiveAt: Date | null = null;
	for (let boundaryPass = 0; boundaryPass < 2; boundaryPass++) {
		for (let attempt = 0; attempt < 9; attempt++) {
			try {
				const result = await supporterChangeStep(id);
				status = result.status;
				effectiveAt = result.effectiveAt;
			} catch {
				// DB/provider outages leave the admitted operation durable and visible.
				status = 'recovery_required';
			}
			if (
				!['reserved', 'processing', 'recovery_required'].includes(
					status,
				)
			)
				break;
			if (attempt < 8) await sleep('6m'); // Beyond an abandoned five-minute lease.
		}
		if (boundaryPass === 0 && status === 'scheduled' && effectiveAt) {
			// Webhooks are primary; a durable period-boundary wake is independent of
			// the laptop and daily cron. Synthetic clock advancement still uses events.
			await sleep(
				new Date(
					Math.max(
						Date.now() + 60_000,
						effectiveAt.getTime() + 5 * 60_000,
					),
				),
			);
			continue;
		}
		return {
			status,
			recoveryPending: [
				'reserved',
				'processing',
				'recovery_required',
				'scheduled',
			].includes(status),
		};
	}
	return { status, recoveryPending: true };
}

/** Scheduled by authenticated hosted cron, not by the laptop or browser. */
export async function paymentRecoveryWorkflow() {
	'use workflow';
	let examined = 0;
	// Drain a bounded backlog rather than leaving every item beyond page one for
	// tomorrow's Hobby-compatible sweep. Claims rotate poison work fairly.
	for (let page = 0; page < 20; page++) {
		const batch = await recoveryBatchStep();
		const count =
			batch.webhookIds.length +
			batch.paymentIds.length +
			batch.refundIds.length +
			batch.allocationIds.length +
			batch.supporterChangeIds.length;
		if (!count) break;
		examined += count;
		for (const id of batch.webhookIds) {
			try {
				await webhookStep(id);
			} catch {
				/* durable failed inbox remains visible to operators */
			}
			await sleep('1s');
		}
		for (const id of batch.paymentIds) {
			try {
				await paymentStep(id);
			} catch {
				/* next hosted sweep retries; no fabricated success */
			}
			await sleep('1s');
		}
		for (const id of batch.refundIds) {
			try {
				await refundStep(id);
			} catch {
				/* financial recovery case remains visible */
			}
			await sleep('1s');
		}
		for (const id of batch.allocationIds) {
			try {
				await allocationStep(id);
			} catch {
				/* preserve reserved money on ambiguous outcomes */
			}
			await sleep('1s');
		}
		for (const id of batch.supporterChangeIds) {
			try {
				await supporterChangeStep(id);
			} catch {
				/* durable operation retains its lease/recovery status for the next sweep */
			}
			await sleep('1s');
		}
	}
	return { examined };
}
