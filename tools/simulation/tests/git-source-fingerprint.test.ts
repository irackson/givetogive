import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseSourceDigest } from '../../../scripts/release-rehearsal-fingerprint.mjs';
import { authoredTraversal, gitSourceFingerprint } from '../src/git-source-fingerprint.ts';

test('canonical authored ordering matches recursive directory traversal', () => {
 const paths = ['src/foo.ts','src/foo/bar.ts','public/z.png','src/app/.well-known/workflow/generated.ts','package.json','docs/not-authored.md','src/Foo.ts'];
 assert.deepEqual(authoredTraversal(paths),['src/Foo.ts','src/foo/bar.ts','src/foo.ts','public/z.png','package.json']);
 assert.notDeepEqual(authoredTraversal(paths),paths.filter(path => path.startsWith('src/foo')).sort());
});
test('invalid paths, duplicate files and file/directory collisions reject', () => {
 for (const paths of [['src/../bad.ts'],['src\\bad.ts'],['src/a.ts','src/a.ts'],['src/a','src/a/b.ts']])
  assert.throws(() => authoredTraversal(paths));
 assert.throws(() => gitSourceFingerprint('.', 'HEAD'));
});
test('Git traversal agrees with independently implemented filesystem release fingerprint', t => {
 const directory = mkdtempSync(join(tmpdir(),'g2g-fingerprint-'));
 t.after(() => rmSync(directory,{recursive:true,force:true}));
 const files = new Map([['src/foo.ts','sibling\n'],['src/foo/bar.ts','nested\n'],['public/z.png','fixture'],['package.json','{}\n']]);
 for (const [path,bytes] of files) {
  mkdirSync(join(directory,...path.split('/').slice(0,-1)),{recursive:true});
  writeFileSync(join(directory,path),bytes);
 }
 const hash = createHash('sha256');
 for (const path of authoredTraversal([...files.keys()])) hash.update(path).update('\0').update(files.get(path)!).update('\0');
 assert.equal(hash.digest('hex'),releaseSourceDigest(directory));
});
