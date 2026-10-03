import postgres from 'postgres';
import { isolatedConfiguration, verifyIsolatedTarget } from './isolated-environment.ts';
import { readMigrationFiles, verifyMigrationHistory } from './migration-history.ts';

const mode = process.argv[2];
let connection: ReturnType<typeof postgres> | undefined;
try {
	if (!['--production-read-only', '--isolated-read-only'].includes(mode ?? ''))
		throw new Error('An explicit read-only target is required.');
	const production = mode === '--production-read-only';
	const configuration = production ? undefined : isolatedConfiguration(process.env);
	const url = new URL(configuration?.directUrl ?? process.env['DATABASE_URL_UNPOOLED'] ?? process.env['DATABASE_URL'] ?? '');
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password)
		throw new Error('Invalid database connection.');
	if (production && (
		!['', 'production'].includes(process.env['APP_ENV'] ?? '') ||
		decodeURIComponent(url.pathname.slice(1)) !== 'verceldb'
	)) throw new Error('Production review cannot use an isolated or differently named database.');
	// Explicitly remove pooling for session-level read-only and timeout settings.
	url.hostname = url.hostname.replace('-pooler.', '.');
	connection = postgres(url.href, {
		max: 1, connect_timeout: 15, onnotice() {},
		connection: { default_transaction_read_only: true, statement_timeout: 15000, lock_timeout: 3000 },
	});
	if (configuration) await verifyIsolatedTarget(connection, configuration);
	const files = readMigrationFiles();
	const evidence = await connection.begin('isolation level repeatable read read only', async tx => {
		const [target] = await tx`select current_database() as database, current_setting('transaction_read_only') as read_only`;
		if (target?.['database'] !== (configuration?.database ?? 'verceldb') || target?.['read_only'] !== 'on')
			throw new Error('Read-only database binding failed.');
		const history = await tx<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`;
		const migration = verifyMigrationHistory(files, history);
		const columns = await tx<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema='public' and table_name='givetogive_user'`;
		const available = new Set(columns.map(row => row.column_name));
		const [counts] = await tx`select
			(select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and starts_with(table_name, 'givetogive_')) as tables,
			(select count(*)::int from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and starts_with(c.relname, 'givetogive_')) as constraints,
			(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and starts_with(c.relname, 'givetogive_') and not t.tgisinternal) as triggers,
			(select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and not starts_with(table_name, 'givetogive_')) as unrelatedTables`;
		return {
			observedAt: new Date().toISOString(), mode, database: target['database'],
			transactionReadOnly: true, ...migration,
			missingNewUserColumns: ['role', 'session_version', 'frozen_at', 'is_synthetic', 'show_supporter_badge'].filter(name => !available.has(name)),
			schemaCounts: counts, memberDataRead: false, databaseWrites: false,
			// Metadata evidence is never payment acceptance or authorization to deploy.
			rolloutApproved: false,
		};
	});
	console.log(JSON.stringify(evidence));
} catch {
	// Provider/database errors can include a connection URL; never print them.
	console.error(JSON.stringify({ migrationReview: 'failed', databaseWrites: false, privateDetails: 'withheld' }));
	process.exitCode = 1;
} finally { await connection?.end(); }
