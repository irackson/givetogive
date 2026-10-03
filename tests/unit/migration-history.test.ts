import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationFile, verifyMigrationHistory, validateMigrationFiles } from '../../scripts/migration-history.ts';

const files = [
	migrationFile({ idx: 0, when: 1000, tag: '0000_first' }, 'select 1;\r\n'),
	migrationFile({ idx: 1, when: 2000, tag: '0001_second' }, 'select 2;\n'),
	migrationFile({ idx: 2, when: 3000, tag: '0002_third' }, 'select 3;\n'),
];
const row = (index: number) => ({ hash: files[index]!.hash, created_at: String(files[index]!.when) });

test('migration review identifies the complete prefix and exact pending chain', () => {
	const result = verifyMigrationHistory(files, [row(0)]);
	assert.equal(result.appliedMigrationCount, 1);
	assert.deepEqual(result.pendingMigrations, ['0001_second', '0002_third']);
	assert.deepEqual(result.formattingMatches, []);
	assert.deepEqual(verifyMigrationHistory(files, files.map((__file, index) => row(index))).pendingMigrations, []);
});

test('line-ending-only differences are explicit without altering recorded evidence', () => {
	const history = [{ hash: files[0]!.lfHash, created_at: '1000' }];
	const copy = structuredClone(history);
	const result = verifyMigrationHistory(files, history);
	assert.deepEqual(result.formattingMatches, ['0000_first']);
	assert.deepEqual(history, copy);
	const lfFiles = files.map(file => migrationFile(file, `select ${file.idx + 1};\n`));
	assert.equal(verifyMigrationHistory(lfFiles, history).migrationChainDigest, result.migrationChainDigest);
});

test('history cannot hide missing, duplicate, reordered or unknown migrations behind its last timestamp', () => {
	for (const history of [[row(1)], [row(0), row(2)], [row(0), row(0)], [row(1), row(0)], [...files.map((__file, index) => row(index)), row(2)]])
		assert.throws(() => verifyMigrationHistory(files, history));
});

test('SQL changes and another migration hash are not formatting-only matches', () => {
	for (const hash of ['a'.repeat(64), files[1]!.hash, migrationFile(files[0]!, 'select 100;\n').hash])
		assert.throws(() => verifyMigrationHistory(files, [{ hash, created_at: 1000 }]));
});

test('manifest rejects traversal, duplicate tags, indexes, unsafe timestamps and nonincreasing order', () => {
	assert.throws(() => validateMigrationFiles([]));
	for (const replacement of [{ tag: '../secrets' }, { idx: 4 }, { when: NaN }, { when: Number.MAX_SAFE_INTEGER + 1 }, { hash: 'invalid' }])
		assert.throws(() => validateMigrationFiles([{ ...files[0]!, ...replacement }, ...files.slice(1)]));
	assert.throws(() => validateMigrationFiles([files[0]!, { ...files[1]!, tag: files[0]!.tag }]));
	assert.throws(() => validateMigrationFiles([files[0]!, { ...files[1]!, when: 999 }]));
	for (const timestamp of ['1000.0', '1000garbage', '', '1e3', 1000.1])
		assert.throws(() => verifyMigrationHistory(files, [{ hash: files[0]!.hash, created_at: timestamp }]));
});
