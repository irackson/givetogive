import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { start } from 'workflow/api';
import {
	createTRPCRouter,
	protectedProcedure,
	billingManagementProcedure,
	publicProcedure,
} from '@/server/api/trpc';
import {
	assertAdmin,
	assertFinancialAdmin,
} from '@/server/security/authorization';
import {
	publicPaymentConfiguration,
	paymentConfiguration,
} from '@/server/payments/config';
import { quotePayment } from '@/server/payments/math';
import {
	createCheckout,
	checkoutInput,
	enableAskPayments,
} from '@/server/payments/checkout';
import {
	createPortal,
	createRecipientSession,
	recipientDashboardLink,
} from '@/server/payments/accounts';
import {
	askFunding,
	getFund,
	listFunds,
	myOverview,
	myPayments,
	myRecipient,
	mySubscriptions,
	paymentAudit,
	paymentDetail,
	paymentOperationsSummary,
} from '@/server/payments/queries';
import {
	createFund,
	createFundInput,
	allocateInput,
	reserveAllocation,
} from '@/server/payments/funds';
import { refundInput, reserveRefund } from '@/server/payments/refunds';
import { cancelCheckout } from '@/server/payments/reconcile';
import {
	previewSupporterChange,
	confirmSupporterChange,
	supporterChangeStatus,
	listSupporterChanges,
	supporterChangeInput,
	supporterChangeOperationInput,
	supporterChangeListInput,
} from '@/server/payments/supporter-changes';
import { recordEvent } from '@/server/observability/events';
import {
	createFundCancellationPortal,
	fundCancellationInput,
} from '@/server/payments/fund-cancellation';
import {
	fundAllocationWorkflow,
	paymentRecoveryWorkflow,
	paymentReservationWorkflow,
	refundWorkflow,
	supporterChangeWorkflow,
} from '@/workflows/payments';

