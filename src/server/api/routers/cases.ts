import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
	caseHistory,
	caseHistoryInput,
	caseReviewInput,
	reviewCase,
} from '@/server/payments/cases';

export const casesRouter = createTRPCRouter({
	history: protectedProcedure
		.input(caseHistoryInput)
		.query(({ ctx, input }) => caseHistory(ctx.session.user.id, input)),
	review: protectedProcedure
		.input(caseReviewInput)
		.mutation(({ ctx, input }) =>
			reviewCase(
				ctx.session.user.id,
				input,
				ctx.headers.get('x-admin-elevation') ?? undefined,
			),
		),
});
