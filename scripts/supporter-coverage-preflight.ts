/** Operator CLI only. No route/MCP entrypoint. No Stripe mutations or production mode.
 * node --env-file=.env.staging.local --conditions=react-server --import tsx scripts/supporter-coverage-preflight.ts --operator synthetic-stage-admin
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { db as Database } from '../src/server/db/index.ts';
import type { PaymentTransaction } from '../src/server/payments/ledger.ts';
import { users } from '../src/server/db/schema.ts';
import {
	paymentAccounts,
	paymentLedger,
	payments,
	paymentSubscriptions,
	supporterPaidCoverage,
} from '../src/server/db/payments-schema.ts';
import {
	verifiedSupporterLines,
	type VerifiedCoverageLine,
} from '../src/server/payments/coverage-policy.ts';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from './isolated-environment.ts';
import {
	CoveragePreflightError,
	paymentEvidenceFingerprint,
	planPreflightCoverage,
	preflightOptions,
	safePreflightCode,
	verifyPreflightInvoiceOwner,
	verifyPreflightSettlement,
	type CoverageOwner,
	type CoveragePayment,
	type PreflightOptions,
} from './supporter-coverage-preflight-policy.ts';

function fail(code: string): never {
	throw new CoveragePreflightError(code);
}
type Connection = Pick<typeof Database, 'select'>;
async function assertOperator(connection: Connection, operatorId: string) {
	const [operator] = await connection
		.select({
			role: users.role,
			synthetic: users.isSynthetic,
			verified: users.emailVerified,
			frozen: users.frozenAt,
		})
		.from(users)
		.where(eq(users.id, operatorId))
		.limit(1);
	if (
		!operator ||
		operator.role !== 'admin' ||
		!operator.synthetic ||
		!operator.verified ||
		operator.frozen
	)
		fail('verified_synthetic_operator_required');
}

/** Rechecks local ownership/payment eligibility inside the write transaction.
 * Provider evidence has already been read; this function performs no network calls.
 */
