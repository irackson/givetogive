import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
	listPaymentAsks,
	paymentAskControlInput,
	paymentAskListInput,
	setAskPaymentPause,
} from '@/server/payments/controls';

export const paymentControlsRouter = createTRPCRouter({
	asks: protectedProcedure
		.input(paymentAskListInput)
		.query(({ ctx, input }) => listPaymentAsks(ctx.session.user.id, input)),
	setAskPaused: protectedProcedure
		.input(paymentAskControlInput)
		.mutation(({ ctx, input }) =>
			setAskPaymentPause(
				ctx.session.user.id,
				input,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			),
		),
});
