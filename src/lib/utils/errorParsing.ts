import type { LengthOfString } from '../types/type-helpers';
import { irradiateCircularity } from './jsonHelpers';

/////////////////////////////////////////////////////////////////////
export const genericErrorMessage = 'failed for unknown reason';
export function ensureFallbackMsg<T extends string>(
	msg: T extends '' ? never : T,
): T;
export function ensureFallbackMsg(
	msg: undefined | null | '' | (string & { length: LengthOfString<''> }),
): typeof genericErrorMessage;

export function ensureFallbackMsg(msg: string | undefined | null) {
	return typeof msg === 'string' && msg.length > 0 ?
			msg
		:	genericErrorMessage;
}
/////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////
export interface SomeObjWithMessage {
	message: string;
	stack?: string | string[] | null;
	name?: string | null;
}
export const isWithMessage = (e: unknown): e is SomeObjWithMessage =>
	Boolean(
		e &&
			typeof e === 'object' &&
			'message' in e &&
			typeof e.message === 'string',
	);

export const parseUncaughtException = (
	someObjWithMessage: SomeObjWithMessage,
) => {
	try {
		const { message, name, stack } = someObjWithMessage;
		return {
			message,
			...((name ?? stack) && {
				cause: {
					...(name && { name }),
					...(stack && {
						stack:
							typeof stack === 'string' ?
								stack.split('\n').slice(1, 5)
							: (
								Array.isArray(stack) &&
								stack.every((s) => typeof s === 'string')
							) ?
								stack.slice(1, 5)
							:	stack,
					}),
				},
			}),
		};
	} catch (e) {
		console.error(`Failed to parseUncaughtException`);

		return {
			message: `Failed to parseUncaughtException: ${
				e && typeof e === 'object' && 'message' in e ?
					String(e.message)
				:	'unknown reason'
			}. Returning message of 'undefined' (as string)`,
		};
	}
};

export const ensureErrMessage = (
	e: unknown,
	trimMessageBy = Infinity,
): {
	message: string;
	cause?: Partial<{
		stack: string[];
		name: string;
		rawErrObj: unknown;
		parsingError: unknown;
	}>;
} => {
	try {
		if (isWithMessage(e)) {
			return parseUncaughtException({
				...e,
				message: e.message.slice(0, trimMessageBy),
			});
		}

		if (typeof e === 'object') {
			if (e === undefined || e === null) {
				return {
					message: 'err is null or undefined (reason unknown)',
				};
			}
			const nonCircularVersion = irradiateCircularity(e, false);
			if (nonCircularVersion) {
				try {
					return {
						message: JSON.stringify(nonCircularVersion).slice(
							0,
							trimMessageBy,
						),
					};
				} catch (__parsingErr) {
					/* msg not json */
				}
			}

			return {
				message: `Error occurred, but failed to stringify... see cause`,
				cause: {
					rawErrObj: e,
				},
			};
		}

		if (typeof e === 'string') {
			return {
				message: ensureFallbackMsg(e).slice(0, trimMessageBy),
			};
		}

		return {
			message: `Error occurred; but received msg of type '${typeof e}'... see cause`,
			cause: {
				rawErrObj: e,
			},
		};
	} catch (parsingError) {
		return {
			message: `Error occurred; but failed to ensureErrMessage... see cause`,
			cause: {
				rawErrObj: e,
				parsingError: parsingError,
			},
		};
	}
};
/////////////////////////////////////////////////////////////////////