export async function applyPreflightCoverage(
	tx: PaymentTransaction,
	input: {
		operatorId: string;
		expectedIdentity: string;
		runId: string;
		owner: CoverageOwner;
		payment: CoveragePayment;
		lines: readonly VerifiedCoverageLine[];
	},
) {
	const environment = isolatedConfiguration(process.env);
	if (environment.identity !== input.expectedIdentity)
		fail('apply_identity_mismatch');
	const [target] = await tx.execute<{
		database: string;
		role: string;
		identity: string;
		environment: string;
	}>(
		sql`select current_database() as database, current_user as role, identity, environment from givetogive_environment_identity where id=1`,
	);
	if (
		target?.database !== environment.database ||
		target.role !== environment.database ||
		target.identity !== environment.identity ||
		target.environment !== environment.environment
	)
		fail('apply_database_identity_mismatch');
	await assertOperator(tx, input.operatorId);
	const [payment] = await tx
		.select()
		.from(payments)
		.where(eq(payments.id, input.payment.id))
		.for('update');
	if (
		!payment ||
		paymentEvidenceFingerprint(payment) !==
			paymentEvidenceFingerprint(input.payment)
	)
		fail('payment_changed_during_verification');
	if (
		!payment.paidAt ||
		!['succeeded', 'partially_refunded'].includes(payment.status) ||
		payment.refundedAmount >= payment.grossAmount ||
		payment.disputedAmount ||
		payment.disputePendingAmount
	)
		fail('payment_no_longer_eligible');
	const [journal] = await tx
		.select({ id: paymentLedger.id })
		.from(paymentLedger)
		.where(
			and(
				eq(paymentLedger.paymentId, payment.id),
				eq(paymentLedger.operationKey, `payment:${payment.chargeId}`),
				eq(paymentLedger.livemode, false),
			),
		)
		.limit(1);
	if (!journal) fail('missing_local_settlement');
	const [owner] = await tx
		.select({
			id: paymentSubscriptions.id,
			actorId: paymentSubscriptions.actorId,
			accountId: paymentSubscriptions.accountId,
			kind: paymentSubscriptions.kind,
			livemode: paymentSubscriptions.livemode,
			synthetic: users.isSynthetic,
		})
		.from(paymentSubscriptions)
		.innerJoin(
			paymentAccounts,
			and(
				eq(paymentAccounts.userId, paymentSubscriptions.actorId),
				eq(
					paymentAccounts.stripeAccountId,
					paymentSubscriptions.accountId,
				),
				eq(paymentAccounts.livemode, paymentSubscriptions.livemode),
			),
		)
		.innerJoin(users, eq(users.id, paymentSubscriptions.actorId))
		.where(eq(paymentSubscriptions.id, input.owner.id))
		.limit(1);
	if (
		!owner?.synthetic ||
		owner.id !== input.owner.id ||
		owner.actorId !== input.owner.actorId ||
		owner.accountId !== input.owner.accountId ||
		owner.kind !== 'supporter' ||
		owner.livemode
	)
		fail('subscription_changed_during_verification');
	const { appliedSupporterInvoiceLines } =
		await import('../src/server/payments/supporter-application-evidence.ts');
	const proof = await appliedSupporterInvoiceLines(
		{
			subscriptionId: owner.id,
			accountId: owner.accountId,
			invoiceId: payment.invoiceId!,
			livemode: false,
			lines: input.lines,
		},
		tx,
	);
	if (
		input.lines.some(
			(line) => line.proration && !proof.has(line.invoiceLineId),
		)
	)
		fail('missing_historical_application_evidence');
	const { recordPaidCoverage } =
		await import('../src/server/payments/coverage.ts');
	const { refreshSupporterEntitlement } =
		await import('../src/server/payments/entitlements.ts');
	const { recordEvent } =
		await import('../src/server/observability/events.ts');
	await recordPaidCoverage(tx, payment.id, input.lines, () => true);
	await refreshSupporterEntitlement(tx, owner.id);
	await recordEvent(
		{
			externalId: `supporter-preflight:${input.runId}:${payment.id}`,
			actorId: input.operatorId,
			entityType: 'subscription',
			entityId: owner.id,
			action: 'supporter_coverage_backfill',
			outcome: 'completed',
			summary:
				'Operator backfilled actual paid invoice-line coverage in an isolated environment.',
			details: {
				invoiceId: payment.invoiceId,
				verifiedLines: input.lines.length,
				mode: 'test',
			},
		},
		tx,
	);
}

type InvoiceResult = {
	invoiceId: string;
	status: string;
	eligibleLines?: number;
	missingCoverageLines?: string[];
	missingApplicationEvidence?: string[];
	code?: string;
};
type SubscriptionResult = {
	subscriptionId: string;
	invoices: InvoiceResult[];
	status: string;
	nextInvoiceCursor: string | null;
	observedAt?: string;
	verifiedCurrentTier?: string;
	code?: string;
};

