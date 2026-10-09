export function encryptionKey(raw: string | undefined): Buffer;
export function seal(value: unknown, key: Buffer): Buffer;
export function unseal(
	bytes: Buffer,
	key: Buffer,
	maximumOutputBytes?: number,
): unknown;
