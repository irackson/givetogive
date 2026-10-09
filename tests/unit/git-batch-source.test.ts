import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authoredGitTraversal, fingerprintGitBatch } from '../../scripts/git-batch-source.mjs';
function fixture() {
 const values=[{path:'src/foo/bar.ts',bytes:Buffer.from('nested\n\0binary\n')},
  {path:'src/foo.ts',bytes:Buffer.alloc(0)},{path:'public/icon.png',bytes:Buffer.from([137,80,78,71,13,10,26,10,0,255])}];
 const rows=values.map(row=>({...row,object:createHash('sha1').update(`blob ${row.bytes.length}\0`).update(row.bytes).digest('hex')}));
 const bytes=Buffer.concat(rows.map(row=>Buffer.concat([Buffer.from(`${row.object} blob ${row.bytes.length}\n`),row.bytes,Buffer.from('\n')])));
 const hash=createHash('sha256');for(const row of rows)hash.update(row.path).update('\0').update(row.bytes).update('\0');
 return {rows,bytes,digest:hash.digest('hex')};
}
test('batched canonical blobs retain recursive ordering and exact binary object identity',()=>{
 const f=fixture();assert.equal(fingerprintGitBatch(f.bytes,f.rows),f.digest);
 assert.deepEqual(authoredGitTraversal(['src/foo.ts','src/foo/bar.ts','public/icon.png','docs/readme.md',
  'src/app/.well-known/workflow/generated.ts']),['src/foo/bar.ts','src/foo.ts','public/icon.png']);
});
test('wrong framing, missing/extra bytes, wrong identity, corruption and unsafe paths fail closed',()=>{
 const f=fixture();
 for(const bytes of [f.bytes.subarray(0,-1),Buffer.concat([f.bytes,Buffer.from('\n')]),Buffer.from(f.bytes.toString('latin1').replace(' blob ',' tree '),'latin1')])
  assert.throws(()=>fingerprintGitBatch(bytes,f.rows));
 const corrupt=Buffer.from(f.bytes);corrupt[corrupt.indexOf(Buffer.from('nested'))]=0;assert.throws(()=>fingerprintGitBatch(corrupt,f.rows));
 assert.throws(()=>fingerprintGitBatch(f.bytes,[{...f.rows[0]!,object:'a'.repeat(40)},...f.rows.slice(1)]));
 assert.throws(()=>fingerprintGitBatch(f.bytes,[{...f.rows[0]!,path:'src/../foreign'},...f.rows.slice(1)]));
 assert.throws(()=>fingerprintGitBatch(f.bytes,[...f.rows].reverse()));
 for(const paths of [['src/../bad'],['src\\bad'],['src/a','src/a'],['src/a','src/a/b']])assert.throws(()=>authoredGitTraversal(paths));
});