export async function runPreflight(options: PreflightOptions) {
	// These checks precede importing the app connection or creating a Stripe client.
	const environment = isolatedConfiguration(process.env);
	if (options.apply && options.confirmIdentity !== environment.identity)
		fail('apply_identity_mismatch');
	if (
		!/^[rs]k_test_[A-Za-z0-9]+$/.test(
			process.env['STRIPE_SECRET_KEY'] ?? '',
		) ||
		!/^acct_[A-Za-z0-9]+$/.test(
			process.env['STRIPE_PLATFORM_ACCOUNT_ID'] ?? '',
		)
	)
		fail('test_stripe_credentials_required');
	if (
		!process.env['STRIPE_SUPPORTER_PRICE_ID'] ||
		!process.env['STRIPE_SUSTAINER_PRICE_ID'] ||
		process.env['STRIPE_SUPPORTER_PRICE_ID'] ===
			process.env['STRIPE_SUSTAINER_PRICE_ID']
	)
		fail('distinct_supporter_prices_required');
	const { db } = await import('../src/server/db/index.ts');
	try {
		await verifyIsolatedTarget(db.$client, environment);
		await assertOperator(db, options.operatorId);
		const { paymentConfiguration } =
			await import('../src/server/payments/config.ts');
		const config = paymentConfiguration();
		if (!config.configured || config.livemode)
			fail('test_stripe_configuration_required');
		const { stripeClient } =
			await import('../src/server/payments/stripe.ts');
		const { appliedSupporterInvoiceLines } =
			await import('../src/server/payments/supporter-application-evidence.ts');
		const { entitlementTime } =
			await import('../src/server/payments/entitlement-time.ts');
		const stripe = stripeClient();
		const request: Stripe.RequestOptions = {
			timeout: 5000,
			maxNetworkRetries: 0,
		};
		const started = Date.now();
		let providerReads = 0;
		const read = async <T>(operation: () => PromiseLike<T>) => {
			if (providerReads >= 400 || Date.now() - started >= 600_000)
				fail('provider_read_budget_exhausted');
			providerReads++;
			return operation();
		};
		// Verify the key's actual platform account, not merely its configured label.
		const platform = await read(() =>
			stripe.accounts.retrieve(null, {}, request),
		);
		if (platform.id !== config.platformAccountId)
			fail('provider_platform_account_mismatch');
		const rows = await db
			.select({
				subscription: paymentSubscriptions,
				synthetic: users.isSynthetic,
				mappedAccountId: paymentAccounts.stripeAccountId,
			})
			.from(paymentSubscriptions)
			.leftJoin(users, eq(users.id, paymentSubscriptions.actorId))
			.leftJoin(
				paymentAccounts,
				and(
					eq(paymentAccounts.userId, paymentSubscriptions.actorId),
					eq(
						paymentAccounts.stripeAccountId,
						paymentSubscriptions.accountId,
					),
					eq(paymentAccounts.livemode, paymentSubscriptions.livemode),
				),
			)
			.where(
				and(
					eq(paymentSubscriptions.kind, 'supporter'),
					eq(paymentSubscriptions.livemode, false),
					options.subscriptionId ?
						eq(paymentSubscriptions.id, options.subscriptionId)
					:	undefined,
					options.afterSubscription ?
						gt(paymentSubscriptions.id, options.afterSubscription)
					:	undefined,
				),
			)
			.orderBy(asc(paymentSubscriptions.id))
			.limit(options.subscriptionLimit + 1);
		if (options.subscriptionId && !rows.length)
			fail('owned_supporter_subscription_not_found');
		const hasMoreSubscriptions = rows.length > options.subscriptionLimit;
		const selected = rows.slice(0, options.subscriptionLimit);
		const runId = randomUUID();
		const results: SubscriptionResult[] = [];
		for (const row of selected) {
			const owner = row.subscription;
			const result: SubscriptionResult = {
				subscriptionId: owner.id,
				invoices: [],
				status: 'verified',
				nextInvoiceCursor: null,
			};
			results.push(result);
			try {
				if (!row.synthetic || row.mappedAccountId !== owner.accountId)
					fail('local_subscription_owner_unverified');
				const provider = await read(() =>
					stripe.subscriptions.retrieve(owner.id, {}, request),
				);
				if (
					provider.id !== owner.id ||
					provider.livemode ||
					provider.customer_account !== owner.accountId
				)
					fail('provider_subscription_owner_mismatch');
				if (provider.status !== owner.status)
					fail('subscription_reconciliation_required');
				const time = await entitlementTime(owner.actorId);
				if (time.status !== 'ready') fail('authoritative_time_pending');
				result.observedAt = time.asOf.toISOString();
				const page = await read(() =>
					stripe.invoices.list(
						{
							subscription: owner.id,
							customer_account: owner.accountId,
							status: 'paid',
							limit: options.invoiceLimit,
							...(options.invoiceAfter ?
								{ starting_after: options.invoiceAfter }
							:	{}),
						},
						request,
					),
				);
				if (
					page.data.length > options.invoiceLimit ||
					(page.has_more && !page.data.length) ||
					new Set(page.data.map((invoice) => invoice.id)).size !==
						page.data.length
				)
					fail('invalid_provider_page');
				if (page.has_more)
					result.nextInvoiceCursor = page.data.at(-1)!.id;
				if (!page.has_more && !options.invoiceAfter) {
					const localInvoices = await db
						.select({ invoiceId: payments.invoiceId })
						.from(payments)
						.where(
							and(
								eq(payments.actorId, owner.actorId),
								eq(payments.subscriptionId, owner.id),
								eq(payments.kind, 'supporter'),
								eq(payments.livemode, false),
								isNotNull(payments.paidAt),
							),
						)
						.limit(options.invoiceLimit + 1);
					const observed = new Set(
						page.data.map((invoice) => invoice.id),
					);
					if (
						localInvoices.length > options.invoiceLimit ||
						localInvoices.some(
							(payment) =>
								!payment.invoiceId ||
								!observed.has(payment.invoiceId),
						)
					)
						fail('local_settlement_missing_from_provider_history');
				}
				const currentTiers: string[] = [];
				for (const invoice of page.data) {
					const invoiceResult: InvoiceResult = {
						invoiceId: invoice.id,
						status: 'unresolved',
					};
					result.invoices.push(invoiceResult);
					try {
						verifyPreflightInvoiceOwner(invoice, owner);
						const lines = await read(() =>
							stripe.invoices.listLineItems(
								invoice.id,
								{ limit: 100 },
								request,
							),
						);
						if (lines.has_more || lines.data.length > 100)
							fail('invoice_line_page_exceeds_bound');
						const coverage = verifiedSupporterLines(lines.data, {
							invoiceId: invoice.id,
							subscriptionId: owner.id,
							livemode: false,
							supporterPriceId:
								process.env['STRIPE_SUPPORTER_PRICE_ID'],
							sustainerPriceId:
								process.env['STRIPE_SUSTAINER_PRICE_ID'],
						});
						const [payment] = await db
							.select()
							.from(payments)
							.where(
								and(
									eq(payments.invoiceId, invoice.id),
									eq(payments.subscriptionId, owner.id),
									eq(payments.actorId, owner.actorId),
									eq(payments.livemode, false),
								),
							)
							.limit(1);
						if (!payment?.paymentIntentId || !payment.chargeId)
							fail('missing_local_settlement');
						const [journal] = await db
							.select({ id: paymentLedger.id })
							.from(paymentLedger)
							.where(
								and(
									eq(paymentLedger.paymentId, payment.id),
									eq(
										paymentLedger.operationKey,
										`payment:${payment.chargeId}`,
									),
									eq(paymentLedger.livemode, false),
									eq(paymentLedger.currency, 'usd'),
								),
							)
							.limit(1);
						const invoicePayments = await read(() =>
							stripe.invoicePayments.list(
								{
									invoice: invoice.id,
									status: 'paid',
									limit: 2,
								},
								request,
							),
						);
						const intent = await read(() =>
							stripe.paymentIntents.retrieve(
								payment.paymentIntentId!,
								{ expand: ['latest_charge'] },
								request,
							),
						);
						const settlement = verifyPreflightSettlement({
							owner,
							invoice,
							payment,
							invoicePayments,
							intent,
							settlementJournal: Boolean(journal),
						});
						if (settlement !== 'verified') {
							invoiceResult.status = settlement;
							continue;
						}
						const proven = await appliedSupporterInvoiceLines({
							subscriptionId: owner.id,
							accountId: owner.accountId,
							invoiceId: invoice.id,
							livemode: false,
							lines: coverage,
						});
						const plan = planPreflightCoverage(coverage, proven);
						invoiceResult.eligibleLines = plan.eligible.length;
						invoiceResult.missingApplicationEvidence =
							plan.missingApplicationEvidence;
						const prior = await db
							.select()
							.from(supporterPaidCoverage)
							.where(
								and(
									eq(
										supporterPaidCoverage.invoiceId,
										invoice.id,
									),
									eq(supporterPaidCoverage.livemode, false),
								),
							);
						const missing: string[] = [];
						for (const line of plan.eligible) {
							const old = prior.find(
								(candidate) =>
									candidate.invoiceLineId ===
									line.invoiceLineId,
							);
							if (
								old &&
								(old.paymentId !== payment.id ||
									old.subscriptionId !== owner.id ||
									old.priceId !== line.priceId ||
									(old.itemId &&
										old.itemId !== line.itemId) ||
									old.tier !== line.tier ||
									old.proration !== line.proration ||
									old.periodStart.getTime() !==
										line.periodStart.getTime() ||
									old.periodEnd.getTime() !==
										line.periodEnd.getTime())
							)
								fail('existing_coverage_conflict');
							if (!old?.appliedAt || !old.itemId)
								missing.push(line.invoiceLineId);
							if (
								line.periodStart <= time.asOf &&
								time.asOf < line.periodEnd
							)
								currentTiers.push(line.tier);
						}
						invoiceResult.missingCoverageLines = missing;
						if (options.apply && missing.length) {
							await verifyIsolatedTarget(db.$client, environment);
							await db.transaction((tx) =>
								applyPreflightCoverage(tx, {
									operatorId: options.operatorId,
									expectedIdentity: environment.identity,
									runId,
									owner,
									payment,
									lines: plan.eligible,
								}),
							);
							invoiceResult.missingCoverageLines = [];
						}
						invoiceResult.status =
							plan.missingApplicationEvidence.length ?
								'unresolved_missing_application_evidence'
							: missing.length && !options.apply ?
								'backfill_required'
							: options.apply && missing.length ? 'backfilled'
							: 'already_covered';
					} catch (error) {
						invoiceResult.status = 'unresolved';
						invoiceResult.code = safePreflightCode(error);
					}
				}
				result.verifiedCurrentTier =
					(
						['incomplete', 'incomplete_expired', 'paused'].includes(
							provider.status,
						)
					) ?
						'neighbor'
					: currentTiers.includes('sustainer') ? 'sustainer'
					: currentTiers.includes('supporter') ? 'supporter'
					: 'neighbor';
				if (
					!page.data.length &&
					['active', 'past_due'].includes(provider.status)
				)
					fail('no_paid_invoice_in_selected_page');
				if (
					result.nextInvoiceCursor ||
					options.invoiceAfter ||
					result.invoices.some(
						(invoice) =>
							invoice.status.startsWith('unresolved') ||
							invoice.status === 'backfill_required',
					)
				)
					result.status = 'review_required';
			} catch (error) {
				result.status = 'unresolved';
				result.code = safePreflightCode(error);
			}
		}
		const fullLocalScope =
			!options.subscriptionId &&
			!options.afterSubscription &&
			!options.invoiceAfter &&
			!hasMoreSubscriptions &&
			results.every((result) => !result.nextInvoiceCursor);
		const selectedPageReady = results.every(
			(result) => result.status === 'verified',
		);
		return {
			runId,
			mode: options.apply ? 'apply' : 'dry-run',
			environment: environment.environment,
			productionAuthorized: false,
			providerWrites: 0,
			providerReads,
			fullLocalScope,
			selectedPageReady,
			cutoverReady: fullLocalScope && selectedPageReady,
			nextSubscriptionCursor:
				hasMoreSubscriptions ? selected.at(-1)!.subscription.id : null,
			results,
		};
	} finally {
		await db.$client.end();
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const report = await runPreflight(
			preflightOptions(process.argv.slice(2)),
		);
		console.log(JSON.stringify(report, null, 2));
		if (!report.cutoverReady) process.exitCode = 2;
	} catch (error) {
		console.error(
			JSON.stringify({
				status: 'blocked',
				code: safePreflightCode(error),
				productionAuthorized: false,
				providerWrites: 0,
			}),
		);
		process.exitCode = 1;
	}
}
