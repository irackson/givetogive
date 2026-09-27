import { and, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { type db } from '@/server/db';
import { asks } from '@/server/db/schema';
import {
	fundAllocations,
	paymentAskSettings,
	payments,
} from '@/server/db/payments-schema';
import { paymentConfiguration } from './config';
import { fundingTotals } from './checkout';
import { netVerifiedFunding } from './math';
import { type PaymentTransaction } from './ledger';

/** Caller must hold the Ask row lock, shared with checkout, allocation and enablement. */
export async function assertLegacyContributionsAllowed(
	tx: PaymentTransaction,
	askId: number,
) {
	const [settings] = await tx
		.select({ id: paymentAskSettings.askId })
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	if (settings)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'This Ask uses verified payments. Use Checkout; payments cannot be created, completed, or cancelled as manual pledges.',
		});
}

/** Atomic with the owner edit and the same Ask lock used by payment reservation. */
export async function syncPaymentAskGoal(
	tx: PaymentTransaction,
	askId: number,
	goalAmount: number,
) {
	const [settings] = await tx
		.select()
		.from(paymentAskSettings)
		.where(eq(paymentAskSettings.askId, askId));
	if (!settings) return null;
	const totals = await fundingTotals(tx, askId);
	if (goalAmount < totals.paidAmount + totals.pendingAmount)
		throw new TRPCError({
			code: 'CONFLICT',
			message:
				'The goal cannot be below verified funding plus pending payment reservations.',
		});
	await tx
		.update(paymentAskSettings)
		.set({ goalAmount })
		.where(eq(paymentAskSettings.askId, askId));
	const status = fundingStatus(
		totals.paidAmount,
		totals.pendingAmount,
		goalAmount,
	);
	await tx.update(asks).set({ goalAmount, status }).where(eq(asks.id, askId));
	return {
		contributedAmount: totals.paidAmount,
		completedAmount: totals.paidAmount,
		status,
	};
}

export function fundingStatus(paid: number, pending: number, goal: number) {
	return (
		paid >= goal ? ('complete' as const)
		: paid + pending > 0 ? ('in_progress' as const)
		: ('not_started' as const)
	);
}

/** Three batched reads, never one query per browse-card. No donor identity is exposed. */
export async function askPaymentProgress(
	database: typeof db | PaymentTransaction,
	askIds: number[],
) {
	const result = new Map<
		number,
		{
			paymentEnabled: true;
			verifiedFundingAmount: number;
			pendingFundingAmount: number;
			goalAmount: number;
		}
	>();
	if (!askIds.length) return result;
	const settings = await database
		.select()
		.from(paymentAskSettings)
		.where(inArray(paymentAskSettings.askId, askIds));
	for (const setting of settings)
		result.set(setting.askId, {
			paymentEnabled: true,
			verifiedFundingAmount: 0,
			pendingFundingAmount: 0,
			goalAmount: setting.goalAmount,
		});
	if (!result.size) return result;
	const mode = paymentConfiguration().livemode;
	const enabledIds = [...result.keys()];
	const rows = await database
		.select()
		.from(payments)
		.where(
			and(
				inArray(payments.askId, enabledIds),
				eq(payments.livemode, mode),
			),
		);
	const allocations = await database
		.select()
		.from(fundAllocations)
		.where(
			and(
				inArray(fundAllocations.askId, enabledIds),
				eq(fundAllocations.livemode, mode),
			),
		);
	for (const row of rows) {
		const progress = result.get(row.askId!)!;
		progress.verifiedFundingAmount += netVerifiedFunding(row);
		progress.pendingFundingAmount += row.disputePendingAmount;
		if (['reserved', 'checkout_open', 'pending'].includes(row.status))
			progress.pendingFundingAmount += row.recipientAmount;
	}
	for (const row of allocations) {
		const progress = result.get(row.askId)!;
		if (row.status === 'completed')
			progress.verifiedFundingAmount += row.amount - row.reversedAmount;
		else if (
			['reserved', 'processing', 'recovery_required'].includes(row.status)
		)
			progress.pendingFundingAmount += row.amount - row.reversedAmount;
	}
	return result;
}
