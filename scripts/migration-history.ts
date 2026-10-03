import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type JournalEntry = { idx: number; when: number; tag: string };
export type MigrationFile = JournalEntry & {
	hash: string;
	lfHash: string;
	crlfHash: string;
};
export type AppliedMigration = { hash: string; created_at: string | number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Preserve historical SQL bytes; a formatting match is reported, not rewritten. */
export function migrationFile(entry: JournalEntry, sql: string): MigrationFile {
	const lf = sql.replaceAll('\r\n', '\n');
	return { ...entry, hash: hash(sql), lfHash: hash(lf), crlfHash: hash(lf.replaceAll('\n', '\r\n')) };
}

export function validateMigrationFiles(files: MigrationFile[]) {
	if (!files.length) throw new Error('Migration manifest is empty.');
	const tags = new Set<string>();
	for (const [index, file] of files.entries()) {
		if (
			file.idx !== index || !Number.isSafeInteger(file.when) || file.when <= 0 ||
			(index > 0 && file.when <= files[index - 1]!.when) ||
			!/^\d{4}_[a-z0-9_]+$/.test(file.tag) || tags.has(file.tag) ||
			![file.hash, file.lfHash, file.crlfHash].every(value => /^[a-f0-9]{64}$/.test(value))
		) throw new Error('Migration manifest is malformed or out of order.');
		tags.add(file.tag);
	}
}

export function readMigrationFiles(directory = './drizzle') {
	const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] };
	// Validate tags before using them as filesystem paths.
	if (!Array.isArray(journal.entries) || journal.entries.some(entry => !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)))
		throw new Error('Migration journal tags are invalid.');
	const files = journal.entries.map(entry => migrationFile(entry, readFileSync(join(directory, `${entry.tag}.sql`), 'utf8')));
	validateMigrationFiles(files);
	return files;
}

/** A last-timestamp check alone can hide missing or different earlier migrations. */
export function verifyMigrationHistory(files: MigrationFile[], history: AppliedMigration[]) {
	validateMigrationFiles(files);
	if (history.length > files.length) throw new Error('Database migration history extends beyond this source.');
	const formattingMatches: string[] = [];
	for (const [index, row] of history.entries()) {
		const file = files[index]!;
		const timestamp = typeof row.created_at === 'string' && /^\d+$/.test(row.created_at)
			? Number(row.created_at) : row.created_at;
		if (timestamp !== file.when || !Number.isSafeInteger(timestamp))
			throw new Error('Database migration history is not an exact source prefix.');
		if (row.hash === file.hash) continue;
		if (row.hash === file.lfHash || row.hash === file.crlfHash) formattingMatches.push(file.tag);
		else throw new Error('Recorded migration SQL differs from the reviewed source.');
	}
	return {
		appliedMigrationCount: history.length,
		pendingMigrations: files.slice(history.length).map(file => file.tag),
		formattingMatches,
		// Stable across checkout line endings; hashes every SQL file, not just names.
		migrationChainDigest: hash(JSON.stringify(files.map(file => ({ idx: file.idx, when: file.when, tag: file.tag, hash: file.lfHash })))),
	};
}
