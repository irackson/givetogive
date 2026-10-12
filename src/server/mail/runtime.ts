import 'server-only';
import type { FetchLike, PayloadBinder, ReceiptStore, TransportConfig } from './types.ts';

export interface GiveToGiveMailRuntime {
	readonly config: TransportConfig;
	readonly fetch: FetchLike;
	readonly store: ReceiptStore;
	readonly bind: PayloadBinder;
}

/** Requires independently admitted durable claims and private bindings. Env alone cannot enable it. */
export function getGiveToGiveMailRuntime(): GiveToGiveMailRuntime | undefined {
	return undefined;
}
