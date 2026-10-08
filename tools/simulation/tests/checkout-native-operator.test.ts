import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const url=new URL('../../../scripts/checkout-native-operator.mjs',import.meta.url),script=fileURLToPath(url);
test('native operator import/default cannot load credentials, authenticate or dispatch',()=>{
 const output=JSON.parse(execFileSync(process.execPath,[script],{encoding:'utf8'}));
 assert.deepEqual(output,{execute:false,externalRequests:0,checkoutCreated:false,paymentAccepted:false});
 const imported=execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(url.href)});console.log('import-only');`],{encoding:'utf8'});
 assert.equal(imported.trim(),'import-only');
});
test('unsupported retry, alternative member or live flags fail before operational imports',()=>{
 for(const args of [['--retry'],['--execute-reviewed','--live'],['--execute-reviewed','--member','other']]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.match(result.stderr,/originals retained; no automatic retry/);
  assert.equal(result.stderr.includes('sk_'),false);
 }
});
