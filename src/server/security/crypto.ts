import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '@/env';

function key() {
	if (!env.ADMIN_ENCRYPTION_KEY) throw new Error('Administrative encryption is not configured.');
	return createHash('sha256').update(env.ADMIN_ENCRYPTION_KEY).digest();
}
export function sealSecret(value: string, purpose: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	cipher.setAAD(Buffer.from(purpose));
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), encrypted].map((item) => item.toString('base64url')).join('.');
}
export function openSecret(value: string, purpose: string) {
	const parts = value.split('.');
	if (parts.length !== 3) throw new Error('Invalid encrypted secret.');
	const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
	const cipher = createDecipheriv('aes-256-gcm', key(), iv!);
	cipher.setAAD(Buffer.from(purpose));
	cipher.setAuthTag(tag!);
	return Buffer.concat([cipher.update(encrypted!), cipher.final()]).toString('utf8');
}
