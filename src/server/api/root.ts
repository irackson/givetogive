import { askRouter } from '@/server/api/routers/ask';
import { userRouter } from '@/server/api/routers/user';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';
import { securityRouter } from './routers/security';
import { adminRouter } from './routers/admin';
import { billingRouter } from './routers/billing';
import { casesRouter } from './routers/cases';
import { paymentControlsRouter } from './routers/payment-controls';

export const appRouter = createTRPCRouter({
	ask: askRouter,
	user: userRouter,
	security: securityRouter,
	admin: adminRouter,
	billing: billingRouter,
	cases: casesRouter,
	paymentControls: paymentControlsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
