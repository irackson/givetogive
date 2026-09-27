import type { Sql } from 'postgres';

const DATABASES = {
	staging: 'givetogive_staging_20260926',
	test: 'givetogive_ci_20260926',
} as const;

/** Refuse mismatched labels/URLs before connecting or uploading any secrets. */
export function isolatedConfiguration(
	values: Record<string, string | undefined>,
	expectedEnvironment?: 'staging' | 'test',
) {
	const environment = values['APP_ENV'];
	if (
		(environment !== 'staging' && environment !== 'test') ||
		(expectedEnvironment && environment !== expectedEnvironment)
	) {
		throw new Error('An explicitly isolated environment is required.');
	}
	const database = DATABASES[environment];
	if (
		values['DATABASE_DATABASE'] !== database ||
		values['DATABASE_USER'] !== database
	) {
		throw new Error(
			'Isolated database labels do not match the required role.',
		);
	}
	const identity = values['DATABASE_IDENTITY'];
	if (!identity || !/^[a-f0-9-]{36}$/i.test(identity))
		throw new Error('Isolated identity is missing or malformed.');
	const urls = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'].map((key) => {
		let url: URL;
		try {
			url = new URL(values[key] ?? '');
		} catch {
			throw new Error('Both isolated database URLs are required.');
		}
		if (
			!['postgres:', 'postgresql:'].includes(url.protocol) ||
			decodeURIComponent(url.pathname.slice(1)) !== database ||
			decodeURIComponent(url.username) !== database ||
			!url.password
		) {
			throw new Error(
				'Database URL does not use the exact isolated database and role.',
			);
		}
		return url;
	});
	const pooled = urls[0]!;
	const direct = urls[1]!;
	const host = (url: URL) => url.hostname.replace('-pooler.', '.');
	if (host(pooled) !== host(direct))
		throw new Error('Isolated database URLs disagree about their server.');
	if (
		environment === 'staging' &&
		values['APP_URL'] !== 'https://givetogive-staging.vercel.app'
	) {
		throw new Error(
			'The canonical protected staging origin is required before local override.',
		);
	}
	if (
		values['STRIPE_LIVE_APPROVED'] === 'true' ||
		(values['STRIPE_SECRET_KEY'] &&
			!/^[rs]k_test_/.test(values['STRIPE_SECRET_KEY'])) ||
		(values['STRIPE_PUBLISHABLE_KEY'] &&
			!/^pk_test_/.test(values['STRIPE_PUBLISHABLE_KEY'])) ||
		(values['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] &&
			!/^pk_test_/.test(values['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']))
	) {
		throw new Error(
			'Isolated configuration cannot use live Stripe credentials or approval.',
		);
	}
	return {
		environment,
		database,
		identity,
		pooledUrl: pooled.toString(),
		directUrl: direct.toString(),
	};
}

/** Read-only preflight; must run before migration, startup or environment upload. */
export async function verifyIsolatedTarget(
	sql: Sql,
	configuration: ReturnType<typeof isolatedConfiguration>,
	allowEmpty = false,
) {
	const [current] =
		await sql`SELECT current_database() AS database, current_user AS role,
		rolsuper, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname=current_user`;
	if (
		!current ||
		current['database'] !== configuration.database ||
		current['role'] !== configuration.database ||
		current['rolsuper'] ||
		current['rolcreaterole'] ||
		current['rolcreatedb'] ||
		current['rolinherit']
	) {
		throw new Error(
			'Connected database or restricted role does not match the isolated target.',
		);
	}
	const [table] =
		await sql`SELECT to_regclass('public.givetogive_environment_identity') AS marker`;
	if (!table?.['marker']) {
		const [count] =
			await sql`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public'`;
		if (allowEmpty && count?.['tables'] === 0) return { empty: true };
		throw new Error(
			'Existing target has no environment identity; refusing to change it.',
		);
	}
	const [marker] =
		await sql`SELECT identity, environment, database_name FROM public.givetogive_environment_identity WHERE id=1`;
	if (
		!marker ||
		marker['identity'] !== configuration.identity ||
		marker['environment'] !== configuration.environment ||
		marker['database_name'] !== configuration.database
	) {
		throw new Error(
			'Existing target identity mismatch; no migration or upload was performed.',
		);
	}
	return { empty: false };
}
