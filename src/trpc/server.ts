import 'server-only';

import { type AppRouter, createCaller } from '@/server/api/root';
import { createTRPCContext } from '@/server/api/trpc';
import { createHydrationHelpers } from '@trpc/react-query/rsc';
import { headers } from 'next/headers';
import { cache } from 'react';

import { createQueryClient } from './query-client';

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
	//! https://nextjs.org/docs/canary/app/building-your-application/upgrading/version-15#temporary-synchronous-usage-1

	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
	const heads = new Headers(await headers());
	try {
		heads.set('x-trpc-source', 'rsc');
		heads.set('x-trpc-source-set-by', 'createContext');
	} catch (e) {
		console.error(e);
	}

	return createTRPCContext({
		headers: heads,
	});
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
	caller,
	getQueryClient,
);
