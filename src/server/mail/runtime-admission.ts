import { createHmac } from 'node:crypto';
import {
	createGiveMailBinding,
	readGiveMailConfiguration,
} from './give-mailer.ts';
import { PostgresGiveMailReceiptStore } from './postgres-receipts.ts';
import type { GiveToGiveMailRuntime } from './runtime.ts';

export function prepareGiveRuntime(
	source: Readonly<Record<string, string | undefined>>,
): GiveToGiveMailRuntime | undefined {
	if (source['GIVE_MAIL_RUNTIME_ADMISSION'] !== 'v1') return undefined;
	if (
		source['APP_ENV'] !== 'production' ||
		source['NODE_ENV'] !== 'production' ||
		source['VERCEL_ENV'] !== 'production' ||
		source['GIVE_MAIL_STORAGE_ADMISSION'] !== 'v1' ||
		source['GIVE_AUTH_ORIGIN'] !== 'https://givetogive.ianrackson.com'
	)
		throw new Error('Give mail runtime admission unavailable.');
	const config = readGiveMailConfiguration(source),
		encoded = source['GIVE_MAIL_BINDING_KEY_B64'],
		capacity = source['GIVE_MAIL_RECEIPT_MAX_RECORDS'];
	if (
		!encoded ||
		encoded.length > 344 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			encoded,
		) ||
		!capacity ||
		!/^[1-9][0-9]{0,4}$/.test(capacity) ||
		Number(capacity) > 10000
	)
		throw new Error('Give mail runtime admission unavailable.');
	const material = Buffer.from(encoded, 'base64');
	try {
		if (
			material.length < 32 ||
			material.length > 256 ||
			material.toString('base64') !== encoded
		)
			throw new Error('Give mail runtime admission unavailable.');
		const bind = createGiveMailBinding(material),
			intentMaterial = Buffer.from(material);
		return Object.freeze({
			config,
			fetch: globalThis.fetch.bind(globalThis),
			store: new PostgresGiveMailReceiptStore({
				maxRecords: Number(capacity),
			}),
			bind,
			bindAuthIntent(
				tokenHash: string,
				purpose: 'email_verification' | 'password_reset',
			) {
				if (
					!/^[a-f0-9]{64}$/.test(tokenHash) ||
					!['email_verification', 'password_reset'].includes(purpose)
				)
					throw new Error('Give mail intent unavailable.');
				return (
					'mail:' +
					createHmac('sha256', intentMaterial)
						.update('give-auth-mail-intent:v1\0')
						.update(purpose)
						.update('\0')
						.update(tokenHash)
						.digest('hex')
						.slice(0, 32)
				);
			},
		});
	} finally {
		material.fill(0);
	}
}
