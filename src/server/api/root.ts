import { askRouter } from 'code/server/api/routers/ask';
import { createCallerFactory, createTRPCRouter } from 'code/server/api/trpc';

export const appRouter = createTRPCRouter({
	ask: askRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