export const billingRouter = createTRPCRouter({
	availability: publicProcedure.query(() => publicPaymentConfiguration()),
	quote: publicProcedure
		.input(
			z.object({
				grossAmount: z.number().int().min(100).max(100_000_000),
			}),
		)
		.query(({ input }) => {
			const config = paymentConfiguration();
			if (!config.configured)
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: 'Giving is not configured yet.',
				});
			return quotePayment(input.grossAmount, config.feePolicy);
		}),
	askFunding: publicProcedure
		.input(z.object({ askId: z.number().int().positive() }))
		.query(({ input }) => askFunding(input.askId)),
	funds: publicProcedure.query(() => listFunds()),
	fund: publicProcedure
		.input(z.object({ slug: z.string().max(160) }))
		.query(({ input }) => getFund(input.slug)),
	myOverview: billingManagementProcedure.query(({ ctx }) =>
		myOverview(ctx.billingSession.user.id),
	),
	myPayments: protectedProcedure
		.input(
			z
				.object({
					cursor: z.uuid().optional(),
					limit: z.number().int().min(1).max(100).default(20),
				})
				.default({ limit: 20 }),
		)
		.query(({ ctx, input }) => myPayments(ctx.session.user.id, input)),
	payment: protectedProcedure
		.input(z.object({ id: z.uuid() }))
		.query(({ ctx, input }) =>
			paymentDetail(ctx.session.user.id, input.id),
		),
	mySubscriptions: billingManagementProcedure.query(({ ctx }) =>
		mySubscriptions(ctx.billingSession.user.id),
	),
	previewSupporterChange: billingManagementProcedure
		.input(supporterChangeInput)
		.mutation(({ ctx, input }) =>
			previewSupporterChange(ctx.billingSession.user.id, input),
		),
	confirmSupporterChange: billingManagementProcedure
		.input(supporterChangeOperationInput)
		.mutation(async ({ ctx, input }) => {
			// Admission is durable before dispatch. Same-ID retries may enqueue another
			// workflow, but the server lease and stable provider step keys serialize it.
			const result = await confirmSupporterChange(
				ctx.billingSession.user.id,
				input,
			);
			if (
				[
					'reserved',
					'processing',
					'recovery_required',
					'scheduled',
				].includes(result.status)
			)
				await start(supporterChangeWorkflow, [result.operationId]);
			return result;
		}),
	supporterChangeStatus: billingManagementProcedure
		.input(supporterChangeOperationInput)
		.query(({ ctx, input }) =>
			supporterChangeStatus(ctx.billingSession.user.id, input),
		),
	listSupporterChanges: billingManagementProcedure
		.input(supporterChangeListInput.default({ limit: 20 }))
		.query(({ ctx, input }) =>
			listSupporterChanges(ctx.billingSession.user.id, input),
		),
	createFundCancellationPortal: billingManagementProcedure
		.input(fundCancellationInput)
		.mutation(({ ctx, input }) =>
			createFundCancellationPortal(
				ctx.billingSession,
				input,
				ctx.headers,
			),
		),
	myRecipient: protectedProcedure.query(({ ctx }) =>
		myRecipient(ctx.session.user.id),
	),
	enableAskPayments: protectedProcedure
		.input(z.object({ askId: z.number().int().positive() }))
		.mutation(({ ctx, input }) =>
			enableAskPayments(ctx.session.user.id, input.askId),
		),
	createCheckout: protectedProcedure
		.input(checkoutInput)
		.mutation(async ({ ctx, input }) => {
			const result = await createCheckout(ctx.session.user.id, input);
			await start(paymentReservationWorkflow, [result.operationId]);
			return result;
		}),
	cancelCheckout: protectedProcedure
		.input(z.object({ id: z.uuid() }))
		.mutation(({ ctx, input }) =>
			cancelCheckout(ctx.session.user.id, input.id),
		),
	createPortal: protectedProcedure.mutation(({ ctx }) =>
		createPortal(ctx.session.user.id),
	),
	createRecipientSession: protectedProcedure.mutation(({ ctx }) =>
		createRecipientSession(ctx.session.user.id),
	),
	createRecipientDashboardLink: protectedProcedure.mutation(({ ctx }) =>
		recipientDashboardLink(ctx.session.user.id),
	),
	adminCreateFund: protectedProcedure
		.input(createFundInput)
		.mutation(async ({ ctx, input }) => {
			await assertFinancialAdmin(
				ctx.session.user.id,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			);
			return createFund(ctx.session.user.id, input);
		}),
	adminAllocate: protectedProcedure
		.input(allocateInput)
		.mutation(async ({ ctx, input }) => {
			await assertFinancialAdmin(
				ctx.session.user.id,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			);
			const allocation = await reserveAllocation(
				ctx.session.user.id,
				input,
			);
			await start(fundAllocationWorkflow, [allocation.id]);
			return allocation;
		}),
	adminRefund: protectedProcedure
		.input(refundInput)
		.mutation(async ({ ctx, input }) => {
			await assertFinancialAdmin(
				ctx.session.user.id,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			);
			const operation = await reserveRefund(ctx.session.user.id, input);
			await start(refundWorkflow, [operation.id]);
			return operation;
		}),
	adminOperations: protectedProcedure.query(async ({ ctx }) => {
		await assertAdmin(ctx.session.user.id);
		return paymentOperationsSummary();
	}),
	adminAudit: protectedProcedure
		.input(z.object({ id: z.uuid() }))
		.query(async ({ ctx, input }) => {
			await assertAdmin(ctx.session.user.id);
			return paymentAudit(input.id);
		}),
	adminReconcile: protectedProcedure.mutation(async ({ ctx }) => {
		await assertFinancialAdmin(
			ctx.session.user.id,
			ctx.headers.get('x-admin-elevation') ?? undefined,
		);
		const run = await start(paymentRecoveryWorkflow, []);
		await recordEvent({
			externalId: `admin-reconciliation-request:${run.runId}`,
			actorId: ctx.session.user.id,
			entityType: 'workflow',
			entityId: run.runId,
			runId: run.runId,
			action: 'admin_reconciliation_requested',
			outcome: 'started',
		});
		return { runId: run.runId };
	}),
});
