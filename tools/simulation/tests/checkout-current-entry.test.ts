import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const entry=fileURLToPath(new URL('../src/checkout-current-member-entry.mjs',import.meta.url));
test('current member entry is inert by default and cannot execute without explicit owned IPC',()=>{
 assert.equal(execFileSync(process.execPath,[entry],{encoding:'utf8'}),'');
 for(const args of [['--execute-current-member'],['--unknown'],['--execute-current-member','--extra']]){
  const result=spawnSync(process.execPath,[entry,...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 }
});
