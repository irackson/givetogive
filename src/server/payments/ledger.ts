import { type db } from '@/server/db';
import { eq } from 'drizzle-orm';
import { paymentLedger, type LedgerLine } from '@/server/db/payments-schema';
import { assertBalancedJournal } from './math';

export type PaymentTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export async function postJournal(
	tx: PaymentTransaction,
	input: {
		operationKey: string;
		paymentId?: string;
		fundId?: string;
		currency?: string;
		livemode: boolean;
		lines: LedgerLine[];
	},
) {
	assertBalancedJournal(input.lines);
	const [inserted] = await tx
		.insert(paymentLedger)
		.values({ ...input, currency: input.currency ?? 'usd' })
		.onConflictDoNothing({ target: paymentLedger.operationKey })
		.returning({ id: paymentLedger.id });
	if (!inserted) {
		const [existing] = await tx
			.select()
			.from(paymentLedger)
			.where(eq(paymentLedger.operationKey, input.operationKey));
		const normalize = (lines: LedgerLine[]) =>
			JSON.stringify(
				lines.map(({ account, amount }) => [account, amount]),
			);
		if (
			!existing ||
			existing.livemode !== input.livemode ||
			existing.currency !== (input.currency ?? 'usd') ||
			existing.paymentId !== (input.paymentId ?? null) ||
			existing.fundId !== (input.fundId ?? null) ||
			normalize(existing.lines) !== normalize(input.lines)
		)
			throw new Error('Journal idempotency conflict.');
	}
}
