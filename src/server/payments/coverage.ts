import { and, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import {
	paymentSubscriptions,
	payments,
	supporterPaidCoverage,
} from '@/server/db/payments-schema';
import { applicationEnvironment } from '@/lib/environment';
import { type PaymentTransaction } from './ledger';
import { type VerifiedCoverageLine, tierFromCoverage } from './coverage-policy';
import { entitlementTime } from './entitlement-time';

/** Only immutable verified provenance may be replayed; appliedAt is monotonic. */
export async function recordPaidCoverage(
	tx: PaymentTransaction,
	paymentId: string,
	lines: readonly VerifiedCoverageLine[],
	applied: (line: VerifiedCoverageLine) => boolean,
) {
	const [payment] = await tx
		.select()
		.from(payments)
		.where(eq(payments.id, paymentId))
		.for('update');
	if (!payment?.paidAt || payment.kind !== 'supporter')
		throw new Error('Settled supporter payment required for coverage.');
	for (const line of lines) {
		if (
			payment.invoiceId !== line.invoiceId ||
			payment.subscriptionId !== line.subscriptionId ||
			payment.livemode !== line.livemode
		)
			throw new Error('Paid coverage ownership mismatch.');
		const [subscription] = await tx
			.select()
			.from(paymentSubscriptions)
			.where(eq(paymentSubscriptions.id, line.subscriptionId));
		if (
			subscription?.actorId !== payment.actorId ||
			subscription.kind !== 'supporter' ||
			subscription.livemode !== line.livemode
		)
			throw new Error('Paid coverage subscription mismatch.');
		const appliedAt = applied(line) ? new Date() : null;
		await tx
			.insert(supporterPaidCoverage)
			.values({ ...line, paymentId, appliedAt })
			.onConflictDoNothing();
		const where = and(
			eq(supporterPaidCoverage.invoiceLineId, line.invoiceLineId),
			eq(supporterPaidCoverage.livemode, line.livemode),
		);
		const [prior] = await tx
			.select()
			.from(supporterPaidCoverage)
			.where(where)
			.for('update');
		if (
			!prior ||
			prior.paymentId !== paymentId ||
			prior.invoiceId !== line.invoiceId ||
			prior.subscriptionId !== line.subscriptionId ||
			(prior.itemId !== null && prior.itemId !== line.itemId) ||
			prior.priceId !== line.priceId ||
			prior.tier !== line.tier ||
			prior.proration !== line.proration ||
			prior.periodStart.getTime() !== line.periodStart.getTime() ||
			prior.periodEnd.getTime() !== line.periodEnd.getTime()
		)
			throw new Error('Paid coverage replay conflict.');
		if (!prior.itemId)
			await tx
				.update(supporterPaidCoverage)
				.set({ itemId: line.itemId })
				.where(where);
		if (appliedAt && !prior.appliedAt)
			await tx
				.update(supporterPaidCoverage)
				.set({ appliedAt })
				.where(where);
	}
}

export async function activeSupporterCoverage(
	actorId: string,
	asOf: Date,
	executor: Pick<typeof db, 'select'> = db,
) {
	const mode = applicationEnvironment() === 'production';
	return executor
		.select({
			subscriptionId: supporterPaidCoverage.subscriptionId,
			tier: supporterPaidCoverage.tier,
			periodStart: supporterPaidCoverage.periodStart,
			periodEnd: supporterPaidCoverage.periodEnd,
		})
		.from(supporterPaidCoverage)
		.innerJoin(payments, eq(payments.id, supporterPaidCoverage.paymentId))
		.innerJoin(
			paymentSubscriptions,
			eq(paymentSubscriptions.id, supporterPaidCoverage.subscriptionId),
		)
		.where(
			and(
				eq(paymentSubscriptions.actorId, actorId),
				eq(payments.actorId, actorId),
				eq(paymentSubscriptions.kind, 'supporter'),
				eq(payments.kind, 'supporter'),
				eq(payments.subscriptionId, paymentSubscriptions.id),
				eq(payments.invoiceId, supporterPaidCoverage.invoiceId),
				eq(supporterPaidCoverage.livemode, mode),
				eq(payments.livemode, mode),
				eq(paymentSubscriptions.livemode, mode),
				isNotNull(supporterPaidCoverage.appliedAt),
				isNotNull(payments.paidAt),
				inArray(payments.status, ['succeeded', 'partially_refunded']),
				sql`${payments.grossAmount} > ${payments.refundedAmount}`,
				eq(payments.disputedAmount, 0),
				eq(payments.disputePendingAmount, 0),
				sql`${paymentSubscriptions.status} NOT IN ('incomplete','incomplete_expired','paused')`,
				lte(supporterPaidCoverage.periodStart, asOf),
				gt(supporterPaidCoverage.periodEnd, asOf),
			),
		);
}

export async function supporterRecognition(
	actorId: string,
	executor: Pick<typeof db, 'select'> = db,
	readTime: typeof entitlementTime = entitlementTime,
) {
	const time = await readTime(actorId);
	if (time.status !== 'ready')
		return {
			status: 'pending' as const,
			tier: 'neighbor' as const,
			coverage: [],
			asOf: null,
			source: null,
		};
	const coverage = await activeSupporterCoverage(
		actorId,
		time.asOf,
		executor,
	);
	return {
		status: 'ready' as const,
		tier: tierFromCoverage(coverage, time.asOf),
		coverage,
		asOf: time.asOf,
		source: time.source,
	};
}

/** A period-end cancellation is not renewable MRR. A pending clock/unknown price
 * is excluded and reported separately instead of counted as a paid member. */
export async function supporterMetrics(
	executor: Pick<typeof db, 'select'> = db,
	readTime: typeof entitlementTime = entitlementTime,
) {
	const subs = await executor
		.select()
		.from(paymentSubscriptions)
		.where(
			and(
				eq(
					paymentSubscriptions.livemode,
					applicationEnvironment() === 'production',
				),
				eq(paymentSubscriptions.kind, 'supporter'),
				eq(paymentSubscriptions.status, 'active'),
				eq(paymentSubscriptions.cancelAtPeriodEnd, false),
			),
		);
	let supporterMrr = 0;
	let count = 0;
	let pending = 0;
	for (const sub of subs) {
		const recognition = await supporterRecognition(
			sub.actorId,
			executor,
			readTime,
		);
		if (recognition.status === 'pending') {
			pending++;
			continue;
		}
		if (
			!recognition.coverage.some(
				(coverage) => coverage.subscriptionId === sub.id,
			)
		)
			continue;
		const amount =
			sub.priceId === process.env['STRIPE_SUSTAINER_PRICE_ID'] ? 1500
			: sub.priceId === process.env['STRIPE_SUPPORTER_PRICE_ID'] ? 500
			: 0;
		if (!amount) {
			pending++;
			continue;
		}
		supporterMrr += amount;
		count++;
	}
	return { supporterMrr, count, pending };
}
