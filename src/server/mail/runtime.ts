import 'server-only';
import { prepareGiveRuntime } from './runtime-admission.ts';
import type {
	FetchLike,
	PayloadBinder,
	ReceiptStore,
	TransportConfig,
} from './types.ts';

export interface GiveToGiveMailRuntime {
	readonly config: TransportConfig;
	readonly fetch: FetchLike;
	readonly store: ReceiptStore;
	readonly bind: PayloadBinder;
	readonly bindAuthIntent?: (
		tokenHash: string,
		purpose: 'email_verification' | 'password_reset',
	) => string;
}

/** Disabled by default. Explicit production/storage admission still requires
 * the preexisting SQL ledger/function; never creates or resets native state. */
export function getGiveToGiveMailRuntime(): GiveToGiveMailRuntime | undefined {
	if (process.env['GIVE_MAIL_RUNTIME_ADMISSION'] !== 'v1') return undefined;
	return prepareGiveRuntime(process.env);
}
