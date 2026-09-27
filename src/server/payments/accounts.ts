import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { paymentAccounts } from '@/server/db/payments-schema';
import {
	persistEntitlementClockBinding,
	verifyEntitlementClockRequest,
} from './entitlement-time';
import { paymentConfiguration } from './config';
import { stripeClient } from './stripe';
import {
	requirePortalConfigurationId,
	validatePortalConfiguration,
} from './portal-policy';

export async function requirePaymentMember(userId: string) {
	const [user] = await db
		.select()
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user?.emailVerified)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Verify your email before using payments.',
		});
	if (user.frozenAt)
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'This account is temporarily frozen.',
		});
	return user;
}

export type SimulationClockBinding = { runId: string; clockId: string };

export async function ensureCustomerAccount(
	userId: string,
	clockBinding?: SimulationClockBinding,
) {
	const config = paymentConfiguration();
	const user = await requirePaymentMember(userId);
	// Automatically respect an existing immutable binding, but require an explicit
	// operator bind before a provisioned cohort can create its customer account.
	const verifiedBinding = await verifyEntitlementClockRequest(
		userId,
		clockBinding,
	);
	const [existing] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, userId),
				eq(paymentAccounts.livemode, config.livemode),
			),
		)
		.limit(1);
	if (existing) {
		if (verifiedBinding) {
			const account = await stripeClient().v2.core.accounts.retrieve(
				existing.stripeAccountId,
				{ include: ['configuration.customer'] },
			);
			if (
				account.id !== existing.stripeAccountId ||
				account.livemode ||
				account.configuration?.customer?.test_clock !==
					verifiedBinding.clockId
			) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message:
						'An existing customer cannot be moved onto a different test clock. Create a fresh synthetic cohort.',
				});
			}
			await db.transaction((tx) =>
				persistEntitlementClockBinding(tx, verifiedBinding, account.id),
			);
		}
		return existing;
	}
	const account = await stripeClient().v2.core.accounts.create(
		{
			contact_email: user.email,
			display_name: user.name ?? 'GiveToGive member',
			configuration: {
				customer:
					verifiedBinding ?
						{ test_clock: verifiedBinding.clockId }
					:	{},
			},
			include: ['configuration.customer'],
		},
		{ idempotencyKey: `customer-account:${config.environment}:${userId}` },
	);
	if (account.livemode !== config.livemode)
		throw new Error('Account environment mismatch.');
	if (
		verifiedBinding &&
		account.configuration?.customer?.test_clock !== verifiedBinding.clockId
	)
		throw new Error(
			'The provider did not confirm the requested synthetic test clock.',
		);
	return db.transaction(async (tx) => {
		await tx
			.insert(paymentAccounts)
			.values({
				userId,
				stripeAccountId: account.id,
				livemode: config.livemode,
			})
			.onConflictDoNothing();
		const [result] = await tx
			.select()
			.from(paymentAccounts)
			.where(
				and(
					eq(paymentAccounts.userId, userId),
					eq(paymentAccounts.livemode, config.livemode),
				),
			)
			.limit(1);
		if (!result || result.stripeAccountId !== account.id)
			throw new Error(
				'Account creation conflict requires reconciliation.',
			);
		if (verifiedBinding)
			await persistEntitlementClockBinding(
				tx,
				verifiedBinding,
				account.id,
			);
		return result;
	});
}

export async function refreshRecipientAccount(accountId: string) {
	const config = paymentConfiguration();
	const [known] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.stripeAccountId, accountId),
				eq(paymentAccounts.livemode, config.livemode),
			),
		)
		.limit(1);
	if (!known)
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: 'Unknown recipient account.',
		});
	const account = await stripeClient().v2.core.accounts.retrieve(accountId, {
		include: ['configuration.recipient', 'requirements'],
	});
	if (account.livemode !== config.livemode)
		throw new Error('Account environment mismatch.');
	const capabilities =
		account.configuration?.recipient?.capabilities?.stripe_balance;
	const transfersActive = capabilities?.stripe_transfers?.status === 'active';
	const payoutsActive = capabilities?.payouts?.status === 'active';
	const requirements =
		account.requirements?.entries
			?.map((entry) => entry.description)
			.slice(0, 30) ?? [];
	const [updated] = await db
		.update(paymentAccounts)
		.set({ transfersActive, payoutsActive, requirements })
		.where(eq(paymentAccounts.stripeAccountId, accountId))
		.returning();
	return updated!;
}

export async function requireReadyRecipient(userId: string) {
	await requirePaymentMember(userId);
	const [row] = await db
		.select()
		.from(paymentAccounts)
		.where(
			and(
				eq(paymentAccounts.userId, userId),
				eq(paymentAccounts.livemode, paymentConfiguration().livemode),
			),
		)
		.limit(1);
	if (!row?.recipientRequested)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'The recipient must finish Stripe onboarding first.',
		});
	const refreshed = await refreshRecipientAccount(row.stripeAccountId);
	if (!refreshed.transfersActive || !refreshed.payoutsActive)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'The recipient is not yet eligible to receive contributions and payouts.',
		});
	return refreshed;
}

export async function createRecipientSession(userId: string) {
	const config = paymentConfiguration();
	if (!config.askPayments && !config.funds)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'Recipient onboarding is not enabled.',
		});
	const account = await ensureCustomerAccount(userId);
	if (!account.recipientRequested) {
		await stripeClient().v2.core.accounts.update(
			account.stripeAccountId,
			{
				dashboard: 'express',
				identity: { country: 'us' },
				defaults: {
					responsibilities: {
						fees_collector: 'application',
						losses_collector: 'application',
					},
				},
				configuration: {
					recipient: {
						capabilities: {
							stripe_balance: {
								stripe_transfers: { requested: true },
							},
						},
					},
				},
			},
			{ idempotencyKey: `recipient:${account.stripeAccountId}` },
		);
		await db
			.update(paymentAccounts)
			.set({ recipientRequested: true })
			.where(
				eq(paymentAccounts.stripeAccountId, account.stripeAccountId),
			);
	}
	const session = await stripeClient().accountSessions.create({
		account: account.stripeAccountId,
		components: {
			account_onboarding: { enabled: true },
			notification_banner: { enabled: true },
			account_management: { enabled: true },
			payouts: { enabled: true },
		},
	});
	return {
		clientSecret: session.client_secret,
		accountId: account.stripeAccountId,
		publishableKey: config.publishableKey,
	};
}

export async function recipientDashboardLink(userId: string) {
	const account = await ensureCustomerAccount(userId);
	if (!account.recipientRequested)
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'Start recipient onboarding first.',
		});
	const link = await stripeClient().accounts.createLoginLink(
		account.stripeAccountId,
	);
	return { url: link.url };
}

export async function createPortal(userId: string) {
	await requirePaymentMember(userId);
	const config = paymentConfiguration();
	const stripe = stripeClient();
	let configurationId: string;
	try {
		configurationId = requirePortalConfigurationId(
			process.env['STRIPE_PORTAL_CONFIGURATION_ID'],
		);
		const configuration =
			await stripe.billingPortal.configurations.retrieve(configurationId);
		validatePortalConfiguration(
			configuration,
			configurationId,
			config.livemode,
		);
	} catch {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'Billing management is unavailable until its period-end cancellation policy is verified.',
		});
	}
	const account = await ensureCustomerAccount(userId);
	const portal = await stripe.billingPortal.sessions.create({
		customer_account: account.stripeAccountId,
		return_url: `${config.origin}/account/billing`,
		configuration: configurationId,
	});
	return { url: portal.url };
}
