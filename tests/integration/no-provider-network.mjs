/** Explicit CI-only preload. Never import this in real mailbox/provider acceptance. */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import postgres from 'postgres';
import {
	isolatedConfiguration,
	verifyIsolatedTarget,
} from '../../scripts/isolated-environment.ts';

const configuration = isolatedConfiguration(process.env, 'test');
const connection = postgres(configuration.directUrl, {
	max: 1,
	connect_timeout: 15,
});
try {
	await connection.begin('read only', (tx) =>
		verifyIsolatedTarget(tx, configuration),
	);
} finally {
	await connection.end({ timeout: 5 });
}

function deny() {
	// Do not include arguments, URLs, request bodies or credentials in errors.
	throw new Error(
		'Outbound HTTP disabled for isolated regression execution.',
	);
}
globalThis.fetch = async () => deny();
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
syncBuiltinESMExports();
