import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const HASH_PREFIX = 'scrypt';

export async function hashPassword(password: string) {
	const salt = randomBytes(16).toString('hex');
	const derivedKey = (await scryptAsync(
		password,
		salt,
		KEY_LENGTH,
	)) as Buffer;

	return `${HASH_PREFIX}$${salt}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string) {
	const [prefix, salt, encodedKey, ...extraParts] = storedHash.split('$');
	if (
		prefix !== HASH_PREFIX ||
		!salt ||
		!encodedKey ||
		extraParts.length > 0
	) {
		return false;
	}

	const storedKey = Buffer.from(encodedKey, 'hex');
	if (storedKey.length !== KEY_LENGTH) return false;

	const suppliedKey = (await scryptAsync(
		password,
		salt,
		KEY_LENGTH,
	)) as Buffer;

	return timingSafeEqual(storedKey, suppliedKey);
}
