import { postRouter } from 'code/server/api/routers/post';
import { askRouter } from 'code/server/api/routers/ask';
import { createCallerFactory, createTRPCRouter } from 'code/server/api/trpc';

export const appRouter = createTRPCRouter({
	post: postRouter,
	ask: askRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
